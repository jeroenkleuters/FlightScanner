# Fix: OpenSky REST data source

**Type:** Fix
**Status:** verified
**Branch:** fix/opensky-rest-data-source

## The problem

The project is configured against SkySpy, but open question 1 in
`blueprint/context/project-overview.md` was never resolved: there is no reachable
SkySpy instance. Without one there are no fixtures, no confirmed handshake, and
features 3 to 7 cannot start.

OpenSky Network is reachable now and was verified live in this session with the
user's own client credentials:

| Check | Result |
| --- | --- |
| OAuth2 `client_credentials` token | 200, JWT, `expires_in` 1800 |
| `GET /states/all` with a bounding box | 200, 134 aircraft, 17.7 KB, 180 ms |
| `GET /tracks/all?icao24=...` | 200, full position path |
| Anonymous request, no token | 200, 400 credits per day per IP |
| Credit cost of one bounded query | 1 credit, confirmed by decrement |

What is wrong today, and where:

- `src/config.ts` requires `VITE_SKYSPY_HTTP` and `VITE_SKYSPY_WS`, so the app
  will not start without a host that does not exist.
- `.env.example` documents only SkySpy variables.
- There is no transport module at all, so nothing can fetch aircraft.

## The fix

Replace the SkySpy configuration and transport with an OpenSky REST polling
adapter.

Decisions settled by the live test:

- **Token endpoint:**
  `https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token`
- **API base:** `https://opensky-network.org/api`
- **Anonymous is the default.** OpenSky serves bounded queries with no
  credentials at 400 credits per day per IP. Client credentials are opt-in for
  local and trusted-network use only, under the same bundle-exposure warning that
  already applies to `VITE_SKYSPY_TOKEN`, because a `VITE_` secret is readable by
  anyone who loads the app.
- **Poll interval floor of 30 s.** Authenticated budget is 4000 credits per day
  and a bounded query costs 1 credit, so 30 s costs about 2880 per day and fits.
  15 s does not. The config parser rejects anything below the floor rather than
  letting the app silently burn the quota.
- **State vectors are positional arrays, not objects.** Index by position and
  guard every read, per the existing rule that every field except the identity
  key is optional:
  `[icao24, callsign, origin_country, time_position, last_contact, lon, lat, baro_alt, on_ground, velocity, true_track, vertical_rate, sensors, geo_alt, squawk, spi, position_source]`
- **`hex` stays the identity key.** OpenSky's `icao24` maps onto it directly, so
  the locked data model in the overview survives the swap unchanged. `callsign`
  is space padded on the wire and maps to `flight` after trimming.

Must not break:

- `src/config.ts` stays the only reader of `import.meta.env`.
- Config errors keep naming the variable and never its value, now including
  `VITE_OPENSKY_CLIENT_SECRET`.
- The map shell and its tests keep passing untouched. This fix adds a data
  source, it does not render anything.
- Transport owns transport only. No domain state, no map imports.

Out of scope, and deliberately so:

- The aircraft store, the map layer, and any rendering. Those stay build-plan
  features.
- Rewriting `project-overview.md` and `build-plan.md`, which still describe a
  SkySpy WebSocket stream. That is a planning change, not a fix. Run `/overview`
  after this lands.

## Build steps

1. [x] **Swap the configuration.** In `src/config.ts`, replace `skySpyHttp`,
   `skySpyWs`, and `skySpyToken` on `AppConfig` with `openSkyApiBase`,
   `openSkyAuthUrl`, `openSkyClientId`, `openSkyClientSecret`, and
   `pollIntervalMs`. Both URLs default to the verified endpoints above and are
   optional overrides. Credentials are optional, and supplying only one of the
   pair is a config error. `VITE_OPENSKY_POLL_MS` defaults to 30000 and is
   rejected below 30000. Update `.env.example` to match, keeping the bundle
   exposure warning. Update `src/config.test.ts` to cover the new parser paths.
   **Done when:** `npm run verify` passes and `npm run dev` starts with no
   `.env` present at all.

2. [x] **Add the OpenSky transport.** New `src/api/opensky.ts`, with `fetch`
   injectable for tests. It holds a token manager that requests a token only when
   credentials are configured, caches it, and refreshes it early on a safety
   margin because the token lives 1800 s. It exposes a bounded states query
   taking a lat/lon box, and a decoder turning a positional state vector into the
   `Aircraft` shape already locked in the overview. Aircraft with no `lat` or
   `lon` are kept, not dropped, matching the existing rule. The query returns the
   discriminated `found` / `missing` / `error` result the standards require and
   never throws into render. A malformed vector is skipped, not fatal. New
   `src/api/opensky.test.ts` covers decoding, absent fields, token caching and
   refresh, the anonymous path, and error mapping including 401, 404, and 429.
   **Done when:** `npm run verify` passes with those tests green.

3. [x] **Capture a real fixture.** Save one live bounded `states/all` response to
   `docs/fixtures/opensky-states-nl.json` and note in the file's sibling README
   which box and date it came from. This replaces what build-plan feature 3 was
   meant to produce and gives feature 4's mock server something real to replay.
   **Done when:** the fixture parses through the step 2 decoder in a test that
   reads the committed file.

## Verify

- `npm run verify` passes: typecheck, tests, build.
- `npm run dev` starts with no `.env` file and the map shell renders as before.
- A scratch script calling the step 2 query against the live API returns aircraft
  for the Netherlands box, anonymously and, when credentials are set, with a
  token.
