# Feature: Selection, detail panel, and trail

**From build-plan:** feature 9
**Build attempt:** 1

**Status:** verified

**Branch:** `feature/selection-detail-panel-and-trail`

Primary source: `blueprint/context/features/09-selection-detail-trail-spec.md`,
corrected against the shipped store, layer, and aircraft type. Deviations are in
`Notes for the AI`.

## Goal

Click an aircraft and get the Flightradar24 moment: it highlights, the rest dim,
a trail draws behind it, and a side panel shows telemetry that updates as each
poll lands.

## Design reference

Flightradar24's selection interaction - highlight, fleet dim, growing trail,
detail sidebar, hover tooltip. Our own palette and assets; no FR24 branding,
artwork, or tiles.

## In scope

- Click an aircraft to select it; Esc, a click on empty map, or a visible close
  control deselects
- Selected aircraft highlighted, the rest dimmed, without losing feature 8's
  altitude ramp or stale fade
- A client-side trail for the selected aircraft only, drawn beneath the icons
- `AircraftDetailPanel` with telemetry that updates per poll
- An explicit signal-lost state when the selected aircraft is dropped or goes stale
- Hover tooltip with the callsign, and a pointer cursor over aircraft

## Out of scope

- Airframe identity, registration, operator, photo (features 12-14). The panel
  reserves a slot for them; it does not fetch or render them.
- Whole-fleet trails. Needs history the store does not keep, and multiplies
  render cost.
- Following or auto-centring on the selected aircraft.
- Interpolating positions between polls.
- Poll status surface and the "outside the covered box" state (feature 10).

## Build loop

Implement all steps, then one review packet. Step checkpoint commits are
disabled (`workflow.stepReview: "feature"`, `workflow.checkpointCommits:
"disabled"`). `/complete` makes the single feature commit.

If this turns out too large for one review, the seam is after step 4: the map
work (selection and trail) and the panel work split cleanly.

## Build steps

- [x] 1. **Add selection state and the ways out of it.**
  One `hex | null` in React state in `App.tsx` - selection changes rarely, unlike
  positions. Register a click handler on the aircraft layer through
  `map.on('click', AIRCRAFT_LAYER_ID, ...)` so `FlightMap`'s props do not change,
  a click on empty map that clears it, and an Esc key handler. Every listener is
  removed on unmount, and the whole thing survives StrictMode's double mount.
  **Done when:** unit tests prove clicking a feature selects its `hex`, clicking
  empty map clears it, Esc clears it, and unmount detaches every listener; and on
  the running map clicking an aircraft selects it.

- [x] 2. **Style the selection without discarding feature 8's encoding.**
  Add `promoteId: 'hex'` to the GeoJSON source and drive the styling from
  MapLibre feature state, set with `setFeatureState` when selection changes and
  cleared from the previous selection. The selected aircraft takes a distinct
  colour from `AIRCRAFT_PALETTE` and a larger icon; when anything is selected,
  the others drop opacity. The altitude ramp and the stale fade must both still
  apply to unselected aircraft, so these expressions **nest** rather than replace.
  **Done when:** unit tests cover selected and unselected, stale and live, at the
  same time; and on the running map the selection is unmistakable while the rest
  stay visible and still altitude-coloured.

- [x] 3. **Add `src/store/trailBuffer.ts`.**
  A ring buffer of positions for a single `hex`, capped at a named constant.
  Appends only when the position actually changed, ignores aircraft with no
  `lat`/`lon`, and is cleared - never merged - when the selection changes.
  Pure, no React and no map imports, per the store conventions.
  **Done when:** unit tests cover append, ignoring an unchanged position,
  ignoring a positionless aircraft, the cap discarding the oldest point, and
  clear-on-selection-change.

- [x] 4. **Add `src/map/TrailLayer.tsx`.**
  A line layer rendering the buffer as one LineString, mounted with
  `beforeId={AIRCRAFT_LAYER_ID}` so icons always sit above the trail. Renders
  nothing when there is no selection or fewer than two points.
  **Done when:** a unit test asserts the `beforeId` and the empty-selection case;
  and on the running map selecting an aircraft draws a trail that grows as polls
  land and disappears on deselect.

