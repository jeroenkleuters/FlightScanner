# Feature: FR24-style visual pass

**From build-plan:** feature 08
**Build attempt:** 1
**Branch:** feature/08-visual-pass

Source: `blueprint/project-plan.md` §7.

## Goal

Make the map read as an aircraft tracker at a glance: dark receding basemap,
altitude-coloured aircraft, sensible sizing across zoom levels, callsign labels
where they help, and faded stale contacts.

## Design reference

Flightradar24. Borrowed: dark desaturated basemap, small bright plane
silhouettes, zoom-scaled icons, labels only when zoomed in.

**Not** borrowed: FR24 branding, logo, colour marks, icon artwork, or map tiles.
We match interaction patterns and general visual approach - common to aircraft
trackers - using our own assets and palette.

## In scope

- Dark basemap tuning: muted land and water, minimal labels
- Altitude → colour ramp with a legend
- Zoom-interpolated icon size
- Callsign labels above a zoom threshold
- Visibly faded stale aircraft

## Out of scope

- Selection styling and trails (feature 09)
- Per-type silhouettes and military colouring (feature 15, needs airframe data)
- Filtering or search

## Build loop

Implement all steps, then one review packet.

## Build steps

- [ ] **Tune the basemap.** Confirm or adjust the dark style so land and water
  are distinguishable but recessive, and place-label density is low. If the
  chosen style is too busy, either switch style URL or hide the noisiest label
  layers after style load.
  **Done when:** at typical zoom the map reads as a quiet dark background and
  nothing competes visually with aircraft.
- [ ] **Add the altitude colour ramp** in `aircraftStyle.ts`, interpolating
  `icon-color` (or picking among tinted icons) across roughly ground → FL100 →
  FL250 → FL400+. Aircraft with no `alt_baro` get a distinct neutral colour, not
  a colour implying an altitude.
  **Done when:** aircraft at different altitudes are visually distinguishable and
  altitude-less aircraft are clearly neither high nor low.
- [ ] **Add zoom-interpolated icon sizing** so icons stay legible when zoomed out
  without dominating when zoomed in.
  **Done when:** icons look proportionate across the full zoom range.
- [ ] **Add callsign labels above a zoom threshold,** offset from the icon, with
  a halo for legibility on the dark basemap, using the trimmed `flight` value.
  Labels may collide-hide; icons may not.
  **Done when:** labels appear only when zoomed in, are readable, and never
  obscure their own aircraft.
- [ ] **Fade stale aircraft.** Aircraft flagged `stale` by the store render at
  reduced opacity, so a frozen contact is visibly different from a live one.
  **Done when:** the mock's `--silent-after` flag makes the fleet visibly fade
  rather than silently freezing at full brightness.
- [ ] **Add a compact legend** for the altitude ramp, unobtrusive and
  non-blocking.
  **Done when:** the legend explains the colours and does not cover the map.
- [ ] **Compare against FR24 side by side** at a similar zoom and note remaining
  gaps.
  **Done when:** the comparison is done and differences are either fixed or
  recorded as follow-ups.

## Files / areas

- `src/map/aircraftStyle.ts` - ramp, sizing, label config
- `src/map/mapStyle.ts` - basemap tuning
- `src/ui/Legend.tsx`
- `src/assets/aircraft.svg`

## Data / contracts

`stale` comes from the store's staleness sweep (feature 06); this feature only
renders it.

Colour must not be the only signal for anything critical - stale is fade plus,
in feature 09, an explicit last-seen age in the panel.

Tile provider attribution stays visible. Confirm the provider's usage terms
during this feature, not at release.

## Testing

- Unit: the altitude → colour mapping function, including the no-altitude case
  and boundary values.
- Manual: zoom through the full range; trigger staleness with the mock; check
  label legibility on light and dark map areas.

## Notes for the AI

- This is styling on top of feature 07's layer. Do not restructure the layer or
  introduce a second source.
- Prefer MapLibre style expressions over recomputing styles in JS - expressions
  evaluate on the GPU and keep the throttled `setData` path cheap.
- Keep the palette in one exported object so feature 09's selection colour and
  feature 15's military colour extend it rather than hard-coding new values.
