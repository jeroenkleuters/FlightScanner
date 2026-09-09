# Build Plan

Features that make up FlightScanner, in build order. Each item has a detailed
pre-written spec in [`blueprint/context/features/`](context/features/) - `/feature <n>`
should read the matching spec as its primary source, plus
`docs/flight-map-plan.md` for wider context.

Run `/feature` to spec the next unchecked item, or `/feature 7` to pick one.
Keep completed items checked. Do not renumber completed features; their archived
specs refer to those IDs.

> **Note on items 1-2.** The Blueprint normally treats scaffolding as a pre-build
> step rather than a feature. Here they are numbered features so that build-plan
> IDs stay aligned one-to-one with the spec files already written in
> `blueprint/context/features/`. Item 1 is genuinely foundational - take it first and take
> it as written.

## Your features

### v1 - live map

- [ ] 1. **Project scaffold** - Vite + React + TS, lint, format, Vitest, env config, verify script → `blueprint/context/features/01-scaffold-spec.md`
- [ ] 2. **Map shell** - full-viewport dark MapLibre map centred on the configured location → `blueprint/context/features/02-map-shell-spec.md`
- [ ] 3. **Live instance verification** - settle the WebSocket handshake and capture real message fixtures → `blueprint/context/features/03-live-instance-verification-spec.md`
- [ ] 4. **Mock WebSocket server** - replay fixtures as a moving feed with fault injection → `blueprint/context/features/04-mock-websocket-server-spec.md`
- [ ] 5. **SkySpy WebSocket client** - authenticated connect, subscribe, typed dispatch, backoff reconnect → `blueprint/context/features/05-skyspy-websocket-client-spec.md`
- [ ] 6. **Aircraft store** - pure Map<hex, Aircraft> handling all six message types plus staleness → `blueprint/context/features/06-aircraft-store-spec.md`
- [ ] 7. **Aircraft layer** - one GeoJSON symbol layer, heading-rotated icons, throttled updates → `blueprint/context/features/07-aircraft-layer-spec.md`
- [ ] 8. **FR24-style visual pass** - altitude colour ramp, zoom sizing, labels, stale fading, legend → `blueprint/context/features/08-visual-pass-spec.md`
- [ ] 9. **Selection, detail panel, and trail** - click to select, fleet dims, trail draws, live telemetry → `blueprint/context/features/09-selection-detail-trail-spec.md`
- [ ] 10. **Connection status and resilience** - status indicator, REST seed, stats, stale warning, manual reconnect → `blueprint/context/features/10-status-resilience-spec.md`
- [ ] 11. **Documentation and polish** - README, loading and error states, responsive layout, accessibility → `blueprint/context/features/11-docs-and-polish-spec.md`

### v2 - aircraft identity and photos

- [ ] 12. **Airframes API client and cache** - lazy per-selection identity lookup with miss caching and dedupe → `blueprint/context/features/12-airframes-client-cache-spec.md`
- [ ] 13. **Identity block** - registration, type, operator, country, military badge in the detail panel → `blueprint/context/features/13-identity-block-spec.md`
- [ ] 14. **Aircraft photo** - photo with mandatory attribution, fixed ratio, fallback, click to enlarge → `blueprint/context/features/14-aircraft-photo-spec.md`
- [ ] 15. **Map enrichment from identity** - per-type silhouettes and military colouring, cache-only → `blueprint/context/features/15-map-identity-enrichment-spec.md`

## Dependencies worth knowing

- **3 gates 4-7.** Feature 3 produces the message fixtures and the confirmed
  handshake that the mock, client, and store are all built and tested against. It
  needs a reachable SkySpy instance; if there is none, feature 3 stops and reports
  rather than inventing fixtures.
- **5 and 6 are independent of each other** and both depend on 3. They can be
  built in either order; 7 needs both.
- **9 reserves panel layout for 13-14.** Building 13 before 9 would mean
  restructuring the panel twice.
- **12 must precede 13-15.** All three read its cache; none of them fetch.
- **11 closes v1.** Features 12-15 are a separate phase and should not be pulled
  into the v1 branches.
