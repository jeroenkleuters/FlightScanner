# FlightScanner - Project Overview

<!-- blueprint:source-hash 9c0e9e5c0bbb5dc1fc8190b1df3f3581f9b077dff598896ad15596ed46153d45 -->

> A live aircraft map over the SkySpy WebSocket API, built with Vite, React, and MapLibre.

## Problem

SkySpy exposes a real-time ADS-B feed - a WebSocket stream of aircraft contacts
at up to 10 Hz, plus REST lookups for airframe identity - but no map. The data is
there and unreadable: JSON frames describing objects whose entire meaning is
spatial.

FlightScanner renders that stream as a map you can watch. It is also a study
project: the goal is a genuinely resilient real-time client - correct
reconnection, honest degraded states, a render path that survives high message
rates - not just moving pixels.

## Users

| User | Needs |
| --- | --- |
| **SkySpy operator** | See what their own receiver is picking up right now, without a terminal |
| **Aviation enthusiast** near that receiver | Watch local traffic, identify individual aircraft |
| **The developer** | A real exercise in WebSocket lifecycle, high-frequency state outside React, GPU map rendering |

No accounts, no access tiers - a single anonymous view. Not built for global
coverage, commercial tracking, or anything safety-critical.

## Features

Build-plan order. **Headline feature: 9 - selection, detail panel, and trail**;
that is the Flightradar24 moment the rest of v1 exists to support.

### v1 - live map

1. **Project scaffold** - Vite + React + TS, lint, format, Vitest, env config, `verify` script.
2. **Map shell** - full-viewport dark MapLibre map centred on the configured location.
3. **Live instance verification** - settle the WebSocket handshake, capture real message fixtures. Gates 4-7.
4. **Mock WebSocket server** - replay fixtures as a moving feed with fault injection.
5. **SkySpy WebSocket client** - authenticated connect, subscribe, typed dispatch, backoff reconnect.
6. **Aircraft store** - pure `Map<hex, Aircraft>` handling all six message types plus staleness.
7. **Aircraft layer** - one GeoJSON symbol layer, heading-rotated icons, throttled updates.
8. **FR24-style visual pass** - altitude colour ramp, zoom sizing, labels, stale fading, legend.
9. **Selection, detail panel, and trail** - click to select, fleet dims, trail draws, live telemetry.
10. **Connection status and resilience** - status indicator, REST seed, stats, stale warning, manual reconnect.
11. **Documentation and polish** - README, loading and error states, responsive layout, accessibility.

### v2 - aircraft identity and photos

12. **Airframes API client and cache** - lazy per-selection lookup, miss caching, request dedupe.
13. **Identity block** - registration, type, operator, country, military badge in the panel.
14. **Aircraft photo** - photo with mandatory attribution, fixed ratio, fallback, click to enlarge.
15. **Map enrichment from identity** - per-type silhouettes and military colouring, cache-only.

Each item has a detailed pre-written spec at
`blueprint/context/features/<nn>-<name>-spec.md`. `/feature <n>` reads the matching file as
its primary source.

**Explicitly excluded** from both phases: ACARS, safety events, alerts, NOTAMs,
cannonball mode, audio, airspace overlays, filtering, search, user accounts, and
whole-fleet trails. Route and origin/destination data is excluded by necessity,
not choice - no SkySpy endpoint provides it.

## Data model

**Nothing is persisted.** No database, no backend, no accounts. All state is
in-memory and session-scoped. The shapes below are still contracts: features
5-15 depend on them.

### Aircraft

