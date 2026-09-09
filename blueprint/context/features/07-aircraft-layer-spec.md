# Feature: Aircraft layer

**From build-plan:** feature 07
**Build attempt:** 1
**Branch:** feature/07-aircraft-layer

Source: `docs/flight-map-plan.md` §6 Step 7 and §5 Data flow.

## Goal

Aircraft from the store appear on the map as rotated plane icons and move
smoothly as updates stream in - the first moment the app does what it exists to
do.

## In scope

- A GeoJSON source and symbol layer holding all aircraft
- Icon rotation from `track`
- Throttled `setData()` at ~4 Hz via `requestAnimationFrame`
- A plane icon registered with the map
- Load verification at high aircraft counts

## Out of scope

- Colour ramps, zoom sizing, labels, legend (feature 08)
- Selection, trails, panels (feature 09)
- Per-aircraft React components - explicitly excluded, see Notes

## Build loop

Implement all steps, then one review packet.

## Build steps

- [ ] **Add a plane icon to the map.** An SVG plane silhouette, nose pointing up
  at 0°, loaded as an image and registered with the map on style load. Register
  before the layer is added, and re-register after any style change.
  **Done when:** the icon is available and a test point renders it.
- [ ] **Add `map/AircraftLayer.tsx`** with a GeoJSON source and a symbol layer
  using the registered icon, `icon-rotate` bound to the feature's `track`, and
  `icon-rotation-alignment: map` and `icon-allow-overlap: true` so aircraft point
  correctly and are never hidden by collision.
  **Done when:** aircraft from a static store snapshot appear at correct
  positions, each rotated to its heading.
- [ ] **Wire the store to the layer with a throttled update loop.** Subscribe to
  the store; on change, schedule a `requestAnimationFrame` update capped at ~4 Hz
  that calls `toGeoJSON()` and `source.setData()`. Coalesce multiple store
  changes within a frame into one `setData`. The server may deliver up to 10
  batched frames per second - updating per message would burn frames redrawing
  faster than anyone can see.
  **Done when:** with the mock running, aircraft visibly fly across the map, and
  `setData` is called at most ~4 times per second regardless of message rate.
- [ ] **Cancel cleanly on unmount.** Cancel any pending animation frame,
  unsubscribe from the store, and remove the layer and source.
  **Done when:** unmounting leaves no pending frame callback and no map layer,
  and remounting works.
- [ ] **Load-test at scale.** Run the mock with 2000 aircraft and confirm the map
  stays interactive.
  **Done when:** panning and zooming remain smooth with 2000 aircraft; if not,
  record measured numbers and the bottleneck before optimising.

## Files / areas

- `src/map/AircraftLayer.tsx`, `src/map/aircraftStyle.ts` (icon + layer config)
- `src/assets/aircraft.svg`
- `src/map/FlightMap.tsx` - mounts the layer

## Data / contracts

Aircraft render as **one GeoJSON symbol layer**, never as individual markers or
React components. This is the single most important performance decision in the
project: MapLibre draws the whole layer on the GPU in one pass, while DOM
markers cost a node and a React reconciliation each.

Feature properties come from `toGeoJSON()` in feature 06: `hex`, `flight`,
`alt_baro`, `gs`, `track`, `stale`.

Marker movement must never pass through React's render path. React re-renders in
this app are reserved for connection status, selection, and counts.

## Testing

- `toGeoJSON` → layer property mapping (unit, no WebGL).
- Throttle logic extracted into a testable function: N store changes in one
  window produce exactly one update.
- Manual: mock running, aircraft move, headings look correct against `track`.
- Manual: 2000-aircraft load test.

## Notes for the AI

- jsdom cannot render WebGL, so the map itself is manually verified. Extract the
  throttle and the GeoJSON projection into pure functions so the logic is unit
  tested even though the rendering is not.
- Missing `track` should fall back to 0 rotation rather than dropping the
  aircraft.
- If aircraft appear to jump rather than glide, that is expected at this stage -
  positions update at the server's rate. Do not add interpolation here; it is not
  in scope and would complicate feature 09's trail.
