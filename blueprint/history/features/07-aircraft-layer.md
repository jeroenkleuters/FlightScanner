# Feature: Aircraft layer

**From build-plan:** feature 7
**Build attempt:** 1

**Status:** verified

**Branch:** `feature/aircraft-layer`

Primary source: `blueprint/context/features/07-aircraft-layer-spec.md`, tightened
against the shipped store and mock. Deviations from it are called out in
`Notes for the AI`.

## Goal

Aircraft from the store appear on the map as heading-rotated plane icons and
move as each poll lands - the first moment the app does what it exists to do.

## In scope

- One GeoJSON source and one symbol layer holding the whole fleet
- Icon rotation from `track`, falling back to 0 when absent
- A plane icon registered with the map as an SDF image
- A throttled update path: many store notifications coalesce into one `setData()`
- Clean teardown on unmount and re-registration after a style change

## Out of scope

- Altitude colour ramp, zoom sizing, labels, stale fading, legend (feature 8)
- Selection, detail panel, trails (feature 9)
- Poll status surface and the "outside the covered box" state (feature 10)
- Per-aircraft React components or DOM markers - explicitly excluded, see Notes
- Position interpolation between polls, which would complicate feature 9's trail

## Build loop

Implement all steps, then one review packet. Step checkpoint commits are
disabled (`workflow.stepReview: "feature"`, `workflow.checkpointCommits:
"disabled"`). `/complete` makes the single feature commit.

## Build steps

- [x] 1. **Add the plane icon and register it as an SDF image.**
  Add `src/assets/aircraft.svg`: a plain plane silhouette, nose pointing up at
  0 degrees, single fill, square viewBox. Register it with
  `map.addImage(id, image, { sdf: true })` once the style is loaded, and again
  after any style change, guarding on `map.hasImage(id)` so a re-register is
  never a duplicate-id error.
  **Done when:** `npm run verify` passes, and with the app running the icon
  renders for a fleet of one; `map.hasImage('aircraft')` is true after load.

- [x] 2. **Add `src/map/aircraftStyle.ts` and `src/map/AircraftLayer.tsx`.**
  `aircraftStyle.ts` exports the icon id, the source id, the layer id and the
  symbol layer's `layout` object as pure data, so it is unit testable with no
  WebGL. The layer uses `icon-image` set to the registered id,
  `icon-rotate` reading `track` through a `coalesce` with a 0 fallback,
  `icon-rotation-alignment: 'map'`, `icon-allow-overlap: true` and
  `icon-ignore-placement: true`. `AircraftLayer.tsx` renders react-map-gl's
  `Source` and `Layer` with that config and an initial empty
  `FeatureCollection`, and mounts as a child of `FlightMap` from `App`.
  **Done when:** a static fleet renders at correct positions, each icon rotated
  to its `track`; an aircraft with no `track` renders unrotated rather than
  disappearing; unit tests cover the layout object and the rotation expression.

- [x] 3. **Wire the store to the layer through a throttled update path.**
  Extract the throttle as a pure, injectable function in its own module - it
  takes a scheduler and a minimum interval, and coalesces any number of calls
  inside one window into exactly one invocation on the trailing edge. Subscribe
  to `store.subscribe` on mount, and on notification schedule one update that
  calls `toGeoJSON(store.values())` and hands the result to the source.
  **Done when:** with `npm run mock` and `npm run dev` running, aircraft appear
  and shift position as polls land; unit tests prove N calls inside one window
  produce exactly one update, that the trailing call uses the latest data, and
  that a call after the window opens a new one.

- [x] 4. **Tear down cleanly.**
  On unmount cancel any pending scheduled frame, unsubscribe from the store, and
  let react-map-gl remove the source and layer. Must survive React StrictMode's
  double mount without leaking a subscription or a pending frame.
  **Done when:** a unit test asserts unsubscribe and frame-cancel both run on
  unmount; remounting re-subscribes and renders again; no duplicate-layer or
  duplicate-image error appears in the console.

- [x] 5. **Record observed behaviour at the fleet size this app actually has.**
  With the mock running, note the fleet count and whether panning and zooming
  stay smooth. Do not claim a figure that was not observed. If a scaled load
  test is wanted, see `Open questions` - the mock cannot currently produce one.
  **Done when:** the observed fleet count and a plain statement of map
  responsiveness are recorded in the review packet, with measured numbers and
  the suspected bottleneck if it is not smooth.

## Verification state

`npm run verify` (typecheck, 313 tests in 22 files, build) and `npm run lint`
both pass.

Observed live against `npm run mock` and `npm run dev`, by reading the running
map's own state rather than trusting the build:

| Observation | Result |
| --- | --- |
| Poll readout | `Live`, 27-34 aircraft across runs, credits counting down |
| `map.loaded()` | `true` |
| `map.hasImage('aircraft-icon')` | `true` - the SDF icon registered |
| `map.getSource('aircraft').type` | `geojson` |
| `map.querySourceFeatures('aircraft')` | 51 features across loaded tiles |
| `map.queryRenderedFeatures({layers:['aircraft-symbols']})` | 18 - symbols placed and drawn in the viewport |
| Layer layout read back from the live style | exactly the authored object, `coalesce` rotation included |
| Console | no errors and no exceptions, so no style, expression, or duplicate-image failure |
| Screenshot | aircraft visible, each at its own heading, clustered over Schiphol |

The fleet count moves between observations because the mock drops and moves
aircraft between snapshots, which is the store's reconciliation working.

**Defect found and fixed during this verification.** The first screenshot showed
the fleet drawing black on a near-black basemap: an SDF image has no colour of
its own and `icon-color` defaults to black. Added `aircraftPaint` with a
legible default. Feature 8 replaces it with the altitude ramp; without it the
layer was invisible rather than merely unstyled.