Keyed by `hex` in `Map<hex, Aircraft>`. **Every field except `hex` is optional**
- SkySpy's OpenAPI schema declares the aircraft object `additionalProperties:
{}`, so the real shape is deployment-specific and must be confirmed by capture
(feature 3), not documentation. Guard every read.

- `hex` (string, **required**) - ICAO 24-bit identifier, the identity key
- `flight` (string?) - callsign, space-padded on the wire; trim on read
- `lat` (number?), `lon` (number?) - position; absent before a position fix
- `alt_baro` (number?) - barometric altitude, ft
- `gs` (number?) - ground speed, kt
- `track` (number?) - heading, degrees; falls back to 0 for rotation
- `squawk` (string?) - transponder code
- `baro_rate` (number?) - vertical speed, ft/min
- `distance_nm` (number?) - range from receiver
- `lastSeen` (number) - client-recorded timestamp, **not** from the payload;
  server timestamps may be absent or skewed
- `stale` (boolean) - derived: no update for 60 s; dropped at 5 min

> **Locked:** `hex` is the identity key everywhere. Never key on `flight` -
> callsigns change and repeat. Aircraft without `lat`/`lon` stay in the store but
> are excluded from map output.

### WebSocket message envelope

Discriminated union on `type`, built from captured fixtures:

| Type | Store effect |
| --- | --- |
| `aircraft:snapshot` | Replace entire contents |
| `aircraft:new` / `aircraft:update` | Upsert wholesale by `hex` |
| `aircraft:delta` | Shallow-merge present fields only; unknown `hex` is dropped and flags resync |
| `aircraft:remove` | Delete by `hex`; unknown `hex` is a no-op |
| `aircraft:heartbeat` | Update liveness clock only |

### TrailBuffer

Ring buffer for the **selected aircraft only**, held separately from the aircraft
store so it costs nothing when nothing is selected.

- `hex` (string) - the aircraft it belongs to
- `points` (array of `{lat, lon}`, cap ~200) - oldest discarded past the cap
- cleared on deselect and on selection change - never merged between aircraft

> Client-side only. SkySpy provides no position history, so a trail starts empty
> at selection. It is not flight history and must not be presented as such.

### AirframeInfo (v2)

From `GET /api/v1/airframes/{icao_hex}/`. All fields optional except `icao_hex`.

- Identity: `icao_hex`, `registration`, `type_code`, `type_name`
- Airframe: `manufacturer`, `model`, `serial_number`, `year_built`, `age_years`,
  `first_flight_date`, `delivery_date`, `airframe_hours`
- Operator: `operator`, `operator_icao`, `operator_callsign`, `owner`, `country`,
  `country_code`
- Classification: `category`, `is_military` (absent means **unknown**, not civil)
- Media: `photo_url`, `photo_thumbnail_url`, `photo_photographer`, `photo_source`
- Provenance: `cached_at`, `fetch_failed`

### AirframeCache (v2)

`Map<hex, CacheEntry>` where an entry is `pending`, `loaded`, or `missing`.

> **Locked:** misses are cached too - reselecting an aircraft with no record must
> not refetch a known 404. `fetch_failed: true` is transient, cached as
> retryable rather than a permanent miss. Lookups are lazy and per-selection;
> the map layer reads the cache but **never triggers a fetch**.

### ConnectionStatus

`connecting` | `connected` | `reconnecting` | `auth-failed` | `closed`.

> Three failure modes must stay visually distinguishable: disconnected (retrying),
> connected-but-silent (socket up, no frames), and auth-failed (token rejected,
> **not** retrying).

## Tech stack

- **Vite + React 18 + TypeScript** - build and UI
- **MapLibre GL JS + react-map-gl** - keyless, GPU-rendered vector map. Chosen
  over Leaflet deliberately: Leaflet renders each marker as a DOM node and
  stutters at a few thousand aircraft; MapLibre draws them in one WebGL symbol
  layer.
- **Native WebSocket, hand-rolled client** - SkySpy's subprotocol auth and
  subscribe protocol are the whole job; a library would be wrapped anyway
- **Vitest + React Testing Library** - unit and component tests
- **ESLint + Prettier** - lint and format
- **No backend** - the app talks to SkySpy directly

### External API

Self-hosted SkySpy. REST at `{HTTP_BASE}/api/v1/`, WebSocket at
`{WS_BASE}/ws/aircraft/`.

> **Auth is settled: the token travels via the `Sec-WebSocket-Protocol` header**,
> reachable from the browser as the `WebSocket` constructor's second argument.
> **No query-string fallback, not even in development** - query strings leak
> tokens into server logs. The exact protocol array shape is confirmed in
> feature 3 and isolated in `buildProtocols()`.

Documented rate limits: aircraft updates 10 Hz, deltas 10 Hz, stats 0.5 Hz;
server batches over a 200 ms window. Reconnect backoff follows SkySpy's
documented expectation: 1000 ms start, 30000 ms max, x2, 0-30% jitter.

## Monetization

Not in v1, and not planned. Personal study project - no ads, no accounts, no
commercial intent.

## UI/UX

**Reference: [Flightradar24](https://www.flightradar24.com).** Dark desaturated
basemap so terrain recedes; small bright plane silhouettes rotated to heading;
zoom-scaled icons; callsign labels only when zoomed in; click an aircraft and it
highlights while the rest dim, a trail draws behind it, and a side panel shows
live telemetry.

Borrowed: interaction patterns and general visual approach, common to aircraft
trackers. **Not borrowed:** FR24's branding, logo, colour marks, icon artwork, or
map tiles. Own assets and palette throughout.

**Single screen, no routing.** A full-viewport map with overlays:

- Map canvas - aircraft symbol layer, trail layer beneath it
- Detail panel - left sidebar; bottom sheet below ~640 px. Layout reserves an
  identity slot above telemetry for features 13-14, so adding them causes no
  reflow
- Connection status + stats bar - persistent, unobtrusive
- Altitude legend - compact, non-blocking

Honest about limits: a frozen map that looks healthy is worse than one admitting
it is stale. Aircraft that stop reporting fade rather than sitting at full
brightness; missing values render as dashes, never zeros; a sparse map is normal
because one receiver sees one radius.

## Deployment

> **TODO - no deployment target chosen.** Local development only; `/release` has
> not been run.

The app is a static SPA (`vite build` → `dist/`), so any static host would serve
it. Two blockers before it ships anywhere public:

1. **Token exposure.** Every `VITE_`-prefixed variable is baked into the client
   bundle and readable by anyone using the app. A public deployment needs a
   backend proxy holding the token server-side.
2. **CORS and mixed content.** An HTTPS page cannot open a `ws://` socket, and
   browser REST calls need CORS on the SkySpy host. Development uses Vite's dev
   proxy, which must be confirmed to forward `Sec-WebSocket-Protocol` intact -
   proxies that strip it break auth in development only.

