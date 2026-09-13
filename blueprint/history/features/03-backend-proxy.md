# Feature: Backend proxy

**From build-plan:** feature 3
**Build attempt:** 1

**Branch:** feature/backend-proxy

> The pre-written spec at `blueprint/context/features/03-*` is stale: it verifies
> a SkySpy WebSocket handshake that no longer exists. This spec was written from
> `blueprint/build-plan.md` and `blueprint/context/project-overview.md` instead.
> Do not read the stale file.

## Goal

Stand up the minimal stateless backend proxy that every live-data feature
depends on. The browser cannot call OpenSky at all: `states/all` answers every
origin with `Access-Control-Allow-Origin: https://opensky-network.org`, and the
Keycloak token endpoint sends no CORS header. The proxy is what makes the app
function, and it is also where the OpenSky client secret stops being a bundled
string.

After this feature: one `GET /api/opensky/states` route returns live OpenSky
state vectors to a same-origin browser request, the OAuth2 token exchange happens
server side behind a per-instance cache, no credential reaches the client bundle,
and the route works identically under `npm run dev` and on Vercel.

## Design reference

None. This feature ships no UI.

## In scope

- A Vercel Function proxy, Web `Request`/`Response` handlers, with the testable
  core under `src/server/` and thin entrypoints under `api/`.
- `GET /api/opensky/states` - validates a client-supplied bounding box, adds the
  server's bearer token, calls OpenSky, and returns the snapshot JSON.
- `GET /api/health` - reports that the proxy is reachable and whether it holds
  credentials. Named in the overview as the only health surface.
- Server-side OAuth2 client-credentials token exchange with the existing
  early-refresh cache logic, ported out of `src/api/opensky.ts`.
- A stable JSON error contract that keeps the four failure modes feature 10 must
  render visually distinguishable.
- A Vite dev-server plugin mounting the same handlers at `/api/*`, so the proxy
  is present in local development as the overview requires.
- Switching the browser client to the proxy: `createOpenSkyClient` loses its
  token and credential path and fetches the proxy route instead. The decoder and
  its tests stay as they are.
- Config and env changes: OpenSky credentials and upstream URLs become
  server-only variables; the `VITE_OPENSKY_CLIENT_ID` / `VITE_OPENSKY_CLIENT_SECRET`
  pair is removed.
- `vercel.json`, the api TypeScript project, and lint coverage for `api/`.

## Out of scope

- Any polling loop, interval, backoff, or visibility pause. That is feature 5.
  Nothing in the app calls the proxy on a timer after this feature.
- Any UI, status indicator, or credit display. That is feature 10.
- The mock feed server. That is feature 4.
- Credit budget enforcement, request throttling, rate limiting, or caching of
  snapshots in the proxy. The proxy is stateless by contract; it reports the
  remaining-credits header and enforces nothing.
- The planespotters photo route. It belongs to feature 14, which will add a
  second route beside this one. This feature only establishes the layout that
  makes that additive.
- Choosing the deployed bounding box or deciding whether it follows the viewport.
  The proxy takes whatever box the caller sends, so both answers stay open.
- Deploying anything. `/release` is a separate explicit step.
- Rewriting `blueprint/context/coding-standards.md` or `docs/flight-map-plan.md`,
  both of which still describe the SkySpy WebSocket design.

## Build loop

`workflow.stepReview` is `feature` and `workflow.checkpointCommits` is
`disabled`. Implement all build steps in order, keeping the project working and
`npm run verify` green after each, then present one review packet covering the
whole feature. No checkpoint commits. `/complete` creates the single feature
commit.

## Build steps

- [x] 1. **Server token exchange.** Add `src/server/openskyToken.ts` exporting
      `createTokenProvider({ authUrl, credentials, fetch, now })` with
      `getToken(): Promise<string | undefined>` and `invalidate()`. Port the
      existing logic from `src/api/opensky.ts`: the 60 s refresh margin, the
      single in-flight request shared by concurrent callers, and `undefined` for
      anonymous access. `fetch` and `now` are injected. Throw a plain `Error`
      with no credential text on a failed exchange.
      **Done when** `src/server/openskyToken.test.ts` passes with fake timers and
      an injected fetch, covering: anonymous returns `undefined` and performs no
      request; a successful exchange caches and reuses the token; the token is
      re-requested after `expires_in` minus the margin; two concurrent calls make
      one request; `invalidate()` forces the next call to re-request; a non-OK
      response and a response without `access_token` both throw; and no thrown
      message or property contains the client secret. `npm run verify` green.