- [x] 5. **Add `src/ui/AircraftDetailPanel.tsx`.**
  Callsign, hex, altitude, ground speed, heading, squawk, vertical rate, and
  on-ground. **Every absent field renders an em dash, never a zero or a blank** -
  a missing squawk must not read as squawk 0, and `alt_baro: 0` is a real ground
  altitude that must still print as 0. An empty identity slot sits **above** the
  telemetry block, reserved for features 13-14, with fixed layout so adding it
  later causes no reflow. The panel is a labelled region with a visible close
  control.
  **Done when:** RTL tests cover every field present, every field absent showing
  dashes, the distinction between absent and zero, and the presence of the
  identity slot and the close control.

- [x] 6. **Keep the panel live, and say so when the contact is lost.**
  The panel re-reads the selected `hex` from the store on each notification. Two
  distinct states must be reachable and distinguishable: the store still holds
  the aircraft but has flagged it `stale`, and the store has dropped it entirely
  (`get(hex)` returns undefined after `DROP_AFTER_MS`). Neither may freeze on
  last values silently, and neither clears the selection on its own.
  **Done when:** unit tests drive a fake store through live, stale, and dropped
  for the same hex and assert a different, explicit panel state for each; and
  with the mock's `{"fault":"stale"}` the panel says so rather than looking live.

- [x] 7. **Add the hover tooltip and pointer cursor.**
  Hovering an aircraft shows its callsign and sets a pointer cursor; leaving
  restores the default. An aircraft with no callsign shows its `hex` rather than
  an empty tooltip.
  **Done when:** unit tests cover the callsign and the no-callsign fallback, and
  that the cursor is restored on mouseleave and on unmount.

## Verification state

`npm run verify` (typecheck, 398 tests in 26 files, build) and `npm run lint`
both pass. 56 tests were added.

Observed live against `npm run mock` and `npm run dev`, driving real mouse and
keyboard events through the devtools protocol and reading the running map:

| Clause | Result |
| --- | --- |
| Hover | Tooltip `DAL136`, canvas cursor `pointer` |
| Click | Panel appeared; `getFeatureState` on the aircraft returned `{selected: true}` |
| Panel telemetry | Hex `ab1d30`, squawk `7621`, on ground `Yes`, and em dashes for the altitude and vertical rate the aircraft did not report |
| Ticking age | `Last seen` advanced between captures |
| Trail | After two polls the line layer existed with 2 coordinates |
| Stale fault | Panel showed `Stale contact...` with the selection still active |
| Esc | Panel gone and the trail layer removed |
| Console | No errors on the final run |

### Two runtime defects the unit tests could not catch

Both were found only by loading the app, and both took the entire map down -
MapLibre rejects an invalid layout expression, which raises an error before
load, which puts `FlightMap` into its failure state.

1. `icon-size` was written as `['*', ['interpolate', ['zoom'], ...], ...]`.
   MapLibre requires `zoom` to be the **direct input of a top-level**
   `interpolate` or `step`.
2. The replacement still applied the selection factor per stop through
   `feature-state`. MapLibre does not support **feature state in any layout
   property**, only in paint.

The selected aircraft is therefore **not enlarged**, which deviates from build
step 2's "distinct colour and larger icon". Selection reads through colour and
opacity, both paint properties, and the live screenshot shows it is
unmistakable. Making the icon larger as well would need a second symbol layer
filtered to the selected hex, which contradicts this spec's own "one GeoJSON
symbol layer for the fleet" contract - a decision for the user, not a silent
improvisation.

Three tests now encode the two MapLibre rules by shape, since evaluating an
expression by hand cannot catch either. Reintroducing the first defect was
confirmed to fail the new guard.

### Two visual defects found in the screenshot

- The basemap's place labels read straight through the detail panel at 92%
  opacity. The panel is now opaque with a border.
- Unselected aircraft at 0.3 opacity all but vanished against the dark basemap,
  losing the context that makes the selection worth looking at. Raised to 0.45,
  with stale at 0.3.

## Files / areas

- `src/store/trailBuffer.ts` - new, pure ring buffer
- `src/test/styleExpression.ts` - taught `feature-state`, `boolean` and `*`, so
  the selection expressions are testable by result rather than by shape
- `src/map/TrailLayer.tsx` - new, the line layer
- `src/map/AircraftLayer.tsx` - click, hover, feature-state, `promoteId`
- `src/map/aircraftStyle.ts` - selection colour and the nested expressions
- `src/ui/AircraftDetailPanel.tsx` - new
- `src/App.tsx` - selection state, panel and trail mounting
- `src/index.css` - panel and tooltip layout
- Tests beside each new module