Env vars by name: `VITE_SKYSPY_HTTP`, `VITE_SKYSPY_WS`, `VITE_SKYSPY_TOKEN`,
`VITE_MAP_STYLE_URL`, `VITE_DEFAULT_CENTER`, `VITE_DEFAULT_ZOOM`.

No database, workers, or cron. No health path - it is a static bundle.

## Open questions

> Resolve these in the plans, then re-run `/overview`.

1. **Is there a reachable SkySpy instance?** Feature 3 needs one to capture
   fixtures and confirm the handshake, and features 4-7 are built against what it
   captures. Neither plan names a host. If there is none, feature 3 stops rather
   than inventing fixtures.
2. **Which auth mode - API key, JWT login, or public mode?** The transport is
   settled; the credential type is not. An API key avoids mid-session JWT expiry
   silently killing the socket.
3. **`VITE_DEFAULT_CENTER` has no value.** Presumably the receiver location, but
   no plan states it.
4. **`AGENTS.md` Commands are stale.** They still list the Next.js defaults
   (`npm run dev` on port 3000, `npm run start`) which contradict this Vite
   project. Feature 1 updates them; until then they are wrong.
5. **Testing is declared in the stack but the gate is off.** `project-plan.md` §5
   names Vitest, and feature 1 installs it directly, while `AGENTS.md` says
   testing is opt-in via `/tests`. Feature 1 as specified resolves this by
   installing the runner and adding `verify`; run `/tests` afterwards if the
   formal gate should be on.
6. **Feature numbering deviates from convention.** `build-plan.md` numbers the
   scaffold as feature 1, though the Blueprint treats scaffolding as a pre-build
   step. This keeps build-plan IDs aligned one-to-one with the already-written
   spec files. Renumbering later would break archived spec references, so change
   it now or not at all.
