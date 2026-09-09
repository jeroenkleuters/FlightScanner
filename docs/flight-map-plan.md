# Plan: Live Aircraft Map (Vite + React + SkySpy WebSockets)

A single-page web app that renders live aircraft positions on an interactive map,
fed by the SkySpy WebSocket API and seeded by its REST API.

Status: proposed. No code written yet.

---

## 1. Goal

Open the app, see every aircraft SkySpy is currently tracking as a rotated plane
icon on a map, watch them move in near-real-time, and click one for details
(callsign, altitude, speed, heading, squawk, distance).

### In scope (v1)
- Map with live aircraft markers, rotated to heading, colored by altitude
- WebSocket connection with auth, subscribe/unsubscribe, and auto-reconnect
- Snapshot + incremental update/delta/new/remove handling
- Selected-aircraft detail panel
- Connection status indicator (connected / reconnecting / stale)

### Out of scope (v1, candidates for later)
- Trails for *all* aircraft (selected-aircraft trail is in scope - see below)
- ACARS, safety events, alerts, NOTAMs
- Cannonball mode, audio, airspace overlays
- Aircraft photos and airframe identity (registration, type, operator) - **planned
  for v2, specified in §9**
- Filtering, search, server-side persistence, user accounts

### UX reference: Flightradar24

[flightradar24.com](https://www.flightradar24.com) is the visual and interaction
model. Concretely, what we're borrowing:

| FR24 behavior | Our v1 treatment |
| --- | --- |
| Dark, desaturated basemap - terrain recedes, aircraft pop | Dark MapLibre style, muted land/water, minimal labels |
| Small yellow/amber plane silhouettes rotated to heading | Symbol layer, `icon-rotate` from `track` |
| Click an aircraft → it highlights, the rest dim | Selected feature gets a distinct color + larger icon; others drop opacity |
| Click → a **trail** draws behind the selected flight | Client-side trail: keep the last ~200 positions **for the selected `hex` only** |
| Left detail sidebar with flight identity and live telemetry | `AircraftDetailPanel`, same slot |
| Hover → small callsign tooltip | Hover tooltip on the symbol layer |
| Icon size scales with zoom; labels appear only when zoomed in | Zoom-interpolated `icon-size` and label opacity |
| Persistent stat/status strip | `StatsBar` + `ConnectionStatus` |

**Scope adjustment this forces.** The selected-aircraft trail was originally out
of scope, but it's the single most recognizable part of the FR24 experience, so
it moves in. It's cheap: positions accumulate client-side in the store, only for
the one selected aircraft, and the buffer is discarded on deselect. Trails for
the whole fleet stay out - that needs history the store doesn't keep and would
multiply render cost.

**What we are not copying:** FR24's branding, logo, color marks, icon artwork, or
map tiles. We're matching interaction patterns and general visual approach (dark
map, rotated silhouettes, click-for-detail), which are common to aircraft
trackers, with our own assets and palette.

**Where we will differ.** FR24 shows global coverage; SkySpy is a single
self-hosted ADS-B receiver, so coverage is a radius around one antenna. The map
will look like FR24 zoomed into one region - a sparse map is normal, not a bug.

The *data* gap is narrower than the live stream suggests. The WebSocket payload
carries only telemetry (`hex`, `flight`, `alt_baro`, `gs`, `track`, `squawk`,
`distance_nm`), but a separate REST lookup - `/api/v1/airframes/{icao}/` - returns
registration, type, manufacturer, model, operator, owner, country, age, and photo
URLs, enriched from FAA, OpenSky, Planespotters, HexDB and others. So the FR24
detail panel with a photo is achievable; it's a v2 enrichment layer on top of the
live map rather than something the stream gives us for free. See §9.

Genuinely unavailable: **route / origin-destination**. No SkySpy endpoint provides
it, so "LHR → JFK" style routing stays out unless a third-party source is added.

---

## 2. API research summary

