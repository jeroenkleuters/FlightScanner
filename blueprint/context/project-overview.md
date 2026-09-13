# FlightScanner - Project Overview

<!-- blueprint:source-hash 8dd500f32f10e31adc7cca1151e8ba3829b0aa6ca3314e29a379fb711baa0c94 -->

> A live aircraft map over the OpenSky Network REST API, built with Vite, React,
> and MapLibre.

## Problem

Public ADS-B data is available but not watchable. OpenSky Network exposes live
aircraft state vectors over REST as positional JSON arrays whose whole meaning is
spatial. FlightScanner renders that feed as a Flightradar24-style map you can
watch.

It is also a study project. The original goal was WebSocket lifecycle management;
polling removes that. The remaining architectural exercises are reconciling
successive snapshots into stable identity, a render path that stays cheap as the
fleet grows, honest degraded states, and working inside a hard external quota.

> **Data source changed 2026-09-13.** Planned against a self-hosted SkySpy
> WebSocket API that never had a reachable instance. Now the public OpenSky REST
> API, verified live. Polled rather than streamed, and it blocks browser origins.

## Users

| User | Needs |
| --- | --- |
| **Aviation enthusiast** | Watch traffic over a chosen region, anywhere OpenSky has coverage |
| **The developer** | A real exercise in snapshot reconciliation, high-frequency state outside React, and GPU map rendering |

No accounts, no access tiers, a single anonymous view. Not built for global
simultaneous coverage, commercial tracking, or anything safety-critical. The map
shows one bounding box at a time, refreshed on an interval.

## Features

Build-plan order. **Headline feature: 9 - selection, detail panel, and trail**;
that is the Flightradar24 moment the rest of v1 exists to support.

### v1 - live map

1. **Project scaffold** - Vite + React + TS, lint, format, Vitest, env config, `verify` script. **Done.**
2. **Map shell** - full-viewport dark MapLibre map centred on the configured location. **Done.**
2. **Backend proxy** - stateless proxy for OpenSky states and tokens, credentials server side, verified from the browser.
3. **Mock feed server** - replay the committed fixture as a moving feed with fault injection.
4. **Polling client** - interval loop over the shipped transport, visibility pause, backoff, credit tracking.
5. **Aircraft store** - pure `Map<hex, Aircraft>` reconciling successive full snapshots, deriving departures and staleness.
7. **Aircraft layer** - one GeoJSON symbol layer, heading-rotated icons, throttled updates.
8. **FR24-style visual pass** - altitude colour ramp, zoom sizing, labels, stale fading, legend.
9. **Selection, detail panel, and trail** - click to select, fleet dims, trail draws, live telemetry.
10. **Poll status and resilience** - status indicator, remaining credits, stale warning, manual refresh.
11. **Documentation and polish** - README, loading and error states, responsive layout, accessibility.

### v2 - aircraft identity and photos

12. **Identity API client and cache** - lazy per-selection adsbdb lookup, miss caching, dedupe.
13. **Identity block** - registration, type, manufacturer, operator, country in the panel.
14. **Aircraft photo** - planespotters photo via the proxy, mandatory photographer and link attribution.
15. **Map enrichment from identity** - per-type silhouettes, cache-only.

> **Nine spec files are stale.** Items 3, 4, 5, 6, 10, 12, 13, 14, and 15 still
> have SkySpy WebSocket specs in `blueprint/context/features/`, and
> `docs/flight-map-plan.md` is stale throughout. Respec those from this overview
> rather than reading the old files. Items 7, 8, 9, and 11 are source-agnostic
> and their specs remain usable.

**Already shipped outside the build plan:** the `opensky-rest-data-source` fix
delivered `src/api/opensky.ts` (token cache, bounded states query, positional
vector decoder), the `Aircraft` type, OpenSky config, and a real captured fixture
at `docs/fixtures/opensky-states-nl.json`. Feature 3 is proxy work, not decoding
work.

**Explicitly excluded** from both phases: ACARS, safety events, alerts, NOTAMs,
cannonball mode, audio, airspace overlays, filtering, search, user accounts, and
whole-fleet trails. Route and origin/destination data is excluded by necessity -
no OpenSky endpoint provides it.

## Data model

**Nothing is persisted.** No database, no accounts; the proxy is stateless. All
app state is in-memory and session-scoped. The shapes below are contracts that
features 5-15 depend on.

### Aircraft

Keyed by `hex` in `Map<hex, Aircraft>`. **Every field except `hex` and the two
client-recorded ones is optional.** OpenSky returns each aircraft as a
**positional array, not an object**, so every index is read by position and
guarded. Defined in `src/types/aircraft.ts`.

