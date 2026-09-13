# Feature: Mock feed server

**From build-plan:** feature 4
**Build attempt:** 1
**Branch:** feature/mock-feed-server
**Status:** verified

## Goal

Replay `docs/fixtures/opensky-states-nl.json` as a moving, fault-injectable feed
on localhost, so features 5, 6, 7, and 10 can be built and demonstrated without
spending OpenSky credits.

The mock impersonates **OpenSky upstream**, not our proxy. The proxy already
reads its upstream base from `OPENSKY_API_BASE` and its token endpoint from
`OPENSKY_AUTH_URL` (`src/server/env.ts`), so pointing both at the mock exercises
the whole real stack - `src/server/statesHandler.ts`, its error classification,
`src/api/opensky.ts` decoding, and everything built on top - with **zero changes
to shipped application code**. The alternative, a mock that impersonates our own
proxy, would bypass exactly the layer features 5 and 10 need to trust.

`blueprint/context/coding-standards.md` already reserves `mock/` for a
"dev-only mock feed server (plain Node ESM)". That structural choice is kept: no
build step, no new dependency, and nothing in `src/` or `api/` may import it.

## In scope

- `mock/feed.mjs` - pure projection of the captured snapshot forward in time:
  dead-reckoned positions, altitude from vertical rate, refreshed contact times,
  and deterministic churn so aircraft leave and return.
- `mock/server.mjs` - a `node:http` server bound to loopback, serving
  `GET /states/all` with real bounding-box filtering and an
  `X-Rate-Limit-Remaining` countdown, plus a token endpoint.
- Fault injection covering the four failure modes in `project-plan.md` section 7
  plus the empty-box and stale-vector paths, switchable at runtime without a
  restart.
- `npm run mock` script; Vitest and ESLint extended to cover `mock/`.
- `.env.example` mock block and a `docs/mock-feed.md` runbook linked from
  `docs/proxy.md`.

## Out of scope

- The polling loop, backoff, visibility pause, and credit tracking - feature 5.
- The aircraft store, the 30 s removal rule, staleness derivation - feature 6.
- Any map layer, UI, or status indicator - features 7, 8, 10.
- `VITE_OPENSKY_BBOX`. Nothing owns it yet; the mock filters by whatever box the
  request carries and introduces no client variable of its own.
- Synthetic aircraft that are not in the captured fixture, additional fixtures,
  and capturing new ones.
- Hang and slow-response injection. The proxy sets no upstream timeout, so a
  hanging mock would wedge the dev server rather than teach anything. Noted for
  whoever gives `statesHandler` a timeout.
- Browser tests. No browser-test command exists.

## Build loop

`workflow.stepReview` is `feature` and `workflow.checkpointCommits` is
`disabled`: implement all steps, then present **one** review packet covering the
whole feature. No checkpoint commits. `/complete` creates the single feature
commit on `feature/mock-feed-server`.

Every step ends with `npm run verify` green. Steps 2, 3, and 4 additionally end
with a `curl` observation, because HTTP behavior is not reachable from the unit
suite.

## Build steps

- [x] **1. Pure feed projection** - Add `mock/feed.mjs` and `mock/feed.test.mjs`.
      Load the fixture with `node:fs` plus `import.meta.url`, not a JSON import:
      `tsconfig.api.json` and `tsconfig.node.json` have no `resolveJsonModule`,
      and the mock must stay out of every tsconfig program anyway.

      Export `projectStates(states, elapsedSeconds, nowSeconds)`, pure, returning
      a new array of positional vectors in OpenSky's exact wire order:

      - Position: spherical destination-point formula, `R = 6371008.8` m,
        distance `velocity[9] * elapsedSeconds`, bearing `true_track[10]`.
        Normalize longitude into `-180..180`. If `velocity`, `true_track`,
        `lon[5]`, or `lat[6]` is null, leave the position untouched.
      - Altitude: `baro_alt[7] += vertical_rate[11] * elapsedSeconds`, floored at
        0; apply the same delta to `geo_alt[13]` when it is non-null. Null stays
        null. `on_ground[8]` aircraft keep their altitude untouched but still
        move, since the fixture gives them a taxi velocity.
      - `time_position[3]` and `last_contact[4]` become `nowSeconds`.
      - Every other index is copied through unchanged.

      Export `isPresent(icao24, elapsedSeconds)`: FNV-1a 32-bit hash of the hex,
      `offset = hash % 600`; absent while `(elapsedSeconds + offset) % 600 < 45`.
      45 s exceeds the 30 s removal rule, so an absence really drops the aircraft
      and its return is a genuine insert. Roughly 7.5% of the fleet is absent at
      any moment.

      Extend `vite.config.ts` `test.include` to `['src/**/*.test.{ts,tsx}',
      'mock/**/*.test.mjs']`, and add an `eslint.config.js` block for
      `mock/**/*.mjs` using `js.configs.recommended`, `prettier`, and
      `globals.node`, with type-checked rules disabled.

      **Done when** `npm run verify` is green with the new tests running, and
      `mock/feed.test.mjs` proves: an aircraft at 250 m/s on track 090 moves the
      expected distance east after 600 s; a vector with null velocity is
      positionally identical; a null `baro_alt` stays null; altitude never goes
      negative; `last_contact` equals the supplied `nowSeconds`; and a known hex
      from the fixture is absent for exactly 45 s of each 600 s cycle and present
      either side of it. `npm run lint` reports no warnings for `mock/`.