Verified from `https://skyspy.readme.io` (docs + `llms.txt` index) on 2026-09-09.

### Base URL
SkySpy is **self-hosted**. Quick-start documents `http://localhost:8000` as the
default host. There is no public SaaS endpoint, so the host must be configurable.

- REST: `{HTTP_BASE}/api/v1/...`
- WebSocket: `{WS_BASE}/ws/{endpoint}/`
- Interactive schema for verification: `{HTTP_BASE}/api/docs/` (Swagger),
  `{HTTP_BASE}/api/schema/` (OpenAPI)

### Authentication
Default deployment runs in **public mode** - no key needed for basic reads. When
auth is enabled:

| Method | Format |
| --- | --- |
| JWT | `Authorization: Bearer eyJ...` from `POST /api/v1/auth/login` |
| API key | `Authorization: ApiKey sk_live_...` or `X-API-Key: sk_live_...` |

Access token ~60 min, refresh token ~2 days via `POST /api/v1/auth/refresh`
(refresh tokens rotate on use; the old one is blacklisted).

WebSocket auth: token passed through the `Sec-WebSocket-Protocol` header
(recommended) or the query string (discouraged - leaks into logs). Both JWT
(`eyJ...`) and API keys (`sk_live_...` / `sk_test_...`) are accepted.

> **Decision (agreed): use `Sec-WebSocket-Protocol`. The query-string form is not
> implemented, not in dev, not as a fallback.**
>
> The browser `WebSocket` constructor cannot set arbitrary headers. The one header
> it can influence is `Sec-WebSocket-Protocol`, via the second `protocols`
> argument - which is exactly the header SkySpy recommends, so the recommended
> method is reachable from the browser:
>
> ```ts
> new WebSocket(url, [token])
> ```
>
> Two mechanics still need confirmation against a live instance (Step 3), because
> they change the call, not the approach:
>
> 1. **Protocol array shape.** A bare `[token]` vs. a two-element
>    `['skyspy', token]`. Servers that namespace the subprotocol reject the bare
>    form during the handshake.
> 2. **Server echo.** A server that receives a subprotocol offer *must* echo one
>    accepted value back in its response, or a spec-compliant browser fails the
>    connection. If SkySpy echoes a fixed name, the client must offer that name
>    alongside the token.
>
> `SkySpyClient` therefore takes the protocol array from a single
> `buildProtocols(token)` function so the shape is one edit once Step 3 answers
> it. If both shapes fail the handshake, that is a **blocker to raise**, not a
> reason to fall back to the query string.

### WebSocket protocol

Endpoint: `/ws/aircraft/` (dedicated) or `/ws/all/` (multiplexed).
Plan uses `/ws/aircraft/` for v1 - narrower topic, less traffic.

Subscribe / unsubscribe:
```json
{ "action": "subscribe",   "topics": ["aircraft"] }
{ "action": "unsubscribe", "topics": ["aircraft"] }
```

Inbound message types (`data.type`):

| Type | Meaning | Handling |
| --- | --- | --- |
| `aircraft:snapshot` | Full state on connect | Replace entire store |
| `aircraft:update` | Periodic rate-limited update | Upsert |
| `aircraft:new` | New detection | Insert |
| `aircraft:remove` | Timed out / out of range | Delete by `hex` |
| `aircraft:delta` | Changed fields only | Merge into existing |
| `aircraft:heartbeat` | Count + timestamp, every 5s | Update liveness clock |

Request/response (for on-demand detail):
```json
{ "action": "request", "type": "aircraft-info",
  "request_id": "req_abc123", "params": { "icao": "A1B2C3" } }
```
Response echoes `request_id` and `request_type`, with `data` or an error.

### Aircraft payload fields

| Field | Meaning |
| --- | --- |
| `hex` | ICAO 24-bit identifier - **the stable key** |
| `lat` / `lon` | Position (may be absent before a position fix) |
| `alt_baro` | Barometric altitude, ft |
| `gs` | Ground speed, kt |
| `track` | Heading, degrees |
| `flight` | Callsign (often space-padded - trim it) |
| `squawk` | Transponder code |
| `baro_rate` | Vertical speed, ft/min |
| `distance_nm` | Range from receiver |