- `hex` (string, **required**) - ICAO 24-bit identifier, lowercase. The identity key
- `flight` (string?) - callsign, space-padded on the wire; trimmed on read
- `lat` (number?), `lon` (number?) - position; absent before a fix. **OpenSky sends lon at index 5 and lat at index 6**
- `alt_baro` (number?) - barometric altitude, ft, converted from metres
- `gs` (number?) - ground speed, kt, converted from m/s
- `track` (number?) - heading, degrees; falls back to 0 for rotation
- `squawk` (string?) - transponder code
- `baro_rate` (number?) - vertical speed, ft/min, converted from m/s
- `on_ground` (boolean?)
- `lastContact` (number?) - when OpenSky last heard the aircraft, epoch seconds
- `lastSeen` (number) - client-recorded receipt time, ms, **not** from the payload
- `stale` (boolean) - derived by the store, not the transport

> **Locked:** `hex` is the identity key everywhere. Never key on `flight` -
> callsigns change and repeat. Aircraft without `lat`/`lon` stay in the store but
> are excluded from map output.

> `lastContact` is load-bearing. Polling returns vectors already seconds or
> minutes old, so the client must distinguish when it last polled from when the
> aircraft was last actually heard. `distance_nm` is dropped: it was a SkySpy
> receiver-range value with no OpenSky equivalent.

### Snapshot reconciliation

There is no message envelope. Each poll returns the **complete** set of state
vectors inside the bounding box, so the store diffs successive snapshots:

| Situation | Store effect |
| --- | --- |
| `hex` in new snapshot, not in store | Insert |
| `hex` in both | Update in place, preserving trail and selection |
| `hex` in store, absent from snapshot | Not deleted immediately. Marked stale, dropped after a grace period |
| Empty or `null` `states` | A valid empty box, never an error |

> A single absence is not a departure. Aircraft drop out of one poll and return in
> the next, so removal is time-based, not presence-based.

### TrailBuffer

Ring buffer for the **selected aircraft only**, held separately from the store so
it costs nothing when nothing is selected.

- `hex` (string) - the aircraft it belongs to
- `points` (array of `{lat, lon}`, cap ~200) - oldest discarded past the cap
- cleared on deselect and on selection change, never merged between aircraft

> Client-side only, and at a 30 s poll interval a trail is a coarse dotted track,
> not a smooth path. It is not flight history and must not be presented as such.

### AircraftIdentity (v2)

From adsbdb `GET https://api.adsbdb.com/v0/aircraft/{hex}`, browser-callable
(`Access-Control-Allow-Origin: *`). All fields optional except `hex`.

- Identity: `registration`, `icao_type`, `type`, `manufacturer`
- Operator: `registered_owner`, `registered_owner_operator_flag_code`,
  `registered_owner_country_name`, `registered_owner_country_iso_name`

> **No `is_military`, serial number, or build year from any available source.**
> The military badge (13) and military colouring (15) are dropped, not deferred.

### AircraftPhoto (v2)

From planespotters `GET https://api.planespotters.net/pub/photos/hex/{hex}`.

- `thumbnail`, `thumbnail_large` - `{src, size:{width,height}}`
- `link` - the planespotters page
- `photographer` - **mandatory attribution, rendered every time**

> Requires a descriptive `User-Agent` with a contact URL. Browsers forbid setting
> that header, so **this call must go through the feature 3 proxy.**

### IdentityCache (v2)

`Map<hex, CacheEntry>` where an entry is `pending`, `loaded`, or `missing`.

> **Locked:** misses are cached too - reselecting an aircraft with no record must
> not refetch a known 404. Lookups are lazy and per-selection; the map layer reads
> the cache but **never triggers a fetch**.

### PollStatus

`idle` | `polling` | `ok` | `stale` | `budget-exhausted` | `auth-failed` | `unreachable`.

> Four failure modes must stay visually distinguishable: proxy unreachable
> (retrying), data old (OpenSky answered with stale vectors), budget exhausted
> (**not an error, and retrying will not help until the daily reset**), and
> credentials rejected (**not** retrying).

## Tech stack

- **Vite + React 18 + TypeScript** - build and UI
- **MapLibre GL JS + react-map-gl** - keyless, GPU-rendered vector map. Chosen
  over Leaflet deliberately: Leaflet renders each marker as a DOM node and
  stutters at a few thousand aircraft; MapLibre draws them in one WebGL symbol
  layer.
