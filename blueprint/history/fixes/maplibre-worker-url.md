# Fix: MapLibre worker URL never resolves, so the basemap never renders

**Type:** Fix

**Status:** verified

**Branch:** `fix/maplibre-worker-url`

## The problem

The app mounts, the map container, zoom buttons and the CARTO attribution all
appear, but the canvas stays black. Zooming or panning changes nothing, and the
browser console shows no error.

MapLibre GL JS v6 spawns its tile worker from a sibling file resolved at
runtime:

```js
const t = import.meta.url.endsWith('-dev.mjs')
  ? 'maplibre-gl-worker-dev.mjs'
  : 'maplibre-gl-worker.mjs'
return new URL(`./${t}`, import.meta.url).href
```

That sibling file is never where `import.meta.url` points, in either
environment. Reproduced on `master` at 38890d6:

| Environment | Worker URL resolves to | Result |
| --- | --- | --- |
| `npm run dev` | `/node_modules/.vite/deps/maplibre-gl-worker.mjs` | **404** - Vite's dep optimizer bundles `maplibre-gl` into `.vite/deps/` but does not copy the worker beside it. Vite itself logs `The file does not exist at ".../deps/maplibre-gl-worker.mjs" ... Try adding it to optimizeDeps.exclude`. |
| `npm run build` + `npm run preview` | `/assets/maplibre-gl-worker.mjs` | **index.html**, served with `content-type: text/html` by the SPA rewrite. `dist/assets/` holds only `index-*.css`, `index-*.js` and `maplibre-gl-*.js`; no worker chunk is emitted. |

With no worker, tiles are never fetched or parsed. The `load` event never fires
and `map.loaded()` stays `false` forever. MapLibre does not surface a
worker-spawn failure on the main thread, which is why nothing reaches
`FlightMap`'s `onError` and the failure alert never shows: the app believes the
map is still loading.

Evidence that this is the whole cause: adding `optimizeDeps.exclude:
['maplibre-gl']` to `vite.config.ts` and reloading the dev server turns
`map.loaded()` into `true`, `map.areTilesLoaded()` into `true`, and
`map.querySourceFeatures('carto', { sourceLayer: 'water' })` returns 181
features. That change was reverted; the tree is clean.

Affected files: `vite.config.ts`, and wherever the fix registers the worker.
`src/map/FlightMap.tsx` itself is correct and does not change.

## The fix

Point MapLibre at a worker Vite actually emits, in one place that covers dev,
`build` and the test run, rather than patching only the dev optimizer.

Import the worker through Vite's worker pipeline and register it before any
`Map` is constructed:

```ts
// src/map/mapWorker.ts
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { setWorkerUrl } from 'maplibre-gl'

setWorkerUrl(workerUrl)
```

`setWorkerUrl` is a documented v6 export. `?worker&url` makes Vite bundle the
worker as its own self-contained chunk and hand back its hashed URL, so the file
exists in `.vite/deps`-free dev serving and in `dist/assets/` alike. Plain
`?url` is not enough: it copies the file without its `maplibre-gl-shared.mjs`
import.

Constraints:

- The registration must run **before** the first `Map` is constructed. Import it
  for its side effect from `src/main.tsx`, next to the existing
  `import './config'`, and keep the side effect out of modules that unit tests
  import.
- MapLibre calls `new Worker(url, { type: 'module' })` with a classic `new
  Worker(url)` fallback. Vite's default worker format is `iife`, which is valid
  in a module worker because the chunk is self-contained. If that combination
  turns out to fail at runtime, set `worker: { format: 'es' }` in
  `vite.config.ts` rather than abandoning the approach.
- Must not break the Vitest run. `src/map/FlightMap.test.tsx` mocks
  `react-map-gl/maplibre` and never touches the real library; keep it that way.
- Must not weaken the existing failure path: an error before load still shows
  the `map-error` alert, an error after load still leaves the map up.
- Attribution stays on. No `attributionControl={false}`.

Out of scope: the `Credentials rejected` poll status visible alongside the black
map. That is the proxy reaching a mock feed that is not running, not a map
problem.

## Build steps

- [x] 1. **Register a Vite-emitted MapLibre worker.**
   Add `src/map/mapWorker.ts` as above, import it for its side effect from
   `src/main.tsx` before `App` is imported, and add
   `src/map/mapWorker.test.ts` asserting the module calls `setWorkerUrl` once
   with a non-empty string (mock `maplibre-gl`).
   *Done when:* `npm run verify` passes; `npm run dev` serves the worker URL
   with a JavaScript content type instead of 404; and in a browser at
   http://localhost:5173 the basemap is visible, with coastline, roads and
   labels, and stays visible after zooming in and out.

- [x] 2. **Confirm the production path, only if step 1 leaves it broken.**
   `npm run build` must emit a worker chunk into `dist/assets/`. If it does not,
   adjust the Vite worker configuration until it does.
   *Done when:* `npm run preview` serves the worker URL as JavaScript, not
   `text/html`, and the basemap renders at http://localhost:4173.

   Nothing to adjust: step 1 already makes `npm run build` emit
   `dist/assets/maplibre-gl-worker-DsvDs_fr.js`, a self-contained IIFE chunk
   with no top-level imports, referenced by name from the app bundle.

## Verify

1. `npm run verify` passes.
2. `npm run dev`, open http://localhost:5173: the CARTO Dark Matter basemap
   renders instead of a black canvas. Zoom in to street level and back out; the
   map keeps drawing.
3. Browser devtools, Network tab: a `maplibre-gl-worker` request returns
   `200` with a JavaScript content type, and `.mvt` tile requests to
   `tiles-*.basemaps.cartocdn.com` appear.
4. `npm run build && npm run preview`, open http://localhost:4173: same result.
5. Set `VITE_MAP_STYLE_URL` to a URL that 404s, reload: the "Could not load the
   map basemap" alert still appears, so the failure path is intact.

## Verification evidence

| Check | Before (`master` at 38890d6) | After |
| --- | --- | --- |
| `npm run verify` | passed | passed - typecheck, 284 tests in 18 files, build |
| `npm run lint` | passed | passed |
| Worker chunk in `dist/assets/` | absent | `maplibre-gl-worker-DsvDs_fr.js`, 506,443 bytes, self-contained IIFE with no top-level imports, referenced by name from the app bundle |
| Worker URL served by `npm run preview` | `text/html` - the SPA rewrite answering with `index.html` | `text/javascript` |
| Glyph requests to `tiles.basemaps.cartocdn.com/fonts/...` | none | 2, captured from the production build in Chrome |
| Basemap visible in a browser | no - black canvas | yes, confirmed by the user |

The glyph requests are the decisive automated signal: MapLibre asks for a
fontstack only after the worker has parsed vector tiles and reported which
fontstacks the symbol layers need. They cannot occur while the worker is dead.

Headless screenshots were not used as evidence. Software WebGL in that
environment paints the style's background layer but no vector layers, confirmed
separately against a light basemap, so it renders a blank canvas on working and
broken code alike.


<!-- blueprint:completion {"schemaVersion":1,"specBytes":7184,"specSha256":"460939c72af86f1633b5558393c311c6c2e0da720b8d612cfc25d3aa8414434e","branch":"refs/heads/fix/maplibre-worker-url","head":"38890d6b13243639327f4e405d3fef3c7b91afaa","baseRef":"refs/heads/master","baseCommit":"38890d6b13243639327f4e405d3fef3c7b91afaa","sourceTree":"a229043a9f2f57a87184b53b764d4cb2f743f072","absentOptional":[]} -->