The REST `/api/v1/aircraft/` list response wraps these as
`{ aircraft: [...], count, now, messages, timestamp }`. Its OpenAPI schema
declares the aircraft object as `additionalProperties: {}` - i.e. **loosely
typed**. Treat every field as optional in our types and validate defensively.

### Rate limits & batching
- Aircraft updates 10 Hz, position-only 5 Hz, deltas 10 Hz, stats 0.5 Hz
- Server batches over a 200 ms window (max 50 messages or 1 MB)
- Critical messages (alerts, safety, emergency) bypass batching

Server can therefore deliver up to ~10 batched frames/sec. The UI must not
re-render the whole map per frame - see §5.

### Reconnection (documented server expectation)
Exponential backoff with jitter: start 1000 ms, max 30000 ms, ×2 multiplier,
0-30% random variance. Ping/pong heartbeat every 30 s.

---

## 3. Prerequisite: verify against a live instance

**Do this before writing feature code.** The docs are thin in two places
(WS auth handshake shape, aircraft object schema), and both drive core types.

1. Confirm a reachable SkySpy host and whether auth is on:
   `curl {HTTP_BASE}/health` and `curl {HTTP_BASE}/api/v1/aircraft/`
2. Capture one real aircraft object; record actual field names and null patterns
3. **Settle the `Sec-WebSocket-Protocol` handshake** (see §2). Try the bare token
   first, then the namespaced form, and record which one connects plus whatever
   subprotocol the server echoes back:
   ```bash
   websocat -H='Sec-WebSocket-Protocol: <token>' ws://HOST/ws/aircraft/
   websocat -H='Sec-WebSocket-Protocol: skyspy, <token>' ws://HOST/ws/aircraft/
   ```
   Confirm it in a real browser too - `websocat` tolerates a missing server echo
   where a browser will not. Write the answer into `buildProtocols()`.
4. Connect to `/ws/aircraft/`, subscribe, and capture one of each message type -
   especially the exact envelope shape (is the payload at `data.data.aircraft`,
   an array, or a keyed object?)
5. Save the captured frames to `docs/fixtures/` as JSON - they become the mock
   server's script and the test fixtures
6. **Probe the v2 data early** (cheap now, saves a surprise later): take a `hex`
   from the capture and run
   `curl {HTTP_BASE}/api/v1/airframes/{hex}/`. Record whether registration,
   operator, and `photo_url` are actually populated on this instance, or whether
   `fetch_failed` is set. Nothing in v1 depends on it - but if the enrichment
   sources aren't reachable from your deployment, §9 needs rethinking before it's
   scheduled, not after.

**Blocker rule:** if no live instance is available, build against the mock server
(§7) using the documented shapes, keep the transport layer behind an adapter, and
flag the schema as unverified in the README.

---

## 4. Stack

| Concern | Choice | Why |
| --- | --- | --- |
| Build | Vite + React 18 + TypeScript | Asked for; fast HMR |
| Map | MapLibre GL JS + `react-map-gl` | Free, no API key, vector tiles, GPU rendering of thousands of markers |
| Tiles | Public demo style, host configurable | Avoids a mandatory account; swappable |
| State | Zustand (or `useSyncExternalStore` + a plain store) | Aircraft store must update outside React's render path |
| WS client | Hand-rolled over native `WebSocket` | Need `Sec-WebSocket-Protocol` auth + a custom subscribe protocol; a library adds little |
| Tests | Vitest + React Testing Library | Vite-native |
| Lint/format | ESLint + Prettier | - |

**Map library note.** Leaflet is the easier alternative but renders each marker
as a DOM node; a few thousand aircraft will stutter. MapLibre draws them in a
single WebGL symbol layer. Recommend MapLibre and render aircraft as a GeoJSON
source + symbol layer, not as React components.

