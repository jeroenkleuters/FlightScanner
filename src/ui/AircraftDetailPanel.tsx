import { useEffect, useReducer, useState } from 'react'
import type { AircraftStore } from '../store/aircraftStore'
import type { Aircraft } from '../types/aircraft'

export interface AircraftDetailPanelProps {
  store: AircraftStore
  hex: string | null
  onClose: () => void
}

/**
 * Absent is a dash; zero is zero.
 *
 * Both halves matter. A missing squawk must not read as squawk 0, and
 * `alt_baro: 0` is a real ground altitude that must print as 0 rather than
 * being swallowed by a falsy check.
 */
function figure(value: number | undefined, unit?: string): string {
  if (value === undefined) return '—'
  const rounded = Math.round(value)
  return unit ? `${rounded} ${unit}` : String(rounded)
}

function text(value: string | undefined): string {
  return value === undefined || value === '' ? '—' : value
}

/** Seconds since this client last received the aircraft, as a short phrase. */
function secondsSince(lastSeen: number, now: number): number {
  return Math.max(0, Math.round((now - lastSeen) / 1000))
}

interface RowProps {
  label: string
  value: string
}

function Row({ label, value }: RowProps) {
  return (
    <div className="detail-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

/**
 * Telemetry for the selected aircraft.
 *
 * Three states have to stay distinguishable, because a frozen panel showing
 * confident numbers about an aircraft nobody can hear any more is the failure
 * this whole feature could most easily ship:
 *
 * - live: the store holds it and has not flagged it
 * - stale: the store holds it, but its fix is older than the staleness window
 * - lost: the store has dropped it, 30 s after the last snapshot that held it
 *
 * None of them clears the selection on its own. The user closes the panel.
 */
export function AircraftDetailPanel({
  store,
  hex,
  onClose,
}: AircraftDetailPanelProps) {
  const [, onSnapshot] = useReducer((count: number) => count + 1, 0)
  const [now, setNow] = useState(() => Date.now())

  // Read through, rather than copied into state: the store is the source of
  // truth and a copy could disagree with the map for a render. The subscription
  // exists only to schedule the re-render that re-reads it.
  const aircraft: Aircraft | undefined =
    hex === null ? undefined : store.get(hex)

  useEffect(() => {
    if (hex === null) return
    return store.subscribe(onSnapshot)
  }, [store, hex, onSnapshot])

  // The age has to tick between polls, or a 30 s gap looks like a frozen panel.
  useEffect(() => {
    if (hex === null) return

    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [hex])

  if (hex === null) return null

  return (
    <section className="detail-panel" aria-label="Aircraft detail">
      <header className="detail-header">
        <h2>{aircraft ? text(aircraft.flight) : '—'}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close aircraft detail"
        >
          ×
        </button>
      </header>

      {/* Reserved for features 13 and 14. Fixed height so adding identity and a
          photo later does not reflow the telemetry below it. */}
      <div className="detail-identity" data-testid="identity-slot" />

      {aircraft === undefined ? (
        <p className="detail-status detail-status-lost" role="status">
          Signal lost. This aircraft has stopped reporting and has been dropped
          from the fleet.
        </p>
      ) : (
        <>
          {aircraft.stale && (
            <p className="detail-status detail-status-stale" role="status">
              Stale contact. The last fix is older than the map shows elsewhere.
            </p>
          )}
          <dl className="detail-telemetry">
            <Row label="Hex" value={aircraft.hex} />
            <Row label="Altitude" value={figure(aircraft.alt_baro, 'ft')} />
            <Row label="Ground speed" value={figure(aircraft.gs, 'kt')} />
            <Row label="Heading" value={figure(aircraft.track, '°')} />
            <Row
              label="Vertical rate"
              value={figure(aircraft.baro_rate, 'ft/min')}
            />
            <Row label="Squawk" value={text(aircraft.squawk)} />
            <Row
              label="On ground"
              value={
                aircraft.on_ground === undefined
                  ? '—'
                  : aircraft.on_ground
                    ? 'Yes'
                    : 'No'
              }
            />
            <Row
              label="Last seen"
              value={`${secondsSince(aircraft.lastSeen, now)} s ago`}
            />
          </dl>
        </>
      )}
    </section>
  )
}

export default AircraftDetailPanel