- [x] 2. **States handler core.** Add `src/server/statesHandler.ts` exporting
      `handleStatesRequest(request, deps)` where `deps` is
      `{ apiBase, tokenProvider, fetch }`, returning a `Response`. Behavior:
      - Non-`GET` returns 405 `{"error":"method-not-allowed"}`.
      - Requires `lamin`, `lomin`, `lamax`, `lomax`. Each must parse as a finite
        number; latitudes in -90..90, longitudes in -180..180, `lamin <= lamax`,
        `lomin <= lomax`. Anything else is 400 `{"error":"invalid-request"}`.
      - Forwards **only** those four params upstream, re-serialized from the
        parsed numbers, so the route cannot be used as an open relay.
      - Adds `Authorization: Bearer <token>` when the provider returns one, and
        omits the header entirely when it does not.
      - Upstream 401 or 403 calls `tokenProvider.invalidate()` and returns 502
        `{"error":"credentials-rejected"}`.
      - Upstream 429 returns 429 `{"error":"rate-limited"}`.
      - A thrown fetch or upstream 5xx returns 502 `{"error":"upstream-unavailable"}`.
      - A non-JSON body, a non-object body, or a `time` that is not a finite
        number returns 502 `{"error":"upstream-malformed"}`.
      - Success returns 200 with a re-serialized `{ time, states }` body, where
        `states` is the upstream array or `null`. Unknown upstream fields are
        dropped.
      - Forwards `X-Rate-Limit-Remaining` verbatim when upstream sent it.
      - Every response carries `Content-Type: application/json` and
        `Cache-Control: no-store`, and **no** `Access-Control-Allow-Origin`
        header. The route is same-origin only; a wildcard would let any site
        spend this account's daily credits.
      - No response body ever contains upstream body text, a header value other
        than the credit count, or any part of a credential.

      **Done when** `src/server/statesHandler.test.ts` covers each row above with
      an injected fetch, asserts the exact forwarded upstream URL for a valid box,
      asserts no `Access-Control-Allow-Origin` header on a success and on an
      error, and asserts that a 401 response body contains neither the secret nor
      the upstream text. `npm run verify` green.

- [x] 3. **Entrypoints and dev mounting.** Add:
      - `src/server/env.ts` - reads `process.env` once into
        `{ apiBase, authUrl, credentials? }`, applying the same defaults as
        `DEFAULT_OPENSKY_API_BASE` / `DEFAULT_OPENSKY_AUTH_URL`. Exactly one of
        `OPENSKY_CLIENT_ID` / `OPENSKY_CLIENT_SECRET` set is a configuration
        error, surfaced as 500 `{"error":"proxy-misconfigured"}` rather than a
        silent drop to the 400-credit anonymous quota.
      - `src/server/healthHandler.ts` - 200
        `{"status":"ok","credentials":"configured"|"anonymous"}`, `no-store`, no
        secret and no URL in the body.
      - `api/opensky/states.ts` and `api/health.ts` - thin default-export
        handlers wiring real `process.env`, `globalThis.fetch`, and a
        module-scope token provider. The cache is best effort: a serverless
        instance may be recycled at any time, and a cold start simply re-exchanges.
      - `vite.config.ts` - a small local plugin using
        `configureServer`/`configurePreviewServer` that mounts the same two
        handlers at `/api/opensky/states` and `/api/health`, converting between
        Node req/res and Web `Request`/`Response`. One implementation serves dev,
        preview, and production.
      - `tsconfig.api.json` (lib `ES2023` + `DOM`, `types: ["node"]`, include
        `api`), referenced from the root `tsconfig.json`, so `npm run typecheck`
        covers the entrypoints. Extend `eslint.config.js` coverage to `api/` and
        `src/server/`.

      **Done when** `src/server/env.ts` and `src/server/healthHandler.ts` have
      passing tests for the anonymous, configured, and half-configured cases with
      a plain object env; `npm run dev` serves
      `http://localhost:5173/api/health` as JSON in the browser; and
      `npm run verify` is green with `api/` included in the typecheck.