---

## 5. Architecture

```
src/
  main.tsx
  App.tsx
  config.ts                 # env: WS base, HTTP base, token, default view
  api/
    rest.ts                 # GET /api/v1/aircraft/ (initial seed, fallback)
    auth.ts                 # login + refresh (only if auth enabled)
  ws/
    SkySpyClient.ts         # connection, auth, backoff, ping, subscribe, request
    messages.ts             # envelope types + type guards
    useSkySpy.ts            # React binding: lifecycle + status
  store/
    aircraftStore.ts        # Map<hex, Aircraft>, snapshot/upsert/delta/remove
    trailBuffer.ts          # ring buffer of positions for the selected hex
    selectors.ts            # toGeoJSON(), toTrailGeoJSON(), getByHex()
  map/
    FlightMap.tsx           # MapLibre canvas
    AircraftLayer.tsx       # GeoJSON source + symbol layer, heading rotation
    TrailLayer.tsx          # line layer for the selected aircraft's track
    aircraftStyle.ts        # altitude→color ramp, icon, zoom-based sizing
    mapStyle.ts             # dark FR24-like basemap style overrides
  ui/
    ConnectionStatus.tsx
    AircraftDetailPanel.tsx
    StatsBar.tsx            # count, msg rate, last heartbeat
  types/aircraft.ts
docs/
  flight-map-plan.md        # this file
  fixtures/                 # captured real frames
mock/
  server.mjs                # replays fixtures over ws://
```

### Data flow
```
SkySpyClient ──frames──▶ aircraftStore (plain Map, mutated outside React)
                              │
              throttled (~4 Hz via requestAnimationFrame)
                              ▼
                    GeoJSON FeatureCollection
                              ▼
              MapLibre setData() on the aircraft source
```

React re-renders only for: connection status, selected aircraft, and the count.
Marker movement never passes through React's reconciler.

### Key decisions
- **`hex` is the identity key.** Never key on callsign - it changes and repeats.
- **Store is a mutable `Map`, not React state.** 10 Hz × 500 aircraft in
  `useState` will melt the app.
- **Drop aircraft without `lat`/`lon`** from the map layer, but keep them in the
  store (they still count and may gain a position fix later).
- **Client-side staleness:** hide or fade any aircraft not updated in 60 s, even
  if no `aircraft:remove` arrives. Missed removes are a real failure mode.
- **`aircraft:delta` merges, everything else upserts wholesale.** A delta for an
  unknown `hex` is dropped and triggers a resync request.
- **Trail buffer is separate from the aircraft store and holds one aircraft.**
  A ring buffer (~200 points) appended on each position change for the selected
  `hex`, cleared on deselect. Keeping it out of the main store means the FR24
  trail costs nothing when nothing is selected, and there's no unbounded history
  growth across a long session.

---

## 6. Build steps

Each step ends with the app running and something visible. One reviewed step at
a time, per the Blueprint workflow.

**Step 1 - Scaffold.**
`npm create vite@latest . -- --template react-ts` in an *empty sibling folder*,
then overlay onto this repo (Blueprint files must not be scaffolded over - see
AGENTS.md). Add ESLint, Prettier, Vitest. Add `.env.example` with
`VITE_SKYSPY_HTTP`, `VITE_SKYSPY_WS`, `VITE_SKYSPY_TOKEN`,
`VITE_MAP_STYLE_URL`, `VITE_DEFAULT_CENTER`, `VITE_DEFAULT_ZOOM`.
*Done when:* `npm run dev` serves a blank styled page.

**Step 2 - Map shell.**
MapLibre full-viewport, default center/zoom from env, dark style, zoom controls.
*Done when:* a pannable map fills the window.

**Step 3 - Live-instance verification (§3).**
Capture fixtures, finalize `types/aircraft.ts` from real data.
*Done when:* `docs/fixtures/*.json` exist and types compile against them.

