# Feature: Aircraft store

**From build-plan:** feature 6
**Build attempt:** 1
**Branch:** feature/aircraft-store
**Status:** verified

Source: `blueprint/context/project-overview.md` "Data model" and "Architecture
decisions, locked"; `blueprint/project-plan.md` §4 and §5.

## Goal

A pure `Map<hex, Aircraft>` that turns the stream of full snapshots from feature
5 into a stable fleet: aircraft appear, keep their identity as they move, fade
when OpenSky's reading of them goes old, and disappear 30 s after the last
snapshot that held them. This is the layer that makes feature 7 possible - the
map draws the store, never the raw snapshot.

## In scope

- `Map<hex, Aircraft>` reconciling successive full snapshots: insert, update in
  place, drop
- The locked removal rule: dropped 30 s after the last snapshot that contained
  the aircraft, evaluated only when a new snapshot arrives, never on a timer
- Derived `stale`, from `lastContact` against the snapshot's own clock
- A subscribe/unsubscribe seam so feature 7 can drive a throttled `setData()`
- `toGeoJSON()`, the projection feature 7 consumes
- Wiring the store between `usePolling`'s `onSnapshot` and the existing
  provisional readout, so the count shown is the fleet, not the last snapshot

## Out of scope

- The map layer, icons, rotation, throttling (feature 7)
- Colour ramps, zoom sizing, labels, legend, the visual treatment of `stale`
  (feature 8)
- Selection, the detail panel, and the trail buffer (feature 9). The trail buffer
  is deliberately **not** part of the store
- The real status bar, credit display, and the "outside the covered box" state
  (feature 10)
- Identity and photo caches (features 12-15)
- Interpolating positions between polls, or any history beyond the current fix

## Build loop

Implement all steps, then one review packet. No checkpoint commits;
`/complete` creates the final feature commit.

## Build steps

- [x] **Add `src/store/aircraftStore.ts` with snapshot reconciliation.** A
  factory `createAircraftStore({ now = Date.now } = {})` holding a private
  mutable `Map<string, Aircraft>`. `applySnapshot(snapshot: StatesSnapshot)`
  walks `snapshot.aircraft`: a `hex` not in the map is inserted, a `hex` already
  present replaces its entry in place, and each present aircraft has `lastSeen`
  overwritten with the store's `now()` so one clock governs removal. Duplicate
  `hex` within one snapshot: last wins. Expose `get(hex)`, `size`, and
  `values()`. Injected `now` is the test seam; the store must never read
  `Date.now` directly.
  **Done when:** unit tests show a first snapshot inserts every aircraft, a
  second snapshot updates a shared `hex` in place rather than duplicating it,
  and `size` reflects the union of what is still current.

- [x] **Apply the locked 30 s removal rule.** At the end of every
  `applySnapshot`, and only there, drop each aircraft whose `now() - lastSeen`
  is at least `DROP_AFTER_MS` (30000, an exported named constant). Never run this
  on a timer and never run it on a failed poll - a failed poll delivers no
  snapshot, so the fleet must survive an outage untouched rather than emptying
  itself. An empty or `null` `states` payload is a valid empty box, not an error:
  it ages the fleet like any other snapshot and eventually clears it.
  **Done when:** unit tests driving the injected clock show an aircraft absent
  from a snapshot 30 s later is dropped, one absent for less than 30 s is kept,
  an empty snapshot is applied without error and removes nothing before the
  threshold, and no removal happens without an `applySnapshot` call.

- [x] **Derive `stale` from `lastContact`.** On every `applySnapshot`, recompute
  `stale` for **every** aircraft in the map, including those absent from this
  snapshot, since their fix keeps ageing. An aircraft is stale when
  `snapshot.time - lastContact` exceeds `STALE_AFTER_SECONDS` (60, an exported
  named constant). Compare against `snapshot.time`, not the client clock: both
  are OpenSky epoch seconds, so there is no skew to reason about. An aircraft
  with no `lastContact` is **not** stale - fading is a claim about known age -
  and a negative age is clamped to 0. The store owns this field; the
  `stale: false` the transport decodes is always overwritten here.
  **Done when:** unit tests show an aircraft with a fix older than 60 s is
  flagged stale, one inside 60 s is not, an aircraft missing `lastContact` is
  never stale, an aircraft absent from the newest snapshot has its staleness
  recomputed against that snapshot's time, and an aircraft can be stale while
  still present in every snapshot.

- [x] **Add the subscribe seam.** `subscribe(listener: () => void): () => void`
  returning its own unsubscribe, notified once per `applySnapshot` after
  reconciliation, removal, and staleness have all settled - never once per
  aircraft. Listeners receive no argument and read the store; a throwing
  listener must not stop the others or corrupt the map. Unsubscribing during
  notification must not skip a remaining listener.
  **Done when:** unit tests show one snapshot producing exactly one notification
  regardless of aircraft count, unsubscribe stopping further calls, and a
  throwing listener not preventing the next one from running.

- [x] **Add `src/store/aircraftGeoJSON.ts` with `toGeoJSON()`.** A pure function
  over an iterable of `Aircraft` returning a `FeatureCollection` of `Point`
  features with coordinates `[lon, lat]` in that order. **Aircraft without both
  `lat` and `lon` are omitted from the output but stay in the store** - they
  still count, and a later snapshot may give them a fix. Properties are exactly
  `hex`, `flight`, `alt_baro`, `gs`, `track`, `stale`; an absent optional field
  is omitted from `properties` rather than emitted as `undefined`, which does
  not survive serialization. Do not invent a feature `id`: feature 9 will use
  MapLibre's `promoteId: 'hex'` against the `hex` property.
  **Done when:** unit tests show positioned aircraft projected with `[lon, lat]`
  in the right order and the six properties present, a positionless aircraft
  absent from the collection while still in the store, absent optionals omitted
  from `properties`, and an empty store producing a valid empty
  `FeatureCollection`.

