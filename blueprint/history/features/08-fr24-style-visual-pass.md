# Feature: FR24-style visual pass

**From build-plan:** feature 8
**Build attempt:** 1

**Status:** verified

**Branch:** `feature/fr24-style-visual-pass`

Primary source: `blueprint/context/features/08-visual-pass-spec.md`, corrected
against the shipped layer, store, and mock. Deviations are in `Notes for the AI`.

## Goal

Make the map read as an aircraft tracker at a glance: altitude-coloured
aircraft, sensible sizing across zoom, callsign labels where they help, faded
stale contacts, and a legend that says what the colours mean.

## Design reference

Flightradar24. Borrowed: small bright plane silhouettes on a dark recessive
basemap, zoom-scaled icons, labels only when zoomed in, altitude as colour.

**Not** borrowed: FR24 branding, logo, colour marks, icon artwork, or map tiles.
This matches interaction patterns common to aircraft trackers, using our own
assets and palette.

## In scope

- Altitude to colour ramp on the existing symbol layer, with a distinct neutral
  for aircraft that report no altitude
- Zoom-interpolated icon size
- Callsign labels above a zoom threshold, which may collide-hide while icons
  never do
- Visibly faded stale aircraft
- A compact, non-blocking altitude legend
- Basemap tuning, only if the current style actually competes with the aircraft

## Out of scope

- Selection styling, dimming the rest of the fleet, and trails (feature 9)
- Poll status surface, stale-snapshot warning, manual refresh (feature 10)
- Per-type silhouettes and military colouring (feature 15, needs airframe data)
- Filtering, search, or any new data source
- Restructuring feature 7's layer or adding a second source

## Build loop

Implement all steps, then one review packet. Step checkpoint commits are
disabled (`workflow.stepReview: "feature"`, `workflow.checkpointCommits:
"disabled"`). `/complete` makes the single feature commit.

## Build steps

- [x] 1. **Add the altitude colour ramp.**
  Replace feature 7's flat `aircraftPaint['icon-color']` with an
  `interpolate` expression over `alt_baro` **in feet**, and export the stops as
  one named palette object so features 9 and 15 extend it rather than inventing
  values. Aircraft with no `alt_baro` take a neutral grey that reads as neither
  high nor low - reachable through the same `coalesce`-style guard the rotation
  uses, because the key is absent rather than null.
  **Done when:** unit tests cover each stop, both ends of the range, a value
  between two stops, a negative altitude, and the no-altitude case; and on the
  running map aircraft at different altitudes are visibly different colours
  while altitude-less ones are clearly neutral.

- [x] 2. **Add zoom-interpolated icon sizing.**
  `icon-size` interpolated across the usable zoom range so icons stay findable
  when zoomed out without dominating when zoomed in. Feature 7 shipped a fixed
  size that is visibly too large at zoom 7.
  **Done when:** a unit test covers the size expression's stops, and zooming
  from the default out and in keeps icons proportionate rather than swamping the
  map at low zoom.

- [x] 3. **Add callsign labels above a zoom threshold.**
  Add `text-field` to the **same** symbol layer, reading the trimmed `flight`
  value, offset clear of the icon, with a halo for legibility. Set
  `text-optional: true`, and keep the label's own overlap settings at their
  defaults so labels collide-hide.
  **Done when:** a unit test asserts `text-optional` is true and that the label
  falls back to no text when `flight` is absent; and on the running map labels
  appear only above the threshold, never obscure their own aircraft, and an
  aircraft whose label is suppressed still draws its icon.

- [x] 4. **Fade stale aircraft.**
  Drive `icon-opacity` (and the text equivalent) from the feature's `stale`
  property so a frozen contact is visibly dimmer than a live one. Fade is the
  visual signal here; feature 9 adds the explicit last-seen age, so colour and
  opacity are never the only channel in the finished product.
  **Done when:** a unit test covers both opacity values; and with the mock's
  stale fault on (below), the fleet visibly dims, then returns to full strength
  when the fault is turned off.