**Step 4 - Mock WS server.**
`mock/server.mjs` replays fixtures at ~2 Hz with jittered positions, honors
subscribe, emits heartbeats, and can be told to drop the connection to exercise
reconnect. It must **validate the `Sec-WebSocket-Protocol` offer and echo the
accepted value back**, mirroring what Step 3 found - otherwise the mock accepts
handshakes the real server rejects and the auth path stays untested until
production. `npm run mock`.
*Done when:* a client offering the right protocol connects and receives a
snapshot then updates; one offering nothing or the wrong value is rejected.

**Step 5 - `SkySpyClient`.**
Connect via `new WebSocket(url, buildProtocols(token))`, subscribe on open, parse
and dispatch typed frames, exponential backoff with jitter (1s → 30s, ×2, 0-30%),
30 s ping, resubscribe after reconnect, `close()` cleanup. Unit-tested against a
fake socket, including a test asserting the exact protocol array passed to the
constructor. A handshake failure must surface as a distinct `auth-failed` status,
not an endless silent reconnect loop - a rejected token otherwise looks identical
to an unreachable server.
*Done when:* status flips connected → reconnecting → connected when the mock
drops, a bad token reports `auth-failed`, and no timers or sockets leak.

**Step 6 - Aircraft store.**
Snapshot replace, upsert, delta merge, remove, staleness sweep, `toGeoJSON()`.
Pure, fully unit-tested - no React, no map.
*Done when:* tests cover all six message types plus the delta-for-unknown-hex and
missed-remove cases.

**Step 7 - Wire store to map.**
GeoJSON source + symbol layer, plane icon rotated by `track`, ~4 Hz
`requestAnimationFrame`-throttled `setData()`.
*Done when:* mock aircraft move smoothly on the map.

**Step 8 - FR24-style visual pass.**
Dark basemap with muted land/water and minimal labels; plane silhouette icon;
altitude→color ramp; zoom-interpolated icon size; callsign labels above a zoom
threshold; faded stale aircraft; legend. Compare side-by-side with FR24 at a
similar zoom.
*Done when:* the map reads as an aircraft tracker at a glance and altitude bands
are distinguishable.

**Step 9 - Selection, detail panel, and trail.**
Click to select: selected aircraft highlights and enlarges, others dim, and a
**trail line** draws from its buffered positions. Left detail panel shows
callsign, hex, altitude, speed, heading, squawk, vertical rate, distance, and
last-seen age, updating live for the selected `hex`. Hover tooltip with callsign.
Esc or click-away deselects and clears the trail buffer.
*Done when:* selecting an aircraft dims the fleet, draws a growing trail, and
shows telemetry that ticks as it moves.

**Step 10 - Status & resilience.**
Connection pill (connected / reconnecting / disconnected / stale-data), tracked
count, seconds-since-heartbeat, REST seed via `/api/v1/aircraft/` on first load
so the map isn't empty before the first snapshot, and a manual reconnect button.
*Done when:* pulling the network shows a clear degraded state and recovers on
its own.

**Step 11 - Docs & polish.**
README with setup, env vars, how to point at a real instance, how to run the
mock, and known gaps. Loading and error states. Responsive layout.
*Done when:* someone else can clone and run it against their own SkySpy.

---

## 7. Testing

| Layer | Approach |
| --- | --- |
| `messages.ts` type guards | Unit, against captured fixtures |
| `aircraftStore` | Unit - every message type, staleness, unknown-hex delta |
| `trailBuffer` | Unit - append, ring-buffer cap, clear on deselect |
| `SkySpyClient` | Unit with a fake WebSocket - backoff timing, resubscribe, cleanup |
| Detail panel / status | React Testing Library |
| End-to-end | Manual against the mock server; browser tests only if `/browser-tests` is run |

Per AGENTS.md, testing is opt-in in this project - run `/tests` to add the runner
and turn on the gate before Step 6, since Steps 5-6 are where tests carry the
most weight.

