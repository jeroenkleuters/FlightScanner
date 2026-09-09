# Project Plan

FlightScanner - a live aircraft map over the SkySpy WebSocket API.

The detailed technical plan is [`docs/flight-map-plan.md`](../docs/flight-map-plan.md);
per-feature specs are in [`blueprint/context/features/`](context/features/). This
document is the product-level source of truth those are derived from.

## 1. Problem - What problem are we solving?

SkySpy exposes a rich real-time aircraft feed - a WebSocket stream of ADS-B
contacts plus REST lookups for airframe identity - but no map. The data is there
and unreadable: JSON frames at up to 10 Hz describing objects whose whole meaning
is spatial.

FlightScanner turns that stream into the obvious thing: a map you can watch.
Aircraft appear where they are, pointed the way they are flying, coloured by
altitude, and clicking one tells you what it is.

Secondary purpose: it is a study project. The point is to build a genuinely
resilient real-time client - correct reconnection, honest degraded states, a
render path that survives high message rates - not just to get pixels moving.

## 2. Users - Who is this for?

- **The SkySpy operator** - someone running their own receiver who wants to see
  what their antenna is picking up right now, without a terminal.
- **Aviation enthusiasts** near that receiver, watching local traffic.
- **The developer** - this is a learning project for real-time web architecture:
  WebSocket lifecycle management, high-frequency state outside React, and GPU map
  rendering.

Not built for: global coverage, commercial flight tracking, or anything
safety-critical. A single self-hosted receiver sees a radius around one antenna.

## 3. Features - What does the MVP need?

v1, in build order - see `build-plan.md` for the tracked list:

- Full-viewport dark map
- Authenticated WebSocket connection with resilient reconnection
- Aircraft store handling snapshot, update, new, remove, delta, heartbeat
- Aircraft rendered as heading-rotated icons, coloured by altitude
- Click to select: highlight, trail, live telemetry panel
- Connection status, counts, and honest degraded states

v2 adds aircraft identity and photos from the airframes endpoint.

Explicitly excluded from both: ACARS, safety events, alerts, NOTAMs, cannonball
mode, audio, airspace overlays, filtering, search, and user accounts. Route and
origin/destination data is not excluded by choice - **no SkySpy endpoint provides
it**, so it is unavailable without a third-party source.

## 4. Data - What are we storing?

**Nothing persistently.** No database, no backend, no accounts. All state is
in-memory and session-scoped:

- `Map<hex, Aircraft>` - current contacts, keyed by ICAO hex. Never keyed on
  callsign; callsigns change and repeat.
- Trail buffer - ~200 recent positions, for the selected aircraft only, cleared
  on deselect.
- Airframe cache (v2) - identity and photo URLs per hex, including cached misses.

Aircraft payload fields (`hex`, `lat`, `lon`, `alt_baro`, `gs`, `track`,
`flight`, `squawk`, `baro_rate`, `distance_nm`) are all optional except `hex`.
SkySpy's OpenAPI schema declares the aircraft object `additionalProperties: {}`,
so the real shape is deployment-specific and must be confirmed from capture, not
documentation.

## 5. Tech - What stack are we using?

- **Vite + React 18 + TypeScript** - build and UI
- **MapLibre GL JS + react-map-gl** - free, keyless, GPU-rendered vector map.
  Chosen over Leaflet deliberately: Leaflet renders each marker as a DOM node and
  stutters at a few thousand aircraft, while MapLibre draws them in one WebGL
  symbol layer.
- **Native WebSocket, hand-rolled client** - SkySpy's subprotocol auth and
  subscribe protocol are the whole job; a library would be wrapped anyway.
- **Vitest + React Testing Library**, ESLint + Prettier
- **No backend.** The app talks to SkySpy directly.

Data source: self-hosted SkySpy. REST at `{HTTP_BASE}/api/v1/`, WebSocket at
`{WS_BASE}/ws/aircraft/`.

**Auth is settled: the token travels via the `Sec-WebSocket-Protocol` header.**
No query-string fallback, not even in development - query strings leak tokens
into server logs.

## 6. Monetize - How will this make money?

It does not. This is a personal study project with no commercial intent, no ads,
and no accounts. Any future public deployment would first need the token moved
behind a backend proxy, since `VITE_`-prefixed values ship readable in the client
bundle.

## 7. UI/UX - How should this look and feel?

**Reference: [Flightradar24](https://www.flightradar24.com).** Dark desaturated
basemap so terrain recedes; small bright plane silhouettes rotated to heading;
zoom-scaled icons; callsign labels only when zoomed in; click an aircraft and it
highlights while the rest dim, a trail draws behind it, and a side panel shows
live telemetry.

Borrowed: interaction patterns and general visual approach, common to aircraft
trackers. **Not borrowed:** FR24's branding, logo, colour marks, icon artwork, or
map tiles. Our own assets and palette throughout.

Honest about its limits. Three failure modes must be visually distinguishable -
disconnected, connected-but-silent, and token-rejected - because a frozen map
that looks healthy is worse than one that admits it is stale. Aircraft that stop
reporting fade rather than sitting at full brightness. Missing values render as
dashes, never as zeros.

A sparse map is normal, not a bug: one receiver sees one radius.

## 8. Deployment - Where and how will this ship?

**No deployment target yet - local development only.** The app is a static SPA
(`vite build` → `dist/`), so any static host would serve it, but nothing is
planned and `/release` has not been run.

Two things must be resolved before it ships anywhere public:

1. **The token would be exposed.** Every `VITE_`-prefixed variable is baked into
   the client bundle. A public deployment needs a small backend proxy holding the
   token server-side.
2. **CORS and mixed content.** An HTTPS page cannot open a `ws://` socket, and
   browser REST calls need CORS configured on the SkySpy host. Development uses
   Vite's dev proxy - which must be confirmed to forward
   `Sec-WebSocket-Protocol` intact, since proxies that strip it break auth in
   development only.

Env vars by name: `VITE_SKYSPY_HTTP`, `VITE_SKYSPY_WS`, `VITE_SKYSPY_TOKEN`,
`VITE_MAP_STYLE_URL`, `VITE_DEFAULT_CENTER`, `VITE_DEFAULT_ZOOM`.

No database, no workers, no cron. Health check not applicable - it is a static
bundle.
