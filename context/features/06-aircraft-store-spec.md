# Feature: Aircraft store

**From build-plan:** feature 06
**Build attempt:** 1
**Branch:** feature/06-aircraft-store

Source: `docs/flight-map-plan.md` §6 Step 6 and §5 Key decisions.

## Goal

A pure, fully tested in-memory store that turns the six aircraft message types
into a consistent `Map<hex, Aircraft>`, sweeps stale aircraft, and projects
itself to GeoJSON for the map - with no React and no map dependency.

## In scope

- `store/aircraftStore.ts`: snapshot, upsert, delta merge, remove, staleness
- `store/selectors.ts`: `toGeoJSON()`, `getByHex()`, counts
- Subscription mechanism for consumers
- Full unit test coverage

## Out of scope

- Rendering (feature 07), trails (feature 09), airframe identity (feature 12)
- WebSocket transport (feature 05)

## Build loop

Implement all steps, then one review packet.

## Build steps

- [ ] **Create the store with a mutable `Map<hex, Aircraft>` and a subscribe
  mechanism** (`useSyncExternalStore`-compatible: `subscribe(cb)` plus a version
  counter or snapshot getter). The `Map` is mutated directly and listeners are
  notified - aircraft are **not** React state.
  **Done when:** a subscriber is notified on mutation and can read current state.
- [ ] **Handle `aircraft:snapshot`:** replace the entire contents, discarding
  anything absent from the snapshot.
  **Done when:** a snapshot after existing state leaves exactly the snapshot's
  aircraft.
- [ ] **Handle `aircraft:new` and `aircraft:update`:** upsert wholesale by `hex`,
  recording `lastSeen`.
  **Done when:** an update for a known hex replaces its fields; for an unknown
  hex it inserts.
- [ ] **Handle `aircraft:delta`:** shallow-merge only the present fields into the
  existing record, preserving fields the delta omits. A delta for an **unknown
  hex** is dropped and flagged for resync - never inserted as a partial record,
  which would create an aircraft with no position or identity.
  **Done when:** a delta merges without clobbering omitted fields, and an
  unknown-hex delta leaves the store unchanged and sets the resync flag.
- [ ] **Handle `aircraft:remove`:** delete by `hex`; removing an unknown hex is a
  no-op, not an error.
  **Done when:** both cases behave as described.
- [ ] **Add the staleness sweep.** Any aircraft whose `lastSeen` is older than a
  configurable threshold (default 60 s) is marked stale; past a hard threshold
  (default 5 min) it is dropped. Missed `remove` events are a real failure mode -
  without this, ghost aircraft accumulate on the map forever.
  **Done when:** a test with fake timers shows an aircraft going fresh → stale →
  removed with no further messages.
- [ ] **Add `selectors.ts` with `toGeoJSON()`.** Emits a `FeatureCollection` of
  points. **Aircraft without `lat`/`lon` are excluded from the output but kept in
  the store** - they still count and may gain a position fix later. Each feature
  carries `hex`, `flight` (trimmed - callsigns are space-padded), `alt_baro`,
  `gs`, `track`, and `stale` as properties.
  **Done when:** a store containing positioned and unpositioned aircraft emits
  features for only the positioned ones, with trimmed callsigns.
- [ ] **Add counts and `getByHex()`** for the stats bar and detail panel.
  **Done when:** counts distinguish total tracked from positioned-and-fresh.

## Files / areas

- `src/store/aircraftStore.ts`, `src/store/selectors.ts`
- `src/store/aircraftStore.test.ts`, `src/store/selectors.test.ts`

## Data / contracts

- `hex` is the identity key. Never `flight`.
- Every payload field except `hex` is optional and must be guarded - SkySpy's
  aircraft object is `additionalProperties: {}` and deployment-specific.
- `lastSeen` is recorded by the store from a client clock, not taken from the
  payload - server timestamps may be absent or skewed.
- The store is transport-agnostic: it accepts parsed, typed messages and knows
  nothing about WebSockets.

## Testing

This feature is pure logic and carries the heaviest test weight in the project.
Cover: all six message types; delta merge preserving omitted fields; delta for
unknown hex; remove of unknown hex; snapshot replacing prior state; staleness
transitions with fake timers; GeoJSON excluding unpositioned aircraft; callsign
trimming; subscriber notification.

## Notes for the AI

- No React imports in this feature. If the store needs React to be testable,
  the design is wrong.
- Do not put aircraft in `useState`. At up to 10 Hz across hundreds of aircraft,
  React reconciliation is the bottleneck the whole architecture is shaped to
  avoid.
- `toGeoJSON()` is called at render frequency in feature 07 - keep it allocation-
  light and avoid deep clones.
