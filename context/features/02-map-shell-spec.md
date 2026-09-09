# Feature: Map shell

**From build-plan:** feature 02
**Build attempt:** 1
**Branch:** feature/02-map-shell

Source: `docs/flight-map-plan.md` §6 Step 2.

## Goal

A full-viewport, pannable, zoomable dark map, centred on the configured location
- the canvas every later feature draws onto.

## Design reference

Flightradar24's basemap: dark, desaturated, terrain and roads receding so
aircraft can pop against it. Land and water are distinguishable but muted;
labels are minimal. See `docs/flight-map-plan.md` §1 "UX reference".

## In scope

- MapLibre GL JS via `react-map-gl`, filling the viewport
- Dark basemap from a configurable, keyless style URL
- Default centre and zoom from config
- Zoom controls and attribution

## Out of scope

- Aircraft markers, layers, or data of any kind
- WebSocket or REST calls
- Detail panels or overlays

## Build loop

Implement all steps, then one review packet. No checkpoint commits.

## Build steps

- [ ] **Install `maplibre-gl` and `react-map-gl`,** importing MapLibre's CSS
  once at the app root.
  **Done when:** the app builds with both installed and no CSS warnings.
- [ ] **Add `map/FlightMap.tsx`** rendering a full-viewport map from
  `VITE_MAP_STYLE_URL`, `VITE_DEFAULT_CENTER`, `VITE_DEFAULT_ZOOM`. The map
  fills the window with no page scrollbars at any viewport size.
  **Done when:** a dark map fills the browser window and pans and zooms
  smoothly, with no scrollbars.
- [ ] **Add `map/mapStyle.ts`** holding the default style URL constant and a
  short comment recording the chosen provider and its attribution requirement.
  Default to a keyless dark style (CARTO Dark Matter or equivalent).
  **Done when:** the map renders with no API key present in `.env`, and required
  attribution is visible on the map.
- [ ] **Add navigation control and handle style-load failure.** Zoom buttons
  bottom-right. If the style URL fails to load, show a readable message over a
  plain background instead of a blank white page.
  **Done when:** zoom controls work, and pointing `VITE_MAP_STYLE_URL` at a bad
  URL shows the message rather than a blank screen.

## Files / areas

- `src/map/FlightMap.tsx`, `src/map/mapStyle.ts`
- `src/App.tsx`, `src/index.css`

## Data / contracts

None - no external data yet. The map instance must be reachable by later
features (via `react-map-gl` ref or context) so layers can attach to it.

## Testing

- `FlightMap` renders without crashing given valid config (jsdom cannot render
  WebGL, so assert the container and props, not map output).
- Manual: pan, zoom, and resize the window.

## Notes for the AI

- Import `maplibre-gl/dist/maplibre-gl.css` exactly once, at the app root.
- Do not add per-aircraft React components anywhere in this feature. Aircraft
  render as a single GeoJSON symbol layer in feature 07; establishing a DOM
  marker pattern here would have to be torn out.
- Verify the tile provider's attribution and usage terms now, while choosing it -
  not at release. See `docs/flight-map-plan.md` §8 risk 8.
