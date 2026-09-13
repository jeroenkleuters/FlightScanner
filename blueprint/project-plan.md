# Project Plan

FlightScanner - a live aircraft map over the OpenSky Network REST API.

Per-feature specs are in [`blueprint/context/features/`](context/features/), and
the proxy runbook is [`docs/proxy.md`](../docs/proxy.md). This document is the
product-level source of truth those are derived from.

> **Data source changed on 2026-09-13.** This project was planned against a
> self-hosted SkySpy WebSocket API. No reachable instance ever existed, so the
> build stalled after feature 2. The source is now the public OpenSky Network
> REST API, verified live. The switch is not cosmetic: OpenSky is polled rather
> than streamed, and it blocks browser origins, which is why this plan now
> includes a backend proxy it previously ruled out. The old SkySpy technical
> plan (`docs/flight-map-plan.md`) and the nine specs written against it were
> deleted on 2026-09-13 rather than left to mislead; everything from them that
> survived the switch is in this document.

## 1. Problem - What problem are we solving?

Public ADS-B data is available but not watchable. OpenSky Network exposes live
aircraft state vectors over REST, and they arrive as positional JSON arrays whose
whole meaning is spatial: a list of numbers describing where things are and which
way they are pointed.

FlightScanner turns that feed into the obvious thing: a map you can watch.
Aircraft appear where they are, pointed the way they are flying, coloured by
altitude, and clicking one tells you what it is. OpenSky has its own map; this is
not an attempt to beat it, it is a Flightradar24-style client built from the raw
feed.

Secondary purpose: it is a study project. The original goal was WebSocket
lifecycle management. Polling removes that, so the remaining architectural
exercises are the real ones left: reconciling successive snapshots into stable
aircraft identity, a render path that stays cheap as the fleet grows, honest
degraded states, and working inside a hard external quota.

## 2. Users - Who is this for?

- **Aviation enthusiasts** watching traffic over a chosen region, anywhere
  OpenSky has coverage.
- **The developer** - this is a learning project for real-time web architecture:
  snapshot reconciliation, high-frequency state outside React, and GPU map
  rendering.

Not built for: global simultaneous coverage, commercial flight tracking, or
anything safety-critical. The map shows one bounding box at a time, refreshed on
an interval, not a continuous stream.

## 3. Features - What does the MVP need?

v1, in build order - see `build-plan.md` for the tracked list:

- Full-viewport dark map
- A minimal backend proxy that reaches OpenSky and holds credentials
- Polling client over one **fixed bounding box**, with backoff, visibility
  pause, and credit budget awareness
- Aircraft store reconciling successive full snapshots into stable identities,
  deriving departures and staleness
- Aircraft rendered as heading-rotated icons, coloured by altitude
- Click to select: highlight, trail, live telemetry panel
- Poll status, counts, remaining credits, and honest degraded states

v2 adds aircraft identity and photos from third-party sources, since OpenSky
provides neither.

Explicitly excluded from both: ACARS, safety events, alerts, NOTAMs, cannonball
mode, audio, airspace overlays, filtering, search, user accounts, and a
viewport-following query region. Route and
origin/destination data is not excluded by choice - **no OpenSky endpoint
provides it**, so it is unavailable without a third-party source.

## 4. Data - What are we storing?

**Nothing persistently.** No database, no accounts. The proxy is stateless. All
app state is in-memory and session-scoped:

- `Map<hex, Aircraft>` - current contacts, keyed by ICAO hex. Never keyed on
  callsign; callsigns change and repeat.
- Trail buffer - ~200 recent positions, for the selected aircraft only, cleared
  on deselect.
- Identity cache (v2) - identity and photo per hex, including cached misses.

Aircraft fields (`hex`, `lat`, `lon`, `alt_baro`, `gs`, `track`, `flight`,
`squawk`, `baro_rate`, `on_ground`, `lastContact`) are all optional except `hex`.
OpenSky returns each aircraft as a **positional array, not an object**, so every
index must be read by position and guarded. `distance_nm` is dropped: it was a
SkySpy receiver-range value with no OpenSky equivalent.

`lastContact` is new and load-bearing. Polling returns vectors that are already
seconds or minutes old, so the client must distinguish when it last polled from
when the aircraft was last actually heard.

