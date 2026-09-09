# Feature: Map shell

**From build-plan:** feature 2
**Build attempt:** 1
**Branch:** feature/map-shell
**Status:** verified

Primary source: `blueprint/context/features/02-map-shell-spec.md`. Wider context:
`docs/flight-map-plan.md` section 6 step 2, section 8 risk 8.

## Goal

A full-viewport, pannable, zoomable dark map centred on the configured location -
the canvas every later feature draws onto.

## Design reference

Flightradar24's basemap: dark, desaturated, terrain and roads receding so
aircraft can pop against it. Land and water are distinguishable but muted, labels
minimal. See `docs/flight-map-plan.md` section 1 "UX reference" and the UI/UX
section of `blueprint/context/project-overview.md`.

Borrowed: the general visual approach, common to aircraft trackers. Not borrowed:
FR24 branding, logo, colour marks, icon artwork, or map tiles.

## In scope

- `maplibre-gl` and `react-map-gl` installed, MapLibre CSS imported once
- Dark basemap from the configurable, keyless style URL already in config
- Full-viewport map centred and zoomed from config, no page scrollbars
- Navigation (zoom) control, bottom-right
- Visible basemap attribution
- A style-load failure state instead of a blank page

## Out of scope

- Aircraft markers, layers, sources, or data of any kind (features 6 and 7)
- Any WebSocket or REST call (features 3, 5, 10)
- Detail panels, selection, trails, overlays (feature 9)
- Altitude colour ramps, icon artwork, labels, legend (features 7 and 8)
- Geolocation, saved viewport, or any persisted map state. Nothing in the plans
  asks for it and nothing may be added on guess.
- A retry button on the failure state. Feature 10 owns manual reconnect; a
  browser reload is the recovery here.

## Build loop

`workflow.stepReview: "feature"` - implement every step, verify each with the
narrowest useful check, then present one feature-level review packet with the
complete diff and done-when evidence.

`workflow.checkpointCommits: "disabled"` - no per-step commits. `/complete`
creates the single feature commit.

## Build steps

- [x] **Install `maplibre-gl` and `react-map-gl`, import the CSS once.** Add both
  as runtime dependencies. Import `maplibre-gl/dist/maplibre-gl.css` exactly once
  in `src/main.tsx`, **before** `./index.css`, so project styles win on conflict.
  `react-map-gl` declares `mapbox-gl` as a peer alongside `maplibre-gl`; confirm
  from the actual install output whether npm treats it as optional. **Do not
  install `mapbox-gl`** - this project is MapLibre only. If the install genuinely
  cannot resolve without it, stop and report rather than adding it.
  **Done when:** `npm install` completes and its peer-dependency output is
  recorded verbatim in the review packet, `npm run verify` passes, and
  `maplibre-gl/dist/maplibre-gl.css` is imported in exactly one file.

- [x] **Move the default style URL into `src/map/mapStyle.ts`.** Feature 1 already
  defines `DEFAULT_MAP_STYLE_URL` in `src/config.ts`. Do not create a second copy.
  Move the constant to `src/map/mapStyle.ts`, add the provider and attribution
  comment described under Data / contracts, and have `src/config.ts` import it.
  `config.ts` stays the only module that reads `import.meta.env`; `mapStyle.ts`
  reads no environment at all.
  **Done when:** `DEFAULT_MAP_STYLE_URL` is declared in exactly one file
  (`grep -rn "DEFAULT_MAP_STYLE_URL" src` shows one declaration plus imports),
  the existing `config.test.ts` default-style assertion still passes unchanged,
  and `npm run verify` passes.

- [x] **Add the pure map-status reducer and its tests.** In `src/map/mapStatus.ts`
  define the `MapStatus` union and `nextMapStatus(current, event)` exactly as
  frozen under Data / contracts. It is pure, has no MapLibre import, and is the
  single place that decides whether an error is fatal.
  **Done when:** `npm test` passes with focused tests covering every transition
  in the Data / contracts table, including the case that proves a tile error
  arriving after `load` leaves the status `ready`.

- [x] **Add `src/map/FlightMap.tsx` and render it from `App`.** A full-viewport
  map from `react-map-gl/maplibre`, with `initialViewState` built from `config`
  by the pure `toInitialViewState` helper (also in `FlightMap.tsx`, exported for
  test). Wire `onLoad` and `onError` through `nextMapStatus`. Render `children`
  so later features can mount sources and layers inside it. `App` renders
  `<FlightMap />` filling the existing `.app-shell`.
  **Done when:** a dark map fills the browser window and pans and zooms smoothly
  at 1280x800 and at a narrow mobile width, with no page scrollbars at either
  size; a hard reload shows the dark ground, never a white flash; `npm run verify`
  passes.