- [x] 4. **Client switches to the proxy.** Rework `src/api/opensky.ts`:
      - Keep `decodeStateVector`, `Aircraft` mapping, `BoundingBox`,
        `StatesSnapshot`, `OpenSkyResult`, and `OpenSkyErrorReason` unchanged.
      - Delete the browser-side token cache, `OpenSkyCredentials`, `authUrl`, and
        `isAuthenticated()`. The client no longer knows what a credential is.
      - `createOpenSkyClient({ fetch, now, proxyBase? })` fetches
        `${proxyBase}/states` with the four box params, default proxyBase
        `/api/opensky` as an exported constant.
      - Map the proxy error codes onto the existing reason union:
        `credentials-rejected` to `auth`, `rate-limited` to `rate-limited`,
        `upstream-unavailable` to `network`, everything else including an
        unparseable body and an unrecognised code to `malformed`. A thrown fetch
        is `network`: the proxy itself is unreachable.
      - Read `creditsRemaining` from the forwarded header as today.

      Update `src/api/opensky.test.ts` to the new surface, dropping the token and
      auth-cache cases (now covered by step 1) and adding one case per error code.
      **Done when** `npm test` passes with no test asserting client-side token
      behavior, and `src/` outside `src/server/` contains no credential handling.

- [x] 5. **Config, env, and deployment files.**
      - `src/config.ts`: remove `openSkyApiBase`, `openSkyAuthUrl`,
        `openSkyClientId`, `openSkyClientSecret`, `parseCredentials`, and the two
        exported default URL constants if nothing else imports them. Keep
        `pollIntervalMs`, `mapStyleUrl`, `defaultCenter`, `defaultZoom`. Update
        `src/config.test.ts` and the header comment, which still warns about a
        bundled secret that no longer exists.
      - `.env.example`: remove the four `VITE_OPENSKY_*` URL and credential
        variables; add `OPENSKY_CLIENT_ID`, `OPENSKY_CLIENT_SECRET`,
        `OPENSKY_API_BASE`, `OPENSKY_AUTH_URL` under a server-only heading that
        says these are never exposed to the browser.
      - `vite.config.ts`: drop the three dead `VITE_SKYSPY_*` entries from the
        Vitest `env` block, left over from the previous data source.
      - Add `vercel.json` with the SPA rewrite that leaves `/api/*` alone, and a
        short "Running the proxy" section naming the two routes and the
        server-only variables. Written as `docs/proxy.md` rather than in
        `ONBOARDING.md`: that file is a Claude onboarding guide with an embedded
        instruction block, not developer setup documentation.

      **Done when** `npm run verify` is green, a repository search for
      `VITE_OPENSKY_CLIENT` matches nothing outside git history, and the
      production `dist/` bundle contains no credential variable name.

## Files / areas

**New**
- `src/server/openskyToken.ts` + test
- `src/server/statesHandler.ts` + test
- `src/server/env.ts` + test
- `src/server/healthHandler.ts` + test
- `api/opensky/states.ts`, `api/health.ts`
- `tsconfig.api.json`, `vercel.json`

**Changed**
- `src/api/opensky.ts`, `src/api/opensky.test.ts`
- `src/config.ts`, `src/config.test.ts`
- `vite.config.ts` (dev/preview mounting, Vitest env cleanup)
- `tsconfig.json`, `eslint.config.js`
- `.env.example`, `docs/proxy.md` (new)

**Untouched**
- `src/map/*`, `src/App.tsx`, `src/types/aircraft.ts`,
  `src/api/openskyFixture.test.ts`, `docs/fixtures/*`

`src/server/` is server-only. Nothing under `src/` other than the `api/`
entrypoints may import from it, and it may not import from `src/map/`,
`src/config.ts`, or React. Vite only bundles what `index.html` reaches, so an
unimported `src/server/` never lands in the client bundle, but the rule is what
keeps that true.

## Data / contracts

### `GET /api/opensky/states`

Query, all four required: `lamin`, `lomin`, `lamax`, `lomax`, decimal degrees.

Success `200`:

```json
{ "time": 1757760000, "states": [["4b1806", "SWR123  ", "..."]] }
```

`states` is `null`, not `[]`, when the box holds no traffic. That is OpenSky's
shape and it is passed through unchanged, because `decodeStateVector` already
handles it. `time` is epoch seconds. Optional response header
`X-Rate-Limit-Remaining`, an integer string, present only when upstream sent it.

Errors, always `{"error": "<code>"}` with these exact codes and statuses:

| code | status | cause |
| --- | --- | --- |
| `invalid-request` | 400 | missing or out-of-range bounding box |
| `method-not-allowed` | 405 | non-GET |
| `rate-limited` | 429 | upstream 429, daily budget exhausted |
| `proxy-misconfigured` | 500 | half a credential pair on the server |
| `credentials-rejected` | 502 | token exchange failed, or upstream 401/403 |
| `upstream-unavailable` | 502 | fetch threw, or upstream 5xx |
| `upstream-malformed` | 502 | upstream body was not a usable snapshot |

These codes are stable and consumed by features 5 and 10. Feature 10 must be
able to tell apart: proxy unreachable (client fetch threw, or
`upstream-unavailable`, both retrying), budget exhausted (`rate-limited`,
retrying slowly), credentials rejected (`credentials-rejected`, **not**
retrying), and stale data, which the client derives from `time` and is not a
proxy concern.

### `GET /api/health`

`200 {"status":"ok","credentials":"configured"}` or `"anonymous"`. No URLs, no
secret, no upstream call. `no-store`.

### Server environment

`OPENSKY_CLIENT_ID`, `OPENSKY_CLIENT_SECRET` - both or neither.
`OPENSKY_API_BASE` defaults to `https://opensky-network.org/api`.
`OPENSKY_AUTH_URL` defaults to the public Keycloak realm URL already in
`src/config.ts`. None is `VITE_` prefixed and none may ever become one.

## Testing

The test gate is on. Vitest with an injected `fetch` and `vi.useFakeTimers()`
covers all logic in this feature; the handlers are plain functions of
`(Request, deps)` so no server needs to start.

Required coverage: token caching, refresh margin, concurrent dedupe,
invalidation, and secret non-disclosure (step 1); every row of the error table,
the exact forwarded upstream URL, param allow-listing, header forwarding, and
absence of a CORS header (step 2); the three env states (step 3); the client's
code-to-reason mapping and thrown-fetch handling (step 4); config parsing after
the credential removal (step 5).

Not unit tested, verified by hand instead: that `npm run dev` actually mounts the
routes, and that a real OpenSky call returns live aircraft. Browser testing is
not configured; do not add a runner.

**Manual verification, and the only live-data claim this feature may make.** With
real credentials in `.env`, run `npm run dev`, then open
`http://localhost:5173/api/opensky/states?lamin=50.5&lomin=3.2&lamax=53.7&lomax=7.3`
in the browser and confirm a JSON snapshot with a non-empty `states` array and a
DevTools response header showing remaining credits. Then open `/api/health`.
Repeat once against `npm run preview`. Record the observed result in the review
packet. Do not claim it if it was not run; without credentials the anonymous path
is still a valid observation and should be reported as such.

## Verification status

**verified**, with one outstanding manual check.

Run on this branch, all green:

- `npm run verify` (typecheck, 153 tests, build)
- `npm run lint` with `--max-warnings 0`
- `npm run format:check`

**Outstanding, needs the user:** the live browser check in Testing below. It
requires a running dev server, which `/implement` does not start. Until it runs,
this feature has no live-data evidence and none is claimed.

**Correction to the note below about findings.** F-01 through F-05 did **not**
dissolve. They relocated with the code they describe, and every one still
reproduces:

| Finding | Was | Now |
| --- | --- | --- |
| F-01 | `src/api/opensky.ts:205` | `src/server/statesHandler.ts:81` - one catch still maps any token throw, transport failure included, to `credentials-rejected` |
| F-02 | `src/config.ts:191` | `src/server/env.ts:59` - `OPENSKY_AUTH_URL` still accepts `http:`, and the secret still travels over it |
| F-03 | `src/api/opensky.ts:180` | `src/server/openskyToken.ts:88` - `expires_in` still falls back to `0` |
| F-04 | `src/api/opensky.ts:258` | `src/api/opensky.ts:198` - `Number('')` still reports 0 credits |
| F-05 | `src/api/opensky.ts:151` | `src/server/openskyToken.ts:57` - the unreachable guard was ported verbatim |

F-06 is substantially addressed: `src/server/openskyToken.test.ts` now covers a
rejected exchange, a non-object body, a missing and a blank `access_token`, and a
thrown fetch. Its `time` fallback and junk-credit-header cases remain uncovered.

None were repaired here, per the instruction below not to fix them separately.
All are P2/P3, so none block `/complete`. Their recorded file and line references
are now stale and need `/audit` to re-anchor them.

## Notes for the AI

- The proxy target is **Vercel functions**, decided by the user during this spec.
  Overview open question 1 is answered; `/release` will target Vercel.