- [x] **Wire the store into the running app.** Add
  `src/store/useAircraftStore.ts`: a hook creating one store per mount via
  `useRef`, subscribing on mount and unsubscribing on unmount, and exposing the
  store plus a `count` in React state. Only the count crosses into React;
  aircraft movement must not. In `src/App.tsx`, pass
  `onSnapshot={store.applySnapshot}` to `usePolling` and render the store's
  `count` in the provisional readout in place of the poller's `aircraftCount`,
  which is the size of the last snapshot rather than the fleet.
  **Done when:** `npm run verify` passes, and with `npm run mock` running the
  readout shows a fleet count that persists across polls instead of resetting to
  each snapshot's size, with aircraft dropping out 30 s after they stop
  appearing.

## Files / areas

- `src/store/aircraftStore.ts`, `src/store/aircraftStore.test.ts` - new
- `src/store/aircraftGeoJSON.ts`, `src/store/aircraftGeoJSON.test.ts` - new
- `src/store/useAircraftStore.ts`, `src/store/useAircraftStore.test.tsx` - new
- `src/App.tsx` - wires `usePolling`'s `onSnapshot` to the store and shows the
  fleet count
- `src/App.test.tsx` - update for the changed count source
- `src/types/aircraft.ts` - read only; the `Aircraft` shape is already settled
- `src/api/opensky.ts` - read only, for the `StatesSnapshot` type

## Data / contracts

**Identity.** `hex` is the key, everywhere, lowercase as the transport already
normalizes it. Never `flight`: callsigns change and repeat.

**Reconciliation**, from the overview's locked table:

| Situation | Store effect |
| --- | --- |
| `hex` in new snapshot, not in store | Insert |
| `hex` in both | Update in place, preserving trail and selection |
| `hex` in store, absent from snapshot | Dropped once 30 s have passed since the last snapshot that contained it |
| Empty or `null` `states` | A valid empty box, never an error |

"Preserving trail and selection" holds by construction: both live outside the
store and are keyed by `hex`, so replacing an entry cannot disturb them.

**Two clocks, deliberately.** Removal runs on the client clock (`now()` against
`lastSeen`, milliseconds) because it is a statement about poll cadence. Staleness
runs on OpenSky's clock (`snapshot.time` against `lastContact`, seconds) because
it is a statement about how old their reading is. Mixing them would make one of
the two wrong by whatever the clock skew is.

**Removal is not fading.** An aircraft present in every snapshot can be stale
because its fix is minutes old; an aircraft that stops appearing is dropped
outright whether or not it was stale. Feature 8 renders the difference.

**Boundedness.** The map is bounded by the traffic in the fixed box and the 30 s
drop rule, so no session can grow it without limit.

**Cadence note.** The poller schedules with `setTimeout(intervalMs)`, which never
fires early, so at the default 30 s interval the first snapshot omitting an
aircraft is the one that removes it, leaving no ghost at a stale position. Raising
the interval lengthens the grace period rather than emptying the map between
polls - that is the point of evaluating on arrival rather than on a timer.

**Not React state.** The store is a mutable `Map` outside React. React re-renders
in this app are reserved for poll status, selection, and counts.

## Testing

The test gate is on; these are pure modules, so coverage is unit tests in Vitest
with an injected clock and hand-built snapshots - no fixtures, no network, no
jsdom except for the hook.

- Reconciliation: insert, update in place, duplicate `hex` in one snapshot.
- Removal: dropped at 30 s, kept before it, empty snapshot valid, nothing removed
  without an `applySnapshot`.
- Staleness: over and under the 60 s threshold, missing `lastContact`, negative
  age, recomputed for aircraft absent from the newest snapshot, stale while
  still present.
- Subscribe: one notification per snapshot, unsubscribe, throwing listener.
- `toGeoJSON`: coordinate order, the six properties, positionless excluded,
  absent optionals omitted, empty collection.
- `useAircraftStore`: count updates on snapshot, unsubscribes on unmount.
- Manual, with `npm run mock`: the fleet count persists across polls and
  aircraft the mock drops disappear about 30 s later.

## Notes for the AI

- The transport already decodes, guards, and lowercases. Do not re-parse vectors
  or re-derive units here; the store's whole job is identity over time.
- `snapshot.time` is epoch **seconds**, `lastSeen` is epoch **milliseconds**.
  Getting this wrong makes the 30 s rule silently off by 1000x, so keep the
  constants' units in their names or comments.
- Never read `Date.now` inside the store. The injected `now` is what makes the
  removal rule testable without waiting 30 s.
- Do not add a timer, interval, or `requestAnimationFrame` here. Throttling is
  feature 7's job and the removal rule is explicitly snapshot-driven.
- Do not lift the `Map` into `useState` or `useSyncExternalStore` over the whole
  fleet to make feature 7 easier. Only the count crosses into React.
- Keep `toGeoJSON` a pure function over an iterable rather than a store method,
  so feature 7 can test it against a literal array.


<!-- blueprint:completion {"schemaVersion":1,"specBytes":11498,"specSha256":"cfd7a81c5978d7bbb970cd569edc5a898c7fb75d8cb604f320cd9e2e792f50cd","branch":"refs/heads/feature/aircraft-store","head":"5e3dea701d0c9a8b73806f3286591c61c882f89a","baseRef":"refs/heads/master","baseCommit":"5e3dea701d0c9a8b73806f3286591c61c882f89a","sourceTree":"2136873ea3f31da0366380c4e9d0b62c4c23ff93","absentOptional":[]} -->