**Not observed, and not claimed:** panning and zooming smoothness under load.
The browser here was driven headlessly with no interaction, so step 5's
responsiveness clause is recorded as unmeasured rather than answered. The
basemap is also absent from the screenshot; that is this environment's software
WebGL, which does not draw the basemap's vector layers, and is unrelated to this
feature.

## Files / areas

- `src/assets/aircraft.svg` - new, the icon
- `src/map/aircraftStyle.ts` - new, ids, layout and paint as pure data
- `src/map/AircraftLayer.tsx` - new, the source, layer and subscription
- `src/map/aircraftIcon.ts` - new, icon id and registration rules. Split out
  from `AircraftLayer.tsx` so the guards are testable without WebGL, which the
  spec's own Notes require
- `src/map/throttle.ts` - new, the pure coalescing scheduler
- `src/App.tsx` - passes the store into the layer as a child of `FlightMap`
- Tests beside each new module, per the project's convention

`src/map/FlightMap.tsx` already renders `children` inside `<Map>`, so the layer
mounts through react-map-gl's own context with no change to that file.

## Data / contracts

- Aircraft render as **one GeoJSON symbol layer**, never individual markers or
  per-aircraft React components. MapLibre draws the layer on the GPU in one
  pass; DOM markers cost a node and a reconciliation each.
- Feature properties come from the shipped `toGeoJSON` in
  `src/store/aircraftGeoJSON.ts`: `hex`, `flight`, `alt_baro`, `gs`, `track`,
  `stale`. Absent optionals are omitted, not set to `undefined`, so style
  expressions must use `coalesce` rather than assuming a key exists.
- `toGeoJSON` already skips aircraft with no `lat`/`lon`. The layer inherits
  that; it does not re-filter.
- The icon is registered **SDF**. Feature 8's altitude colour ramp drives
  `icon-color`, which MapLibre honours only for SDF images. Registering it
  non-SDF now would mean redrawing and re-registering the icon in feature 8.
- Fleet updates never pass through React state. React re-renders stay reserved
  for poll status, selection and counts.
- The store notifies **once per snapshot**, already reconciled - never once per
  aircraft. One notification becomes at most one `setData()`.

## Testing

The test gate is on; `npm test` is Vitest with jsdom. jsdom has no WebGL, so the
map itself is verified manually and every piece of logic is extracted to be
testable without it.

- `aircraftStyle.ts`: the layout object and the `icon-rotate` expression,
  including the missing-`track` fallback.
- `throttle.ts`: N calls in one window produce one invocation; the trailing call
  carries the latest value; a later call opens a new window; cancel prevents a
  pending invocation.
- `AircraftLayer.tsx`: mounts with the expected source and layer props, updates
  the source when the store notifies, and unsubscribes and cancels on unmount.
  Mock `react-map-gl/maplibre` the way `FlightMap.test.tsx` already does.
- `toGeoJSON` is already covered by feature 6; do not duplicate its tests.
- Manual: mock running, aircraft appear and move, headings look right against
  `track`.

## Notes for the AI

- **The ~4 Hz throttle rationale in the pre-written spec is stale.** It came
  from the retired SkySpy WebSocket plan and its "10 batched frames per second".
  This app polls on a 30 s floor (`MIN_POLL_INTERVAL_MS`), so the store notifies
  about twice a minute. Keep the throttle - it is cheap, it is the documented
  architecture, and features 9 and 10 will drive extra updates - but do not
  justify it with a message rate this project does not have, and do not tune it
  as though frames were arriving continuously.
- **Branch name deviates from the pre-written spec**, which said
  `feature/07-aircraft-layer`. The configured rule is prefix plus title slug,
  and the shipped feature 6 branch was `feature/aircraft-store`. The archive
  path keeps the number: `blueprint/history/features/07-aircraft-layer.md`.
- MapLibre's `addImage` does not take an SVG URL. Load the SVG through an
  `Image` (or `createImageBitmap`) first, then add it. Size it once at a fixed
  pixel size; zoom-dependent sizing is feature 8.
- Missing `track` falls back to 0 rotation rather than dropping the aircraft.
- Aircraft will appear to jump rather than glide, because positions update once
  per poll. That is expected here. Interpolation is out of scope.
- Re-register the icon after a style change, not only on first load, or the
  layer renders nothing once the style is swapped.

## Open questions

1. **The 2000-aircraft load test in the pre-written spec cannot run as written.**
   `mock/server.mjs` replays `docs/fixtures/opensky-states-nl.json`, which holds
   **149 states**, and exposes only `MOCK_PORT` and `MOCK_CREDITS` - there is no
   aircraft-count knob. The fixed bounding box is roughly the Netherlands, so a
   few hundred is the realistic ceiling for this deployment anyway, and 2000 is
   not a load this app can encounter.

   Step 5 is therefore written as an honest observation at real scale. If you
   want a genuine scale test, that needs a synthetic-fleet knob in the mock
   (`/fix "mock feed cannot synthesise a large fleet"`), which is feature 4's
   surface rather than this feature's. **Decide before `/implement`:** accept the
   observation-only step, or run that `/fix` first.


<!-- blueprint:completion {"schemaVersion":1,"specBytes":11645,"specSha256":"d7da00f4866394d347d5b7c9d178d18363b44877c2f7c499781c3ca2883302ee","branch":"refs/heads/feature/aircraft-layer","head":"e567c8b3b54ed46c343fd69c865db67a78e2cfb1","baseRef":"refs/heads/master","baseCommit":"e567c8b3b54ed46c343fd69c865db67a78e2cfb1","sourceTree":"1d0dd43f322f48d6c6f5f69c247dc6a72d92ef64","absentOptional":[]} -->