- Port the token logic, do not reinvent it. The version in `src/api/opensky.ts`
  is already tested and correct; it is moving hosts, not changing behavior.
- The secret must not appear in an error message, a thrown string, a log line, or
  a response body. `src/config.ts` already sets this precedent for `VITE_`
  variables and the same rule now applies server side.
- `src/config.ts` stays the only reader of `import.meta.env`. `src/server/env.ts`
  becomes the only reader of `process.env`. Neither imports the other.
- Deliberate decision, recorded rather than asked: `OPENSKY_API_BASE` and
  `OPENSKY_AUTH_URL` move from the client env list to server-only. The overview's
  "Client env vars by name" list still names them; it is stale from before the
  proxy existed and should be corrected when this feature is archived. No
  user-visible or stored-data consequence.
- Deliberate decision: the proxy forwards a client-supplied bounding box rather
  than holding a server-side one. That leaves overview open question 2 genuinely
  open instead of quietly deciding it, and costs nothing to change later.
- `blueprint/context/coding-standards.md` still describes SkySpy, WebSockets, and
  "there is no backend, no database". Its rules that still apply here: guarded
  reads of every optional field, a discriminated result that never throws into
  render, transport owns transport only, no em dashes, comment the why. Do not
  rewrite that file in this feature; flag it at `/complete`.
- Findings F-01 and F-02 concern the bundled client secret. They should dissolve
  once step 5 lands. Do not fix them separately; re-audit after this feature.


<!-- blueprint:completion {"schemaVersion":1,"specBytes":20023,"specSha256":"134451d832eef464bc52588b153325bffc335a75a55cc0015c666b0e417f8b82","branch":"refs/heads/feature/backend-proxy","head":"a7f3ca0e860059cfd6b1d53887b75190238f3f24","baseRef":"refs/heads/master","baseCommit":"a6f6867d811db0db38618a36a517a21cd0737852","sourceTree":"cfe0906444f6ee2c696a26cf84ca6fdd58582c35","absentOptional":[]} -->

## Independent review

**Status:** passed
**Target commit:** a7f3ca0e860059cfd6b1d53887b75190238f3f24
**Base commit:** a6f6867d811db0db38618a36a517a21cd0737852
**Base ref:** master
**Spec hash:** 134451d832eef464bc52588b153325bffc335a75a55cc0015c666b0e417f8b82
**Prepared by:** claude
**Builder model:** claude-opus-5
**Requested reviewer:** claude
**Requested model:** runtime default (exact model not known until reviewer starts)
**Requested execution:** automatic
**Requested at:** 2026-09-13T10:46:50Z
**Workflow:** regular
**Check required:** no
**Reviewer adapter:** claude
**Reviewer model:** claude-opus-5
**Reviewer context:** fresh subagent
**Actual execution:** automatic
**Reviewed at:** 2026-09-13T10:49:08Z
**Scope:** current
**Lenses:** quality, security, performance, tests
**Verdict:** passed
**Check result:** not-required

### Commands

- `npm run verify`: pass (typecheck, 153 tests in 10 files, build)
- `npm run lint`: pass (`eslint . --max-warnings 0`)
- `npm run format:check`: pass (note: its globs do not reach `api/`, see F-12)
- `grep -ril "OPENSKY_CLIENT|client_secret|grant_type" dist/`: no match, so the
  freshly built client bundle carries no credential name or OAuth form field
- `npm run dev` / `npm run preview`: not run, outside the reviewer boundary

### Evidence

- Verified the target: `HEAD` equals `Target commit`, `git merge-base master
  a7f3ca0` equals `Base commit`, and the spec bytes hash to `Spec hash`. The 16
  paths `git status` lists are CRLF normalization warnings with empty content
  diffs; only `blueprint/context/review.md` actually differs from the target.
- Read the full delta: 29 files, 2367 insertions. Reviewed all of `src/server/`
  (`openskyToken`, `statesHandler`, `env`, `healthHandler`, `response`, `router`
  and their four test files), `api/_router.ts`, `api/health.ts`,
  `api/opensky/states.ts`, `src/api/opensky.ts` and its test, `src/config.ts`,
  `vite.config.ts`, `vercel.json`, `tsconfig.api.json`, `tsconfig.app.json`,
  `tsconfig.node.json`, `eslint.config.js`, `package.json`, `.env.example`,
  `docs/proxy.md`.