**Aircraft are dropped 30 seconds after the last snapshot that contained them.**
OpenSky sends no removal event: an aircraft that lands, leaves the box, or stops
being heard simply stops appearing, so the store has to decide when a contact is
gone. The rule is evaluated only when a new snapshot arrives, never on a timer,
which ties it to the poll cadence and means the map cannot empty itself between
polls. At the default 30 s interval that makes the first snapshot omitting an
aircraft the one that removes it, with no lingering ghosts at a stale position.

That is separate from **fading**, which is driven by `lastContact` and describes
how old OpenSky's own reading is. An aircraft still present in every snapshot
can fade because its position fix is minutes old; an aircraft that disappears
between polls is dropped outright.

## 5. Tech - What stack are we using?

- **Vite + React 18 + TypeScript** - build and UI
- **MapLibre GL JS + react-map-gl** - free, keyless, GPU-rendered vector map.
  Chosen over Leaflet deliberately: Leaflet renders each marker as a DOM node and
  stutters at a few thousand aircraft, while MapLibre draws them in one WebGL
  symbol layer.
- **Hand-rolled REST transport** - positional vector decoding, OAuth2 client
  credentials with an early-refresh token cache, and a discriminated result type
  that never throws into render.
- **A minimal backend proxy** - Node, deployable as a serverless function. It is
  required, not optional; see the CORS constraint below.
- **Vitest + React Testing Library**, ESLint + Prettier

Data source: OpenSky Network. REST at `https://opensky-network.org/api`, OAuth2
tokens from the public Keycloak realm.

**Verified live on 2026-09-13:**

| Fact | Value |
| --- | --- |
| Token lifetime | 1800 s |
| Bounded `states/all` query | 1 credit |
| Authenticated budget | 4000 credits per day |
| Anonymous budget | 400 credits per day per IP |
| Minimum safe poll interval | 30 s |

**The query region is one fixed bounding box, and it does not follow the map.**
Every poll asks OpenSky for the same box, set once by configuration and constant
for the session. Panning and zooming move the camera over data already fetched;
they never trigger a request. Three reasons, in order of weight:

1. **Cost is predictable.** One bounded query is one credit whatever its size,
   but a box that tracks the viewport turns every pan into a poll of its own,
   and the daily budget is 4000. A fixed box spends exactly one credit per
   interval no matter how much the user moves around.
2. **Identity survives.** The store reconciles successive snapshots into stable
   aircraft. If the box moved with the camera, every pan would make aircraft
   vanish and reappear as the query region changed underneath them, and trails
   and selection would break on a plain map drag.
3. **It is honest about coverage.** A fixed box is a claim the app can keep: this
   region, refreshed every 30 s. A moving box would promise global coverage the
   credit budget cannot pay for.

The consequence is deliberate and must be visible rather than hidden: panning
outside the box shows empty map, because nothing outside it was ever fetched.
The default box is `50.5,3.0,53.8,7.3` - roughly the Netherlands with the
Belgian and German border regions, matching the default Amsterdam centre and the
committed fixture. Changing region is a configuration change and a reload, not an
in-app gesture.

**Architecture decisions that outlived the SkySpy plan.** These were settled
before the data source changed and still hold, because they are about rendering
and identity rather than transport:

- **`hex` is the identity key.** Never key on callsign; it changes and repeats.
- **The store is a mutable `Map`, not React state.** Hundreds of aircraft moving
  through `useState` would melt the app. React re-renders for poll status, the
  selected aircraft, and counts; aircraft movement never passes through the
  reconciler.
- **The render path is a throttled `setData()`** on one MapLibre GeoJSON source,
  not a marker per aircraft.
- **Aircraft without a position are kept in the store but omitted from the
  layer.** They still count, and a later snapshot may give them a fix.
- **The trail buffer is separate from the aircraft store and holds one
  aircraft.** A ring buffer of about 200 points for the selected `hex`, cleared
  on deselect, so it costs nothing when nothing is selected and cannot grow
  unbounded across a long session.

