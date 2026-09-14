# Build Plan

Features that make up FlightScanner, in build order. Some items still have a
pre-written spec in [`blueprint/context/features/`](context/features/); where one
is linked below, `/feature <n>` should read it as its primary source. Where none
is linked, `/feature <n>` writes the spec from
[`blueprint/project-plan.md`](project-plan.md) and
[`blueprint/context/project-overview.md`](context/project-overview.md).

Run `/feature` to spec the next unchecked item, or `/feature 7` to pick one.
Keep completed items checked. Do not renumber completed features; their archived
specs refer to those IDs.

> **Note on items 1-2.** The Blueprint normally treats scaffolding as a pre-build
> step rather than a feature. Here they are numbered features so that build-plan
> IDs stay aligned one-to-one with the spec files and the archives under
> `blueprint/history/features/`. Both have shipped; do not renumber them.

> **Stale specs removed (2026-09-13).** The nine specs written against the
> SkySpy WebSocket API, and the `docs/flight-map-plan.md` behind them, were
> deleted rather than left to mislead `/feature`. Items 7, 8, 9, and 11 were
> source-agnostic and keep their specs. Everything worth keeping from the
> deleted files - the identity key, the store-outside-React render path, the
> trail buffer - is now in `blueprint/project-plan.md` §5.

## Your features

### v1 - live map

- [x] 1. **Project scaffold** - Vite + React + TS, lint, format, Vitest, env config, verify script → `blueprint/context/features/01-scaffold-spec.md`
- [x] 2. **Map shell** - full-viewport dark MapLibre map centred on the configured location → `blueprint/context/features/02-map-shell-spec.md`
- [x] 3. **Backend proxy** - minimal stateless proxy for OpenSky states and tokens, credentials held server side, verified from the browser. Shipped; see `blueprint/history/features/03-backend-proxy.md`
- [x] 4. **Mock feed server** - replay `docs/fixtures/opensky-states-nl.json` as a moving feed with fault injection, so 5-7 can be built without spending credits
- [x] 5. **Polling client** - interval loop over the shipped transport against the one fixed bounding box, visibility pause, backoff on failure, credit budget tracking
- [x] 6. **Aircraft store** - pure Map<hex, Aircraft> reconciling successive full snapshots, deriving staleness from `lastContact` and dropping an aircraft 30 s after the last snapshot that held it
- [x] 7. **Aircraft layer** - one GeoJSON symbol layer, heading-rotated icons, throttled updates → `blueprint/context/features/07-aircraft-layer-spec.md`
- [x] 8. **FR24-style visual pass** - altitude colour ramp, zoom sizing, labels, stale fading, legend → `blueprint/context/features/08-visual-pass-spec.md`
- [x] 9. **Selection, detail panel, and trail** - click to select, fleet dims, trail draws, live telemetry → `blueprint/context/features/09-selection-detail-trail-spec.md`
- [ ] 10. **Poll status and resilience** - status indicator, remaining credits, stale snapshot warning, manual refresh, an "outside the covered box" state, and the four failure modes in project plan §7
- [ ] 11. **Documentation and polish** - README, loading and error states, responsive layout, accessibility → `blueprint/context/features/11-docs-and-polish-spec.md`

### v2 - aircraft identity and photos

> OpenSky provides no airframe or photo data. These features now use adsbdb for
> identity and planespotters for photos, both verified live on 2026-09-13.
> Planespotters requires a descriptive User-Agent, which browsers forbid setting,
> so its calls go through the feature 3 proxy.

- [ ] 12. **Identity API client and cache** - lazy per-selection adsbdb lookup with miss caching and dedupe
- [ ] 13. **Identity block** - registration, type, manufacturer, operator, country in the detail panel. The military badge has no source and is dropped
- [ ] 14. **Aircraft photo** - planespotters photo via the proxy, with mandatory photographer and link attribution, fixed ratio, fallback, click to enlarge
- [ ] 15. **Map enrichment from identity** - per-type silhouettes, cache-only. Military colouring has no source and is dropped

## Dependencies worth knowing

- **3 gates everything that needs live data.** CORS makes the proxy mandatory,
  so 5, 12, and 14 cannot reach their APIs without it. The OpenSky transport and
  a real captured fixture already shipped as the `opensky-rest-data-source` fix,
  so 3 is proxy work, not decoding work.
- **4 unblocks 5-7 without spending credits.** The daily budget is small enough
  that a replayable fixture is worth having before the polling loop exists. The
  mock must move aircraft between snapshots and drop some entirely, since that
  is the only way to exercise the store's reconciliation and its 30 s removal
  rule.
- **5 and 6 are independent of each other** and both depend on 3. They can be
  built in either order; 7 needs both.
- **9 reserves panel layout for 13-14.** Building 13 before 9 would mean
  restructuring the panel twice.
- **12 must precede 13 and 15.** Both read its cache; neither fetches. 14 uses a
  different source and depends only on 3 and 9.
- **11 closes v1.** Features 12-15 are a separate phase and should not be pulled
  into the v1 branches.