- **Hand-rolled REST transport** - positional vector decoding, OAuth2 client
  credentials with an early-refresh token cache, and a discriminated
  `found`/`missing`/`error` result that never throws into render
- **A minimal backend proxy** - Node, deployable as a serverless function.
  **Required, not optional.**
- **Vitest + React Testing Library**, ESLint + Prettier

### External APIs

**OpenSky Network.** REST at `https://opensky-network.org/api`, OAuth2 tokens
from the public Keycloak realm at
`https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token`.

Verified live 2026-09-13:

| Fact | Value |
| --- | --- |
| Token lifetime | 1800 s |
| Bounded `states/all` query | 1 credit |
| Authenticated budget | 4000 credits per day |
| Anonymous budget | 400 credits per day per IP |
| Minimum safe poll interval | 30 s (about 2880 credits per day) |

> **The browser cannot call OpenSky directly.** It returns
> `Access-Control-Allow-Origin: https://opensky-network.org` to every origin,
> confirmed with a real preflight, and the token endpoint sends no CORS header at
> all. The proxy is mandatory for the app to function, not merely to hide
> credentials. It also keeps the client secret out of the bundle.

**adsbdb** (v2 identity) and **planespotters** (v2 photos). Both send
`Access-Control-Allow-Origin: *`; planespotters additionally requires a
descriptive `User-Agent`, so it goes through the proxy.

## Monetization

Not in v1, and not planned. Personal study project - no ads, no accounts, no
commercial intent. The daily credit budget is the real constraint, and the proxy
is the natural place to enforce it.

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
- Poll status + stats bar - persistent, unobtrusive, shows remaining credits
- Altitude legend - compact, non-blocking

Honest about limits: a frozen map that looks healthy is worse than one admitting
it is stale. Aircraft that stop reporting fade rather than sitting at full
brightness; missing values render as dashes, never zeros; a sparse map is normal
because the view is one bounding box and OpenSky coverage varies by region.

## Deployment

**Target: Vercel.** The repository is imported as a Vercel project. `/release`
has not been run, so deploy readiness and smoke tests are not yet documented as
a checked pass.

A static SPA (`vite build` → `dist/`) plus two proxy endpoints, which is why a
host serving static files alongside serverless functions fits naturally.
`vercel.json` pins the build command, `dist/` as the output, and an SPA rewrite
that leaves `/api/` alone. `api/opensky/states.ts` and `api/health.ts` are the
function entrypoints and share `src/server/router.ts` with the dev and preview
servers, so there is no deploy-only code path. `OPENSKY_CLIENT_ID` and
`OPENSKY_CLIENT_SECRET` are set as Vercel project variables, so the deployment
runs authenticated at 4000 credits per day. See `docs/proxy.md` for the
runbook.

1. **The proxy is required in every environment**, including local development.
   Vite's dev proxy covers development; production needs the real thing.
2. **Credentials live only on the proxy.** Every `VITE_` variable is readable in
   the client bundle, so nothing sensitive belongs there.
3. **The credit budget is per account, not per user.** A public deployment shares
   one 4000 per day budget across everyone who loads it, making the poll interval
   and any caching deployment decisions, not just client ones.

Client env vars by name, all optional and baked into the bundle at build time:
`VITE_OPENSKY_POLL_MS`, `VITE_MAP_STYLE_URL`, `VITE_DEFAULT_CENTER`,
`VITE_DEFAULT_ZOOM`. Server-side only: `OPENSKY_CLIENT_ID`,
`OPENSKY_CLIENT_SECRET`, `OPENSKY_API_BASE`, `OPENSKY_AUTH_URL`.

No database, workers, or cron. Health check applies to the proxy only.

## Open questions

> Resolve these in the plans, then re-run `/overview`.

1. **Which bounding box, and does it follow the map?** `VITE_DEFAULT_CENTER` is
   set to Amsterdam, but no plan says whether the polled box is fixed or tracks
   the viewport. Tracking the viewport means a new box on every pan, which
   interacts directly with the credit budget.
2. **How long before an absent aircraft is dropped?** Snapshot reconciliation
   needs a grace period. The old 60 s stale / 5 min drop came from a 10 Hz stream
   and is unlikely to be right at a 30 s poll.
3. **Nine stale spec files and `docs/flight-map-plan.md`.** Listed above. They
   describe a WebSocket architecture that no longer exists and will mislead
   `/feature` until rewritten.
4. **Six open findings in the ledger.** F-01 and F-02 from the OpenSky fix are
   P2 and both partly dissolve once the proxy exists, since credentials move
   server side. Worth re-auditing after feature 3 rather than fixing twice.