**The browser cannot call OpenSky directly.** It returns
`Access-Control-Allow-Origin: https://opensky-network.org` to every origin,
confirmed with a real preflight, and the token endpoint sends no CORS header at
all. A proxy is therefore mandatory for the app to function, not merely to hide
credentials. The proxy holds the client credentials server side, which also keeps
them out of the browser bundle.

## 6. Monetize - How will this make money?

It does not. This is a personal study project with no commercial intent, no ads,
and no accounts. The daily credit budget is the real constraint to respect, and
the proxy is the natural place to enforce it.

## 7. UI/UX - How should this look and feel?

**Reference: [Flightradar24](https://www.flightradar24.com).** Dark desaturated
basemap so terrain recedes; small bright plane silhouettes rotated to heading;
zoom-scaled icons; callsign labels only when zoomed in; click an aircraft and it
highlights while the rest dim, a trail draws behind it, and a side panel shows
live telemetry.

Borrowed: interaction patterns and general visual approach, common to aircraft
trackers. **Not borrowed:** FR24's branding, logo, colour marks, icon artwork, or
map tiles. Our own assets and palette throughout.

Honest about its limits. Four failure modes must be visually distinguishable,
because a frozen map that looks healthy is worse than one that admits it is
stale:

1. **Proxy unreachable** - retrying with backoff
2. **Polling but the data is old** - OpenSky answered, the vectors are stale
3. **Credit budget exhausted** - not an error, and retrying will not help until
   the daily reset
4. **Credentials rejected** - not retrying

Aircraft that stop reporting fade rather than sitting at full brightness, and
are removed 30 s after the last snapshot that held them rather than frozen in
place. Missing values render as dashes, never as zeros. A sparse map is normal:
the map shows one bounding box, and OpenSky coverage varies by region.

**Panning outside the fixed box shows nothing, and the app must say so.** An
empty map is indistinguishable from a broken one, so when the viewport leaves
the polled region the UI states that the camera is outside the covered area
rather than letting the user read it as a dead feed. The box itself should be
drawn on the map, faintly, so its edge is visible before the user crosses it.

## 8. Deployment - Where and how will this ship?

**Vercel.** The repository is imported as a Vercel project. The app is a static
SPA (`vite build` → `dist/`) plus two proxy endpoints, so a host that serves
static files alongside serverless functions fits naturally. `vercel.json` pins
the build command, `dist/` as the output directory, and an SPA rewrite that
leaves `/api/` alone; `api/opensky/states.ts` and `api/health.ts` are the
function entrypoints and share `src/server/router.ts` with the dev and preview
servers. The OpenSky credentials are set as Vercel project environment
variables, so the deployment runs authenticated at 4000 credits per day.
`docs/proxy.md` is the runbook. `/release` has not been run, so readiness checks
and smoke tests are still unrecorded.

Constraints:

1. **The proxy is required in every environment**, including local development.
   Vite's dev proxy covers development; production needs the real thing.
2. **Credentials live only on the proxy.** Nothing sensitive belongs in a
   `VITE_` variable, since every one of them is readable in the client bundle.
3. **The credit budget is per account, not per user.** A public deployment shares
   one 4000 per day budget across everyone who loads it, so the poll interval,
   the bounding box, and any caching are deployment decisions, not just client
   ones. Because the box is fixed rather than viewport-driven, a shared
   deployment costs one credit per interval in total, not one per viewer per
   pan - which is what makes a public deployment affordable at all.

Client env vars by name, all optional and baked into the bundle at build time:
`VITE_OPENSKY_POLL_MS`, `VITE_OPENSKY_BBOX`, `VITE_MAP_STYLE_URL`,
`VITE_DEFAULT_CENTER`, `VITE_DEFAULT_ZOOM`. `VITE_OPENSKY_BBOX` is the fixed
query region as `lamin,lomin,lamax,lomax`, defaulting to `50.5,3.0,53.8,7.3`;
it is a deployment decision, since it sets what everyone loading that
deployment sees, and it is validated in `src/config.ts` like every other
client variable. Server-side only: `OPENSKY_CLIENT_ID`,
`OPENSKY_CLIENT_SECRET`, `OPENSKY_API_BASE`, `OPENSKY_AUTH_URL`.

No database, no workers, no cron. Health check applies to the proxy only.