## Data / contracts

- **Selection is by `hex`**, the identity key everywhere else. It survives
  updates; when the aircraft is gone the panel shows signal-lost rather than
  clearing silently.
- **Styling uses `promoteId: 'hex'` plus feature state, not a `selected`
  property in the GeoJSON.** `toGeoJSON` is a pure projection over the store
  (feature 6) and must not learn about React selection state; adding a field
  there would couple the store to the UI and force a full `setData` on every
  click.
- **The ticking age uses `lastSeen`, not `lastContact`.** `lastSeen` is
  client-recorded milliseconds, so counting up against `Date.now()` compares one
  clock with itself. `lastContact` is OpenSky's clock, and the store deliberately
  only ever compares it against `snapshot.time`. Mixing the two would show
  nonsense whenever the viewer's clock is off. Fix age therefore comes from the
  store's `stale` flag, not from arithmetic in the panel.
- **`distance_nm` is not a panel field.** `src/types/aircraft.ts` records that
  OpenSky has no equivalent, so it can never populate; a permanently dashed row
  would be a lie about the data source. The pre-written spec listed it.
- **The trail is client-side only.** OpenSky returns no position history, so it
  starts empty at selection and grows from that moment. The UI must not present
  it as the flight's full track.
- **Panel layout is a contract with features 13-14:** identity block above,
  telemetry below, fixed height so adding identity does not reflow the page.
- Callsigns come from an external source and are rendered as text through React,
  which escapes them. No `dangerouslySetInnerHTML` anywhere in this feature.
- One GeoJSON symbol layer for the fleet still stands. The trail adds a second
  source and a line layer; it does not touch the fleet's.

## Testing

The test gate is on. jsdom has no WebGL, so map interaction is tested through
the same `react-map-gl/maplibre` mock `AircraftLayer.test.tsx` already uses, and
expressions are tested as data with `src/test/styleExpression.ts`.

- `trailBuffer`: append, unchanged position, positionless aircraft, ring cap,
  clear on selection change.
- `aircraftStyle`: the nested selection expressions evaluated for the four
  combinations of selected/unselected and stale/live.
- `AircraftLayer`: click selects, empty-map click clears, Esc clears, feature
  state set and the previous one cleared, listeners detached on unmount.
- `AircraftDetailPanel`: every field, absent versus zero, identity slot, close
  control, and the three lifecycle states.
- `TrailLayer`: `beforeId`, and nothing rendered without a selection.
- Manual: select, watch the trail grow across polls, deselect, confirm it clears;
  toggle the mock's stale fault with a selection active.

## Notes for the AI

- Selection state belongs in React; positions do not. Do not move the aircraft
  store into React state to make selection easier.
- The trail buffer is cleared on selection change, never merged. A trail that
  jumps between two aircraft is a confusing bug, not a feature.
- Feature 8's `icon-color`, `icon-opacity` and `icon-size` are already
  expressions built from `AIRCRAFT_PALETTE`. Extend the palette with the
  selection colour rather than hard-coding a new hex, the way that feature's own
  notes require.
- `map.on('click', layerId, handler)` scopes the handler to the aircraft layer,
  so `FlightMap` keeps its current props and no `interactiveLayerIds` plumbing is
  needed. A second, unscoped click handler handles the deselect-on-empty-map case.
- Re-register anything attached to the map after a style change, the way
  feature 7 re-registers its icon: a style swap drops layers, handlers and
  feature state alike.
- The mock can drive both lost-contact states: `{"fault":"stale"}` backdates every
  contact past the 60 s threshold, and stopping the mock entirely makes the store
  drop aircraft after `DROP_AFTER_MS`.


<!-- blueprint:completion {"schemaVersion":1,"specBytes":13583,"specSha256":"63d48c7a0012003d22dfa3151b2465518c386b0a9a440de38eaf6807bb4e03e1","branch":"refs/heads/feature/selection-detail-panel-and-trail","head":"63cb82ca086947258029f95ef4c5451e17559b5e","baseRef":"refs/heads/master","baseCommit":"63cb82ca086947258029f95ef4c5451e17559b5e","sourceTree":"5190770bcebad84a50cdbb83816c5110fd97deb8","absentOptional":[]} -->