---

## 8. Risks & open questions

| # | Risk | Mitigation |
| --- | --- | --- |
| 1 | **Subprotocol handshake shape is unconfirmed** - bare `[token]` vs. `['skyspy', token]`, and whether the server echoes an accepted value. A mismatch closes the socket during the handshake, before any app code runs. | Settle in Step 3 against a live instance *and* a real browser; isolate in `buildProtocols()`; mock server enforces the same rule (Step 4); `auth-failed` status makes a rejection visible (Step 5). **No query-string fallback** - if neither shape works, raise it as a blocker. |
| 2 | **Aircraft schema is `additionalProperties: {}`** - undocumented and possibly deployment-specific. | Derive types from captured fixtures; treat every field as optional; guard every read. |
| 3 | **No public SkySpy host.** Needs a self-hosted instance to develop against. | Mock server (Step 4) makes Steps 5-11 possible without one. |
| 4 | **CORS / mixed content.** A `https` app cannot open `ws://`, and REST from the browser needs CORS on the SkySpy host. | Use Vite's dev proxy for both HTTP and WS in development - and confirm the proxy **forwards `Sec-WebSocket-Protocol` intact**, since proxies that strip it break auth in dev only. Document the production requirement. |
| 9 | **Token is exposed to the browser.** `Sec-WebSocket-Protocol` keeps it out of URLs and server logs, but a `VITE_`-prefixed value is still baked into the client bundle and readable by anyone using the app. | Acceptable for a local/trusted-network tool. If this is ever exposed publicly, the token must move behind a small backend proxy that holds it server-side. Note this in the README. |
| 5 | **Render cost at high aircraft counts.** | MapLibre symbol layer + throttled `setData` + no per-marker React. Load-test with the mock at 2000 aircraft. |
| 6 | **Missed `aircraft:remove` leaves ghosts.** | Client-side staleness sweep (§5). |
| 7 | **JWT expiry mid-session** silently kills the socket. | If JWT auth is used, refresh before expiry and reconnect; API keys avoid this - prefer them. |
| 8 | **A dark FR24-like basemap may need a tile account.** Most polished dark vector styles (Mapbox, MapTiler) are keyed; the FR24 look leans on exactly that kind of style. | Style URL is env-configurable. Default to a keyless dark style (e.g. CARTO Dark Matter) and check its attribution and usage terms before shipping anywhere public. Confirm the chosen provider's terms in Step 8, not at release. |