- [x] 5. **Add the altitude legend.**
  `src/ui/Legend.tsx`, the first file in `src/ui/`. Compact, positioned so it
  does not cover the map or collide with the existing `.poll-readout` at top
  left, and `pointer-events: none` so it never eats a map drag or a future
  feature 9 click. It must label the ramp with **altitude figures, not just
  swatches**, so the encoding is readable without relying on colour alone.
  **Done when:** a unit test renders it and asserts each ramp stop appears with
  its altitude text; and on the running map it explains the colours without
  blocking the map or the readout.

- [x] 6. **Tune the basemap, only if it actually competes.**
  Judge the CARTO Dark Matter style against the finished aircraft, not in the
  abstract. If it is too busy, prefer pointing `VITE_MAP_STYLE_URL` at a quieter
  style over hiding layers by id: `config.mapStyleUrl` is user-overridable, so
  hard-coded CARTO layer ids break for anyone running a different style. If
  layers are hidden anyway, guard on the layer existing and re-apply after a
  style change, the way feature 7 re-registers its icon.
  **Done when:** either a recorded decision that no change is needed, or the
  change is made and the map reads as a quiet background behind the aircraft.

- [ ] 7. **Compare against Flightradar24 and record the gaps.**
  This one is yours, not the agent's: open FR24 at a similar area and zoom and
  note what still differs.
  **Done when:** the user has done the comparison and each difference is either
  fixed in this feature or written down as a follow-up. The agent must not claim
  this step.

## Verification state

`npm run verify` (typecheck, 338 tests in 23 files, build) and `npm run lint`
both pass. Observed live against `npm run mock` and `npm run dev`, by reading
the running map and capturing its canvas:

| Step | Evidence |
| --- | --- |
| 1 ramp | Aircraft render in blue gradations with the grey neutral clustered at Schiphol, where the fixture's ground traffic reports no altitude |
| 2 sizing | Proportionate at zoom 7 and zoom 10, against feature 7's fixed size 1, which covered a province |
| 3 labels | None below zoom 8; at zoom 10 KLM1944, UAL947, SXS1729, TRA41Q, DAL136 and others draw offset below their icon with a halo |
| 4 stale fade | `POST /__mock/control {"fault":"stale"}` put all 23 aircraft in the box into `stale`, and icons and labels dimmed together; restored on `{"fault":"off"}` |
| 5 legend | Bottom left, five rows with figures, clear of the readout, the navigation control and the attribution |
| 6 basemap | **No change needed.** Judged against the finished aircraft: Dark Matter's land, water and place labels stay recessive and the fleet is plainly the foreground |
| console | No errors and no exceptions across every run |

**Step 7 was not done, and its box is deliberately left unchecked.** The
Flightradar24 side-by-side needs a person with FR24 open, and the agent must not
claim it. The user chose to complete the feature without it, so it is waived
rather than satisfied. Carried forward as a follow-up: if a later comparison
turns up gaps, they belong in feature 11's polish pass or an ad-hoc `/fix`, not
in a rewritten history of this one.

### A correction to feature 7's archive

That archive records "software WebGL does not draw the basemap's vector layers"
and treats screenshots as useless here. That was wrong. The blank rasters came
from Chrome's `--screenshot` command-line path; the same browser driven over
the devtools protocol captures the basemap, the aircraft and the labels
correctly. Real visual evidence was available for feature 7 and was not taken.
The archive is immutable history and is left as written; this is the correction.

## Files / areas

- `src/map/aircraftStyle.ts` - palette, ramp, sizing, label and opacity config
- `src/map/AircraftLayer.tsx` - unchanged: it already passes `aircraftLayout`
  and `aircraftPaint` straight through
- `src/test/styleExpression.ts` - new test helper evaluating the MapLibre
  expression forms this project uses, so the ramp is tested by the colour a
  given altitude produces rather than by the shape of an array
- `src/ui/Legend.tsx` - new, plus `src/ui/` itself
- `src/App.tsx` - mounts the legend outside the map
- `src/index.css` - legend positioning
- `src/map/mapStyle.ts` - only if step 6 changes the basemap
- Tests beside each changed module

## Data / contracts