- [x] **Add the navigation control and visible attribution.** `NavigationControl`
  at `bottom-right`. Leave `react-map-gl`'s default attribution control enabled
  and never pass `attributionControl={false}`; the basemap's licence requires the
  credit to stay visible.
  **Done when:** the zoom-in, zoom-out, and compass buttons change the view; the
  OpenStreetMap and CARTO attribution is readable over the map; and the map
  renders with no API key of any kind present in `.env`.

- [x] **Add the style-load failure state.** When `status` is `failed`, render the
  message described under Data / contracts over the dark background instead of
  the map. Log the underlying error to the console once for diagnosis.
  **Done when:** pointing `VITE_MAP_STYLE_URL` at a valid-but-unreachable https
  URL shows the readable failure message rather than a blank or white screen,
  and the app still starts (config validation accepts any absolute https URL, so
  this is a runtime failure, not a startup error).

## Files / areas

Created:

- `src/map/FlightMap.tsx` - the map component, exports `toInitialViewState`
- `src/map/mapStyle.ts` - default style URL constant and provider record
- `src/map/mapStatus.ts` - `MapStatus` union and `nextMapStatus`
- `src/map/mapStatus.test.ts`, `src/map/FlightMap.test.tsx`

Edited:

- `src/App.tsx` - render `<FlightMap />`
- `src/main.tsx` - one MapLibre CSS import
- `src/config.ts` - import `DEFAULT_MAP_STYLE_URL` instead of declaring it
- `src/index.css` - only if the map container needs a rule; the existing
  `html, body, #root { height: 100% }`, `body { overflow: hidden }`, and
  `.app-shell` sizing already give a full viewport with no scrollbars. Do not
  weaken those rules.
- `package.json`, `package-lock.json`

Untouched: `blueprint/`, `.claude/`, `.agents/`, `docs/`, `AGENTS.md`,
`CLAUDE.md`, `ONBOARDING.md`, `src/config.test.ts` (its existing assertions must
keep passing as written).

## Data / contracts

No external data. Two internal contracts are frozen here because later features
depend on them.

**Map instance access for later features.** `FlightMap` renders `react-map-gl`'s
`<Map>` and passes its own `children` straight through. Features 7, 8, and 9
mount `<Source>` and `<Layer>` as children of `<FlightMap>` and reach the map
through `react-map-gl`'s own context, not a custom context or a forwarded ref.
No bespoke map context is created in this feature.

**Style URL and attribution.** `src/map/mapStyle.ts` holds:

- `DEFAULT_MAP_STYLE_URL = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'`
- A comment recording: provider CARTO (Dark Matter), keyless, and that the style
  supplies the mandatory OpenStreetMap and CARTO attribution which must remain
  visible. Per `docs/flight-map-plan.md` section 8 risk 8, confirm the provider's
  attribution and usage terms now, while choosing it, and record the outcome in
  the review packet. Public deployment terms are a `/release` concern.

**Map status.** `type MapStatus = 'loading' | 'ready' | 'failed'`, initial
`'loading'`. `nextMapStatus(current, event)` where `event` is `'load'` or
`'error'`:

| Current | Event | Next | Why |
| --- | --- | --- | --- |
| `loading` | `load` | `ready` | Style parsed and the first frame rendered |
| `loading` | `error` | `failed` | The style never loaded, so there is nothing to show |
| `ready` | `error` | `ready` | A tile or sprite error after load must not blank a working map |
| `ready` | `load` | `ready` | Idempotent; a style reload is not a regression |
| `failed` | `load` | `ready` | A late success recovers |
| `failed` | `error` | `failed` | Stays failed |

This is the only place an error is classified. Unexpected errors are not
swallowed anywhere else in the feature.

**Failure message.** Rendered in a container with `role="alert"`, on the existing
dark background, in readable body-size text:

> Could not load the map basemap. Check `VITE_MAP_STYLE_URL` and your network
> connection, then reload the page.

The message names the variable, never a token, and never interpolates
user-supplied text into markup. The underlying error object is logged to the
console once, not shown.

**Loading state.** `loading` renders the dark background with no map and no
spinner. The dark ground is painted by existing CSS from the first frame, so
there is never a white flash. No additional loading UI is in scope.

## Testing

The test gate is ON (`test` is declared in `AGENTS.md`). jsdom has no WebGL, so
MapLibre cannot actually render in a test.