### Questions for you
1. Is there a SkySpy instance to point at, or is this mock-only for now?
2. API key, JWT login, or public mode? (Transport is settled - token travels via
   `Sec-WebSocket-Protocol` - but an API key avoids the mid-session JWT expiry in
   risk #7, so prefer `sk_live_...` / `sk_test_...` if you can issue one.)
3. Preferred default map view (center/zoom) - receiver location?
4. Is Leaflet preferred over MapLibre for familiarity? Recommendation is now
   firmly MapLibre - the FR24 look depends on a dark *vector* style, zoom-
   interpolated icon sizing, and GPU-rendered rotated symbols, all of which
   Leaflet does awkwardly or not at all.
5. Anything on FR24 you specifically want or specifically don't? The table above
   is my read of what matters; the notable omissions are aircraft photos, route
   and airline info, and whole-fleet trails.

---

## 9. v2: Aircraft identity & photos

Deferred deliberately - v1 must have a solid live map first - but designed for
now so v1 doesn't paint us into a corner.

### The endpoints

**`GET /api/v1/airframes/{icao_hex}/`** - the one that matters. Returns:

| Group | Fields |
| --- | --- |
| Identity | `icao_hex`, `registration`, `type_code`, `type_name` |
| Airframe | `manufacturer`, `model`, `serial_number`, `year_built`, `age_years`, `first_flight_date`, `delivery_date`, `airframe_hours` |
| Operator | `operator`, `operator_icao`, `operator_callsign`, `owner`, `country`, `country_code` |
| Classification | `category`, `is_military` |
| Media | `photo_url`, `photo_thumbnail_url`, `photo_photographer`, `photo_source` |
| Provenance | `source_data` (raw from FAA, ADS-B Exchange, tar1090, OpenSky, HexDB, adsb.lol, Planespotters), `cached_at`, `fetch_failed`, `extra_data` |

Returns `404` when the airframe is unknown.

**`GET /api/v1/airframes/{icao_hex}/photos/`** - `icao_hex`, `photo_url`,
`thumbnail_url`, `photographer`, `source`. All URLs nullable.

> **Use the airframes endpoint alone.** Its media fields already carry the photo,
> so calling both doubles the requests for the same image. Reach for `/photos/`
> only if the live instance turns out to populate it when the parent does not -
> check that once, then pick one.

### Design

**Lazy, per-selection, cached.** Nothing is fetched for the fleet - only for the
aircraft the user clicks. A `Map<hex, AirframeInfo | 'pending' | 'missing'>` cache
lives beside the aircraft store and survives deselect/reselect for the session.
Fetching identity for hundreds of live aircraft would hammer the server for data
that's only ever shown one at a time.

**Three-state panel, never a layout jump.** The detail panel from Step 9 gains an
identity block above the telemetry that renders as skeleton → loaded → "no
airframe data". Photo area holds a fixed aspect ratio from the start so the panel
doesn't reflow when the image lands. Telemetry keeps streaming regardless - a
failed lookup must never blank the live data that's already working.

**`404` and `fetch_failed` are normal, not errors.** Military, private, and
newly-registered aircraft are routinely absent. Cache the miss so we don't refetch
on every reselect, show a plain "no airframe data on file", and keep the panel
useful with what the stream gives us.

**Attribution is mandatory.** `photo_photographer` and `photo_source` render
visibly with the image, every time. These come from third-party sources
(Planespotters and friends) with their own licensing; a photo without its credit
isn't shippable. If a photo has no photographer field, show the source; if neither,
don't show the photo.

**Images load direct from the third-party URL.** They aren't proxied through
SkySpy, so add `referrerpolicy`, lazy loading, an `onError` fallback to the
placeholder, and expect some hosts to block hotlinking. Verify against real URLs
early - this is the most likely thing to quietly not work.

### Build steps (v2)

**Step 12 - `airframes` API client + cache.** `api/airframes.ts`, the cache
store, in-flight deduplication (rapid reselect must not fire duplicate requests),
and typed responses. Unit-tested with a mocked fetch: hit, miss, `404`,
`fetch_failed`, dedupe.

**Step 13 - Identity block in the panel.** Registration, type, operator, country
flag, age, military badge. Skeleton and empty states. No photo yet.

**Step 14 - Photo.** Fixed-ratio image with attribution line, lazy load, error
fallback, click-to-enlarge.

**Step 15 - Optional enrichment of the map itself.** Once identity is cached,
`type_code` can drive per-type aircraft silhouettes and `is_military` a distinct
marker color - the last visible gap to FR24's icon variety. Only for aircraft
already in cache; never trigger a fetch from the map layer.

### What v1 must do to enable this

- Keep `hex` as the identity key everywhere (already the plan)
- Give `AircraftDetailPanel` room for an identity block and image above telemetry
- Keep the REST client generic enough to add a second endpoint without rework

### Open questions for v2

- Does your instance actually populate airframe data and photos? It depends on
  the enrichment sources being reachable and configured - worth a single
  `curl {HTTP_BASE}/api/v1/airframes/{some_hex}/` during v1's Step 3 to find out
  early, even though we won't build on it yet.
- Photo click-to-enlarge: modal, or link out to the source page?

---

## 10. Suggested first move

Run `/feature` to turn **Steps 1-2** (scaffold + map shell) into the first spec,
then `/implement`. Steps 3-4 (verification + mock) should be the second feature,
since everything after them depends on the real message shapes.