- Setting `VITE_OPENSKY_POLL_MS=15000` fails startup with an error naming the
  variable.
- Setting a client ID without a secret fails startup, and the message contains
  neither credential value.


<!-- blueprint:completion {"schemaVersion":1,"specBytes":5946,"specSha256":"13c850f66835fcd5d848e6dd09387fcbec94fee0ac8ce8c140652c35fa0c1950","branch":"refs/heads/fix/opensky-rest-data-source","head":"57f9415e9d25a0ab7dafa548ffe78d58ca9b8957","baseRef":"refs/heads/master","baseCommit":"53926d01d8adeceb51bca935ed22d25557ecd102","sourceTree":"6e0c640d668a4f40eb24b04bdc1ab44fbdc5e7ab","absentOptional":[]} -->

## Independent review

**Status:** passed
**Target commit:** 57f9415e9d25a0ab7dafa548ffe78d58ca9b8957
**Base commit:** 53926d01d8adeceb51bca935ed22d25557ecd102
**Base ref:** master
**Spec hash:** 13c850f66835fcd5d848e6dd09387fcbec94fee0ac8ce8c140652c35fa0c1950
**Prepared by:** claude
**Builder model:** claude-opus-5
**Requested reviewer:** claude
**Requested model:** claude-opus-5
**Requested execution:** automatic
**Requested at:** 2026-09-13T09:47:17.493Z
**Workflow:** regular
**Check required:** no
**Reviewer adapter:** claude
**Reviewer model:** claude-opus-5
**Reviewer context:** fresh subagent
**Actual execution:** automatic
**Reviewed at:** 2026-09-13T09:52:00.000Z
**Scope:** current
**Lenses:** quality, security, performance, tests
**Verdict:** passed
**Check result:** not-required

### Commands

- `npm run typecheck`: pass
- `npm test`: pass, 6 files, 81 tests
- `npm run build`: pass, with the pre-existing maplibre chunk size warning
- `npm run lint`: pass
- `npm run format:check`: fail, pre-existing and unrelated. Files untouched by
  this delta (`src/main.tsx`, `src/App.tsx`) fail the same way, because
  `core.autocrlf=true` writes CRLF while Prettier expects LF.

### Evidence

- Reviewed the complete `53926d01..57f9415e` delta, 11 files, reading the full
  current contents of every changed file rather than the diff hunks.
- OpenSky state vector indices in `src/api/opensky.ts:52-62` verified against the
  documented positional contract: 0 icao24, 1 callsign, 4 last_contact,
  5 longitude, 6 latitude, 7 baro_altitude, 8 on_ground, 9 velocity,
  10 true_track, 11 vertical_rate, 14 squawk. All correct, including the
  lon-before-lat ordering that the fixture README calls out.
- Unit factors verified: 3.280839895 m to ft, 196.8503937 m/s to ft/min
  (3.280839895 x 60), 1.943844492 m/s to knots. All three are correct.
- Cross-checked the decoder against the committed fixture: the first vector
  places a4d838 at 52.3134N 4.7652E, which is Schiphol, so the lat/lon indices
  are confirmed by real data and not only by the spec text.
- Token cache maths at `src/api/opensky.ts:184` correctly subtracts the 60 s
  margin; the early refresh test drives the clock to 1 750 000 ms against a
  1 740 000 ms threshold, which exercises the real boundary.
- Concurrent de-duplication at `src/api/opensky.ts:193` is sound: `??=`
  short-circuits, the `.finally` clears the slot on both settle paths, and every
  awaiter observes the same promise.
- Failure paths traced for throw-into-caller: `getToken`, `fetchImpl`, and
  `response.json()` are each wrapped, `decodeStateVector` cannot throw, and no
  reachable path rejects `fetchStates`.
- Secret handling checked: credentials travel in a POST form body, never a query
  string, and no error message or thrown string carries a value.
- Fixture is 19 KB, imported only by a test, and absent from the built bundle.
- No em dash, en dash, or ellipsis character in any changed source, doc, or spec.

### Findings

- F-01 [P2] open, token endpoint outage reported as an auth failure
- F-02 [P2] open, OAuth token endpoint may be overridden to plain http
- F-03 [P3] open, token response without `expires_in` caches an expired token
- F-04 [P3] open, empty rate limit header reports zero credits remaining
- F-05 [P3] open, unreachable credentials guard inside `requestToken`
- F-06 [P3] open, token failure paths other than a 401 status are untested

### Remaining risk

- `npm run format:check` could not pass on this machine, repo-wide and including
  files this delta never touched. Established as pre-existing CRLF drift, not a
  defect in this change, but formatting of the new files is therefore unverified
  by that command.
- No live API call was made from this review, so the endpoints, quota figures,
  and credit costs recorded in the spec and comments rest on the builder's
  session evidence and on the committed fixture, not on independent observation.
- Browser verification was not run and is not configured for this project, so the
  spec's "`npm run dev` starts with no `.env`" acceptance line is unverified here.
  Typecheck and build passing with no `.env` present is partial evidence only.
- Check was not required and was not run, so no runtime proof of the transport
  against the spec exists in this receipt.
- `VITE_OPENSKY_CLIENT_SECRET` is compiled into the browser bundle by design.
  That is an accepted, documented decision with anonymous access as the default
  and warnings in `src/config.ts`, `.env.example`, and the spec, so it is not
  raised as a finding, but it stays a real deployment hazard until a backend
  proxy exists.
- The transport has no consumer yet, so its error classification is reviewed
  against the standards rather than against an observed user-facing surface.