- [x] **2. The HTTP server** - Add `mock/server.mjs`, started by a new
      `"mock": "node mock/server.mjs"` script in `package.json`.

      - `node:http`, bound to `127.0.0.1` only. It has no authentication and
        mutable control routes, so it must never listen on a public interface.
        Port from `MOCK_PORT`, default `8787`.
      - `elapsedSeconds` is wall-clock seconds since the process started, so the
        feed moves in real time at whatever interval the client polls.
      - `GET /states/all?lamin&lomin&lamax&lomax` - project, apply `isPresent`,
        then filter by the requested box exactly as OpenSky does: a vector is
        included when its lat/lon fall inside it. **Positionless vectors are
        included**, matching real OpenSky and the locked rule that positionless
        aircraft stay in the store. Missing or non-finite box parameters are a
        400 `{"error":"invalid-request"}`. Respond `{"time": nowSeconds,
        "states": [...]}`, or `"states": null` when nothing matches - the
        project's locked empty-box shape, never `[]`.
      - `X-Rate-Limit-Remaining` starts at `MOCK_CREDITS` (default 4000) and
        decrements by one per successful `/states/all` response, floored at 0.
      - `POST /token` - returns `{"access_token": "mock-access-token",
        "expires_in": 1800}`. Those are the two fields
        `src/server/openskyToken.ts` reads: it throws without `access_token` and
        treats a missing `expires_in` as an immediate expiry. Confirm both names
        in that file before wiring.
      - Any other path is a 404 `{"error":"not-found"}`. Every response carries
        `Content-Type: application/json` and `Cache-Control: no-store`. No
        `Access-Control-Allow-Origin` header: the app reaches the mock through
        the proxy, server to server, never from the browser.

      **Done when** `npm run mock` logs its URL, and with it running:
      `curl 'http://127.0.0.1:8787/states/all?lamin=50.5&lomin=3.0&lamax=53.8&lomax=7.3'`
      returns a `{time, states}` payload of over 100 vectors; a second call about
      60 s later returns different coordinates for the same hex with a higher
      `time`; `curl` with a narrow box returns strictly fewer vectors; a call
      with no box returns 400; `X-Rate-Limit-Remaining` decreases by one per
      call; and `curl -X POST http://127.0.0.1:8787/token` returns an access
      token. `npm run verify` stays green.

- [x] **3. Fault injection** - Add the switchable fault state and its control
      routes to `mock/server.mjs`.

      Modes, each chosen so the existing classification in
      `src/server/statesHandler.ts` and `src/api/opensky.ts` turns it into a
      distinct client-visible state:

      | Mode | `/states/all` answers | Proxy code | Client reason |
      | --- | --- | --- | --- |
      | `off` (default) | normal 200 | - | normal snapshot |
      | `server-error` | 503, empty body | `upstream-unavailable` | `network` |
      | `rate-limited` | 429, `X-Rate-Limit-Remaining: 0` | `rate-limited` | `rate-limited` |
      | `unauthorized` | 401, and `POST /token` also 401 | `credentials-rejected` | `auth` |
      | `malformed` | 200 with `{"time": "soon"}` | `upstream-malformed` | `malformed` |
      | `empty` | 200 with `{"time": n, "states": null}` | - | valid empty box, not an error |
      | `stale` | 200, normal vectors, `last_contact` and `time_position` set 600 s in the past | - | drives the stale and fade path |

      Reaching 0 credits also answers 429 with `X-Rate-Limit-Remaining: 0`, so
      budget exhaustion can be reached by polling as well as by switching mode.
      Proxy-unreachable is produced by stopping the mock, and is documented
      rather than injected.

      Control surface, dev-only and deliberately trivial:

      - `GET /__mock/control` - `{"fault": "<mode>", "credits": n,
        "elapsedSeconds": n, "visible": n}`.
      - `POST /__mock/control` with a JSON body; `fault` and `credits` are each
        optional. An unknown mode, a malformed body, or a negative or
        non-integer `credits` is a 400 `{"error":"invalid-request"}` that
        changes nothing. Returns the new state. POST rather than GET because it
        mutates; the runbook carries copy-pasteable `curl` lines, so no browser
        address bar is needed.
      - `POST /__mock/reset` - `elapsedSeconds` back to 0, fault back to `off`,
        credits back to the configured start.

      **Done when** each row of the table is observed by `curl` against the mock
      directly: the documented status, body, and headers. `npm run verify` stays
      green.

