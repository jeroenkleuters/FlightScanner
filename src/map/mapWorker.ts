/**
 * Registers the MapLibre tile worker.
 *
 * MapLibre GL JS v6 resolves its worker as a sibling of its own module URL:
 *
 *   new URL('./maplibre-gl-worker.mjs', import.meta.url)
 *
 * A bundler moves the library without moving that sibling, so the URL points at
 * nothing. In dev it 404s next to Vite's pre-bundled dependency; in a build it
 * lands in `assets/`, where no worker chunk exists and the SPA rewrite answers
 * with `index.html`. Either way no worker starts, and MapLibre reports that
 * failure nowhere on the main thread: `load` never fires, tiles are never
 * fetched or parsed, and the map stays a blank canvas with no console error.
 *
 * `?worker&url` hands the file to Vite's worker pipeline, which emits it as a
 * self-contained chunk and returns the URL that chunk actually has. Plain
 * `?url` would copy the file without the shared module it imports.
 *
 * Imported for its side effect from `src/main.tsx`, before any map is
 * constructed: `setWorkerUrl` takes effect only for workers not yet spawned.
 */
import { setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'

setWorkerUrl(workerUrl)
