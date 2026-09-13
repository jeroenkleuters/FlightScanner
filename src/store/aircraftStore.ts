/**
 * The fleet, reconciled from successive full snapshots.
 *
 * OpenSky sends no deltas and no removal events: every poll is the complete set
 * of state vectors inside the box, so identity over time is something this
 * module has to construct. It keys on `hex`, never on callsign, because
 * callsigns change and repeat.
 *
 * The map is mutable and lives outside React on purpose. Hundreds of aircraft
 * moving through `useState` would melt the app; React re-renders here are
 * reserved for poll status, selection, and counts.
 */

import type { StatesSnapshot } from '../api/opensky'
import type { Aircraft } from '../types/aircraft'

/**
 * How long an aircraft survives after the last snapshot that contained it, in
 * **milliseconds** against the client clock.
 *
 * The rule is evaluated only when a new snapshot arrives, never on a timer.
 * That ties removal to the poll cadence, so raising the interval lengthens the
 * grace period instead of letting the map empty itself between polls. At the
 * default 30 s interval the first snapshot omitting an aircraft is the one that
 * removes it, leaving no ghost at a stale position.
 */
export const DROP_AFTER_MS = 30_000

/**
 * How old OpenSky's own reading may be before an aircraft is flagged stale, in
 * **seconds** against `snapshot.time`.
 *
 * Two poll cadences. Healthy traffic never fades; an aircraft OpenSky has
 * stopped hearing fades within one extra poll. This is not the removal rule: an
 * aircraft present in every snapshot can be stale because its fix is minutes
 * old, while one that stops appearing is dropped outright whether or not it was
 * ever stale.
 */
export const STALE_AFTER_SECONDS = 60

/**
 * Declared as function properties rather than methods on purpose: these are
 * closures over the factory's own state, not methods with a `this`, so they can
 * be passed straight to a callback like `usePolling`'s `onSnapshot` without
 * binding.
 */
export interface AircraftStore {
  /** Reconciles one full snapshot into the fleet. */
  applySnapshot: (snapshot: StatesSnapshot) => void
  /**
   * Notified once per snapshot, after reconciliation, removal, and staleness
   * have all settled. Never once per aircraft: feature 7 turns one call into
   * one throttled `setData()`. Returns its own unsubscribe.
   */
  subscribe: (listener: () => void) => () => void
  get: (hex: string) => Aircraft | undefined
  values: () => IterableIterator<Aircraft>
  readonly size: number
}

export interface AircraftStoreOptions {
  /** Injected so tests drive the removal rule instead of waiting 30 s. */
  now?: () => number
}

/**
 * Compares OpenSky's clock against itself: `snapshot.time` and `lastContact`
 * are both their epoch seconds, so there is no client skew to reason about.
 * An aircraft with no `lastContact` is never stale, because fading is a claim
 * about known age rather than about missing data.
 */
function isStale(aircraft: Aircraft, snapshotTime: number): boolean {
  if (aircraft.lastContact === undefined) return false

  const ageSeconds = Math.max(0, snapshotTime - aircraft.lastContact)
  return ageSeconds > STALE_AFTER_SECONDS
}

export function createAircraftStore({
  now = Date.now,
}: AircraftStoreOptions = {}): AircraftStore {
  const fleet = new Map<string, Aircraft>()
  const listeners = new Set<() => void>()

  function notify(): void {
    // Iterating a copy so a listener that unsubscribes during the notification
    // cannot skip the one after it.
    for (const listener of [...listeners]) {
      // One broken subscriber must not stop the rest or leave the fleet
      // half-published. The map is already settled by the time this runs.
      try {
        listener()
      } catch (error) {
        console.error('Aircraft store listener failed', error)
      }
    }
  }

  function applySnapshot(snapshot: StatesSnapshot): void {
    const receivedAt = now()

    for (const aircraft of snapshot.aircraft) {
      // The store's own clock governs removal, so the transport's receipt time
      // is overwritten rather than trusted. A duplicate hex in one snapshot
      // simply lands last-wins.
      fleet.set(aircraft.hex, { ...aircraft, lastSeen: receivedAt })
    }

    // Only here, and only on a delivered snapshot. A failed poll delivers
    // nothing, so an outage leaves the fleet untouched rather than clearing it.
    // Staleness is recomputed for survivors the snapshot did not mention too:
    // their fix keeps ageing whether or not they were heard from again.
    for (const [hex, entry] of fleet) {
      if (receivedAt - entry.lastSeen >= DROP_AFTER_MS) {
        fleet.delete(hex)
        continue
      }

      // The store owns this field; whatever the transport decoded is replaced.
      entry.stale = isStale(entry, snapshot.time)
    }

    notify()
  }

  return {
    applySnapshot,

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    get: (hex) => fleet.get(hex),
    values: () => fleet.values(),
    get size() {
      return fleet.size
    },
  }
}