- Credential containment holds. No response body carries anything but a fixed
  error code (`src/server/response.ts:36`); `handleHealthRequest` emits only
  `status` and a configured/anonymous flag; `openskyToken` throws messages naming
  only a status; `env.ts` errors name the variable, never its value. No module
  under `src/` outside `src/server/` imports `src/server/` (grep: only two prose
  comments mention the path), `VITE_OPENSKY_CLIENT*` is gone from source, and the
  built `dist/` scan above confirms nothing shipped.
- CORS posture verified in code and in test: no handler sets
  `Access-Control-Allow-Origin`, and `statesHandler.test.ts:351` asserts its
  absence on a success and a 401. What that does and does not buy is F-07.
- Bounding-box validation verified: four required params, finite, latitude
  -90..90, longitude -180..180, min <= max, blank rejected. The forwarded URL is
  rebuilt from the parsed numbers, so extra params are dropped
  (`statesHandler.test.ts:145` asserts the exact upstream URL with `extended` and
  `icao24` stripped). The route cannot be aimed at another OpenSky endpoint or
  another host: `apiBase` comes only from server env. No open relay.
- Error classification traced end to end against the spec's table. All seven
  codes and statuses match, and the four states feature 10 must tell apart
  (unreachable, budget exhausted, credentials rejected, stale) remain distinct in
  `OpenSkyErrorReason`. Two classification defects survive: the pre-existing F-01
  collapse of a token-endpoint transport failure into `credentials-rejected`,
  which relocated into this delta at `src/server/statesHandler.ts:81`, and the
  now-unreachable `'server'` reason (F-11).
- Performance: the module-scope router in `api/_router.ts` gives a warm instance
  token reuse, concurrent callers share one exchange, and the health route makes
  no upstream call. Unverified hypothesis, not filed: the handler fully parses and
  re-serializes the upstream snapshot, which for a large box is a multi-megabyte
  round trip on a memory-limited function. It is required by the field-dropping
  contract, and no profiling evidence exists either way.
- Re-anchored F-01 through F-06 to their post-refactor locations and recorded in
  each Resolution what re-examination showed. F-06 is partially addressed and
  re-scoped to two remaining cases. None closed, none accepted, statuses and
  severities unchanged.

### Findings

- F-07 [P2] open - the states route is publicly callable; missing CORS headers do
  not make it same-origin only, and the "same-origin only" claim in the code and
  in `docs/proxy.md` is inaccurate
- F-08 [P2] open - `X-Rate-Limit-Remaining` is dropped on every error response,
  including the 429 where the client most needs it
- F-09 [P3] open - no test asserts the credit header on an error path; the env
  blank-URL cases assert only `not.toThrow()`
- F-10 [P3] open - the Vite dev/preview middleware has neither automated nor
  manual evidence
- F-11 [P3] open - the `'server'` error reason is now unreachable
- F-12 [P3] open - `api/` is linted but never format-checked
- F-13 [P3] open - `api/_router.ts` adds an undocumented `not-found` code and
  duplicates the response helper
- F-14 [P3] open - nothing mechanically enforces the `src/server` to client
  boundary
- Carried forward, re-anchored not re-raised: F-01, F-02 [P2] and F-03 through
  F-06 [P3], all still open

### Remaining risk

- The spec's one manual verification is still outstanding: no live OpenSky call,
  no observed dev or preview mount, no browser evidence for either route. This
  review confirms the handlers by unit test and by reading; it confirms nothing
  about HTTP reachability. The feature claims no live-data evidence and none is
  claimed here. See F-10.
- `npm run dev` and `npm run preview` were unavailable to this review by
  instruction, so the dev-server mounting in `vite.config.ts:42-47` and the
  preview path were reviewed by reading only.
- Vercel deployment behavior is unverified and unverifiable locally: whether the
  platform dispatches these single-argument web handlers as written, whether it
  bundles the `src/server` imports that sit outside `api/`, and whether the
  explicit `.ts` import extensions survive its build. `/release` is the step that
  can answer this.
- No dependency or vulnerability scanner is declared in this project, so no
  supply-chain signal was available. Local manifest reading is not a scan and
  none was performed.
- No browser test harness is configured, by explicit spec instruction, so the
  proxy has no integration-level coverage of any kind.
- F-07's real mitigation (origin checking, throttling, credit budget) is deferred
  by the spec to later features. Until it lands, a public deployment exposes one
  shared OpenSky quota to anyone who finds the URL.