- **`alt_baro` is in feet.** `src/api/opensky.ts:94` decodes OpenSky's metres
  through `METRES_TO_FEET`, so ramp stops are written in feet and flight levels
  mean what they say. Getting this backwards would produce a ramp that looks
  plausible and is wrong everywhere.
- **Proposed stops**, adjustable at review: ground, 10,000 ft, 25,000 ft, and
  40,000 ft and above, warm through cool, plus one neutral grey for absent
  altitude. The committed fixture spans roughly -200 ft to 41,000 ft, so every
  stop is exercisable, and **negative altitudes occur** - the expression must
  clamp at the low stop rather than extrapolate past it.
- **32 of the 149 fixture aircraft report no barometric altitude**, and 32 are
  on the ground, so the neutral case is not hypothetical.
- `toGeoJSON` omits absent optionals rather than writing null, so both
  `alt_baro` and `flight` may be **missing keys**. Every expression reading them
  must handle absence explicitly, as `icon-rotate` already does for `track`.
- `stale` is set by the store's sweep (feature 6, `STALE_AFTER_SECONDS = 60`).
  This feature only renders it.
- One source, one symbol layer. Icon, label, colour, size, and opacity are all
  properties of the layer feature 7 added.
- Prefer MapLibre expressions over recomputing style in JS. They evaluate on the
  GPU and keep the throttled `setData` path cheap.
- Tile provider attribution stays visible; never pass `attributionControl={false}`.
  Confirming CARTO's usage terms belongs to `/release`, not here.

## Testing

The test gate is on. jsdom has no WebGL, so every expression is unit tested as
data and the rendering is confirmed by eye.

- `aircraftStyle.ts`: the colour ramp's stops, interpolation between them, the
  negative and no-altitude cases; the size expression's stops; `text-optional`
  and the absent-`flight` fallback; both stale opacity values.
- `Legend.tsx`: renders every ramp stop with its altitude text, and reads its
  colours from the exported palette rather than repeating hex values.
- Manual: zoom through the range; toggle the stale fault; check label legibility
  over both land and water.

## Notes for the AI

- **The pre-written spec's `--silent-after` mock flag does not exist.** The real
  control is `POST http://127.0.0.1:8787/__mock/control` with
  `{"fault":"stale"}`, which backdates every contact time by 600 s, well past
  the store's 60 s threshold. `{"fault":"off"}` restores it. Note the limitation
  honestly: the fault is all-or-nothing, so it shows *all* stale or *none*, never
  a mixed fleet. Judge the fade by toggling, not by hunting for a mix.
- **Drop the pre-written spec's "or picking among tinted icons" alternative.**
  Feature 7 registered the icon SDF precisely so `icon-color` works; a second
  tinted-image mechanism would mean re-registering images for no gain.
- **Branch name deviates** from the pre-written `feature/08-visual-pass`, for the
  same reason as feature 7: the configured rule is prefix plus title slug. The
  archive keeps the number: `08-fr24-style-visual-pass.md`.
- Feature 7 left `aircraftPaint` as a single flat `icon-color` specifically as
  the seam for step 1. Replace it; do not add a parallel mechanism.
- When choosing the actual ramp colours, load the `dataviz` skill first - it
  covers sequential palettes and legends, including contrast and colourblind
  safety, which matters here because altitude is encoded in colour alone on the
  map itself.
- Labels are the one thing allowed to disappear under collision. Icons are not,
  and `text-optional: true` is what keeps a suppressed label from taking its
  icon with it.


<!-- blueprint:completion {"schemaVersion":1,"specBytes":12478,"specSha256":"10a8bc54c1ec03025b891a5336e7dffa4eed367e0a3802b287071a5ca36cb7b1","branch":"refs/heads/feature/fr24-style-visual-pass","head":"b2414d7a54ef5d5d31a155a3192dd1373c1212a4","baseRef":"refs/heads/master","baseCommit":"b2414d7a54ef5d5d31a155a3192dd1373c1212a4","sourceTree":"4a5d44aa61c2c76b908e52517aa1d62517e07ac2","absentOptional":[]} -->