- [x] **4. Wire-through and runbook** - Prove the mock through the real proxy and
      document it.

      - `.env.example`: a commented mock block showing
        `OPENSKY_API_BASE=http://127.0.0.1:8787` and
        `OPENSKY_AUTH_URL=http://127.0.0.1:8787/token`, stating that both are
        left blank for the real API and that the credentials are irrelevant in
        mock mode. Keep the existing prose intact around it.
      - `docs/mock-feed.md`: why it exists (credits are the scarce resource),
        the two-terminal workflow (`npm run mock`, then `npm run dev`), the
        routes, the fault table above with its `curl` line per mode, the
        movement and churn rules with their constants, and the warning that
        `.env` must be reverted to reach the real API.
      - One line in `docs/proxy.md` under Configuration pointing at it.
      - `AGENTS.md` Commands: `Mock feed: npm run mock (dev only,
        http://127.0.0.1:8787)`.

      **Done when**, with those two variables set in `.env` and both `npm run
      mock` and `npm run dev` running,
      `curl 'http://localhost:5173/api/opensky/states?lamin=50.5&lomin=3.0&lamax=53.8&lomax=7.3'`
      returns a moving snapshot through the real proxy, `/api/health` still
      answers, and each fault mode produces the proxy error code its table row
      predicts, observed at the `localhost:5173` URL rather than at the mock.
      `npm run verify` is green and `npm run lint` reports no warnings.

## Files / areas

New:

- `mock/feed.mjs`, `mock/feed.test.mjs` - pure projection and churn
- `mock/server.mjs` - the HTTP surface
- `docs/mock-feed.md` - runbook

Changed:

- `package.json` - `mock` script
- `vite.config.ts` - `test.include` gains `mock/**/*.test.mjs`
- `eslint.config.js` - a block for `mock/**/*.mjs`
- `.env.example`, `docs/proxy.md`, `AGENTS.md` - documentation

Untouched, deliberately: everything under `src/` and `api/`. If this feature
needs a change there, the design is wrong and it is worth stopping to say so.

## Data / contracts

- **The wire shape is OpenSky's, not ours.** `/states/all` returns
  `{time: number, states: array | null}` where each state is the 17-element
  positional array documented in `docs/fixtures/README.md`, lon at index 5 and
  lat at index 6. Field order and null-ness are copied from the fixture; nothing
  is converted to objects, and no unit conversion happens in the mock. The
  existing decoder owns all of that.
- **`icao24` stays the identity.** The mock never renames, re-cases, or reissues
  a hex; a returning aircraft returns under the same one.
- `X-Rate-Limit-Remaining` is a plain integer string, the header name OpenSky
  uses and `statesHandler.ts` forwards verbatim.
- Errors from the mock's own routes use `{"error": "<code>"}` with
  `invalid-request` and `not-found`, mirroring the proxy's shape. Upstream
  faults deliberately return whatever a broken upstream would, including an
  empty body, so the proxy's classification is genuinely exercised.
- `/__mock/control` is a dev convenience, not a product contract. Nothing in
  `src/` may ever call it.

## Testing

Test gate is on. Unit tests cover `mock/feed.mjs`, where a wrong answer is
possible and silent: the destination-point maths, the null guards, the altitude
floor, the contact-time refresh, and the churn cycle's exact boundaries.

`mock/server.mjs` is HTTP plumbing over that pure core and is verified by the
documented `curl` observations in steps 2, 3, and 4, not by a unit test that
would mostly restate the routing table. The tests run against the committed
fixture only, spend no credit, and reach no network.

## Notes for the AI

- Node 20 is the floor. No TypeScript in `mock/`, no transpile step, no new
  dependency; `node:http`, `node:fs`, and `node:url` only.
- Movement must be a pure function of elapsed time, not an accumulating mutable
  position. Two calls at the same elapsed time must return identical data, and a
  reset must reproduce the run exactly. That is also why there is no PRNG: churn
  is a hash of the hex, not a random draw.
- Feature 6 depends on this moving *and* dropping aircraft. A mock that only
  moves them cannot exercise the reconciler or the 30 s removal rule at all, and
  that is the whole reason this feature precedes 5-7.
- The 45 s absence against a 30 s poll is deliberate: at least one snapshot omits
  the aircraft, the 30 s rule fires, and the reappearance is an insert.
- Never weaken the empty-box contract to `[]`. `null` is what OpenSky sends and
  what both the handler and the decoder are written against.
- Loopback binding is a requirement, not a default. The control routes let any
  caller reshape the feed.


<!-- blueprint:completion {"schemaVersion":1,"specBytes":14767,"specSha256":"3784f0e2a47b7e22c0a52d375aa3ac37a7d0162e4102262cc0aa6a17aa41c619","branch":"refs/heads/feature/mock-feed-server","head":"8dc39f4408aa8a2d3567005766d34cc66f2d6070","baseRef":"refs/heads/master","baseCommit":"8dc39f4408aa8a2d3567005766d34cc66f2d6070","sourceTree":"e24bd9d24c85544ffdb55f96e6bc2c714c0bb7a8","absentOptional":[]} -->