`src/map/mapStatus.test.ts` - the whole transition table above, one case per row.
This is the feature's real logic and it is pure, so it needs no mock.

`src/map/FlightMap.test.tsx` - `vi.mock('react-map-gl/maplibre')` replacing `Map`,
`NavigationControl`, and any other import with simple stubs, then:

- `toInitialViewState` maps `config.defaultCenter` and `config.defaultZoom` to the
  `longitude`, `latitude`, `zoom` shape react-map-gl expects, with longitude from
  `lon` and latitude from `lat`. Test this pure function directly, without
  rendering, so the axis order can never silently swap.
- With the mock in place, `FlightMap` renders without crashing and passes the
  style URL and initial view state through.
- When status is `failed`, the alert message renders and the map does not.

Not tested: actual map rendering, panning, zooming, tile loading, and the
attribution's visual placement. Those are WebGL behaviour. They are covered by
the manual done-when checks in the build steps, and no build step may claim them
from build output alone.

## Notes for the AI

- Import from `react-map-gl/maplibre`, not the package root. The root entry
  targets Mapbox.
- Import `maplibre-gl/dist/maplibre-gl.css` exactly once, in `src/main.tsx`,
  before `./index.css`.
- Do not add per-aircraft React components or DOM markers anywhere in this
  feature. Aircraft become one GeoJSON symbol layer in feature 7; a marker
  pattern established here would have to be torn out.
- Components must survive React StrictMode double-mounting without leaking a map
  instance, control, or event handler. `react-map-gl` owns that lifecycle when
  the map is expressed as JSX; do not add manual `new maplibregl.Map()` calls or
  imperative `addControl` in an effect.
- Do not disable the attribution control.
- `src/config.ts` stays the only module reading `import.meta.env`.
- No em dashes in generated content, per the Writing section of
  `coding-standards.md`. Use a hyphen for `term - description`.
- Do not start a dev server from a skill. The pan, zoom, resize, attribution, and
  failure-state done-whens need a running app, so hand them to the user with
  exact steps rather than claiming them.

## Notes on this spec

Two deliberate departures from `blueprint/context/features/02-map-shell-spec.md`,
both recorded here so review can reject them:

1. **Branch is `feature/map-shell`, not `feature/02-map-shell`.** The Feature
   skill derives the branch from the configured prefix plus the title slug, which
   is also what feature 1 used (`feature/project-scaffold`). The archive path
   still carries the number as `02-map-shell.md`.
2. **`mapStyle.ts` takes the constant from `config.ts` rather than adding a
   second one.** The pre-written spec was authored before feature 1 shipped
   `DEFAULT_MAP_STYLE_URL`. Two copies of a style URL is a defect, so the
   constant moves rather than duplicating.

## Implementation notes

Recorded during `/implement`. Three departures from the spec as written, each
forced by a check rather than chosen:

1. **`toInitialViewState` lives in `src/map/viewState.ts`, not `FlightMap.tsx`.**
   The spec put it in the component file "exported for test". ESLint's
   `react-refresh/only-export-components` rejects a non-component export from a
   component file. Moving it satisfies the rule and keeps the function directly
   testable without a mock.
2. **`vite.config.ts` now pins every `VITE_` variable under `test.env`, not just
   the two required ones.** Vite loads the developer's local `.env` in test mode,
   so `FlightMap`'s initial-view-state assertion was reading the real
   `VITE_DEFAULT_CENTER` and failing. Tests must not depend on a gitignored file.
3. **Added `src/test/setup.ts` running React Testing Library's `cleanup`.** The
   suite runs without Vitest globals, so RTL's automatic cleanup never
   registered and rendered trees leaked between tests in one file, producing
   "found multiple elements". This is test infrastructure the whole project now
   inherits.

Known limitation, honestly stated: the `failed -> load -> ready` transition in
the Data / contracts table is unreachable at runtime today, because the failure
branch unmounts the map and no further `load` event can arrive. The reducer keeps
the row because it is pure, tested, and costs nothing, and a future retry
affordance (feature 10 territory) would need it.


<!-- blueprint:completion {"schemaVersion":1,"specBytes":13676,"specSha256":"5332919aadd3bd8a304516ac538671370f4621c5064d7bad6d80a6c4a5e1dd53","branch":"refs/heads/feature/map-shell","head":"d925c0d0961d1b0fb75262219a99b80e72ac92fb","baseRef":"refs/heads/master","baseCommit":"d925c0d0961d1b0fb75262219a99b80e72ac92fb","sourceTree":"3f2498b1e83fc3072447f0ccbe89739436021d17","absentOptional":[]} -->
