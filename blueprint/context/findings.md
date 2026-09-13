# Findings

> **Generated file.** The findings ledger: review findings raised by `/audit`
> against the work in progress, each with a durable ID, severity (P0-P3), and
> status. `/implement` marks repaired findings `fixed`, a later `/audit` pass
> moves them to `closed`, and `/complete` refuses to merge while any P0 or P1
> finding is `open` or `fixed`, then archives resolved findings with the work
> and resets this file.

### F-01 [P2] open - A token endpoint outage is reported as an auth failure

**File:** src/server/statesHandler.ts:81
**Found:** 2026-09-13 by /audit (scope: current; lens: security, quality)
**Why it matters:** `fetchStates` wraps `getToken()` in one catch that maps every
throw to `reason: 'auth'`. `requestToken` throws for four different causes: the
`fetchImpl` call rejecting (offline, DNS, CORS), a non-ok status, a non-object
payload, and a missing `access_token`. Only the second is really an auth
problem. The states call itself distinguishes `network` from `auth`, so the same
outage produces `network` anonymously and `auth` with credentials. The error
handling standard requires disconnected and auth-rejected to stay separately
visible, which is exactly what this collapses.
**Suggested fix:** Have `requestToken` reject with a typed reason, or catch the
transport rejection inside it, and let the `catch` in `fetchStates` map a
transport failure to `network` and a rejected or unusable token response to
`auth`.
**Resolution:** Re-anchored 2026-09-13 by /audit independent (a6f6867..a7f3ca0). The
logic moved from the browser client to the proxy and still reproduces: the single
`catch` around `tokenProvider.getToken()` maps a rejected auth fetch, a non-ok
status, a non-object body and a missing `access_token` all to
`credentials-rejected`, which `src/api/opensky.ts:112` maps to `auth`. Status
unchanged, still open.

### F-02 [P2] open - The OAuth token endpoint may be overridden to plain http

**File:** src/server/env.ts:59
**Found:** 2026-09-13 by /audit (scope: current; lens: security)
**Why it matters:** `VITE_OPENSKY_AUTH_URL` is parsed with the protocol list
`['http:', 'https:']`. `createOpenSkyClient` POSTs `client_id` and
`client_secret` as a form body to whatever that resolves to, so an http override
puts the OpenSky client secret on the wire in cleartext. `VITE_MAP_STYLE_URL`,
which carries nothing sensitive, is already restricted to https, so the stricter
rule is applied to the less sensitive value.
**Suggested fix:** Parse `VITE_OPENSKY_AUTH_URL` with `['https:']` only. Keep
`VITE_OPENSKY_API_BASE` permissive if a local http mock server is wanted, since
the bearer token there is short lived and the secret never travels to it.
**Resolution:** Re-anchored 2026-09-13 by /audit independent. Now
`OPENSKY_AUTH_URL` on the server rather than `VITE_OPENSKY_AUTH_URL` in the
bundle. `urlWithDefault` still accepts `http:` for both URLs, and
`src/server/openskyToken.ts:59` still POSTs `client_secret` to whatever it
resolves to. Status unchanged, still open.

### F-03 [P3] open - A token response without expires_in caches an already expired token

**File:** src/server/openskyToken.ts:88
**Found:** 2026-09-13 by /audit (scope: current; lens: quality)
**Why it matters:** `const lifetimeSeconds = optionalNumber(record.expires_in) ?? 0`
makes `expiresAtMs` equal `now() - TOKEN_REFRESH_MARGIN_MS` when the field is
absent or non-numeric. The current poll still succeeds, but `getToken` then
treats the cache as stale forever, so every subsequent poll spends another token
request against the auth endpoint. The live API returns 1800, so this only bites
on a provider change, but it fails toward more work rather than less.
**Suggested fix:** Treat a missing or non-positive `expires_in` as a token
response that cannot be cached, by either rejecting it or applying a documented
conservative default lifetime.
**Resolution:** Re-anchored 2026-09-13 by /audit independent. Ported verbatim:
`optionalNumber(payload.expires_in) ?? 0` still yields an `expiresAtMs` in the
past. On the server this is worse than in the browser, because every warm
invocation re-exchanges. Status unchanged, still open.

### F-04 [P3] open - An empty rate limit header reports zero credits remaining

**File:** src/api/opensky.ts:198
**Found:** 2026-09-13 by /audit (scope: current; lens: quality)
**Why it matters:** `Number('')` is `0`, and `Number.isFinite(0)` is true, so a
present but empty `X-Rate-Limit-Remaining` header sets `creditsRemaining` to 0
instead of leaving it absent. Zero credits is a meaningful value that a later
status surface will treat as quota exhausted, and the standards rule that an
absent value must never render as 0 is the one this breaks.
**Suggested fix:** Reject a blank header before converting, for example by
trimming and returning undefined on an empty string.
**Resolution:** Re-anchored 2026-09-13 by /audit independent. Line moved only;
`Number(header)` with `Number.isFinite` still turns a present but empty
`X-Rate-Limit-Remaining` into 0. Status unchanged, still open.

### F-05 [P3] open - Unreachable credentials guard inside requestToken

**File:** src/server/openskyToken.ts:57
**Found:** 2026-09-13 by /audit (scope: current; lens: quality)
**Why it matters:** `getToken` already returns early when `credentials` is
absent, so `requestToken`'s own `if (!credentials) return undefined` can never
run. Its only effect is to widen the return type to `CachedToken | undefined`,
which then forces the optional chain in `cached?.value` and makes the cache look
as if it can legitimately hold nothing after a successful request.
**Suggested fix:** Drop the guard, return `CachedToken`, and let the single
check in `getToken` own the anonymous path.
**Resolution:** Re-anchored 2026-09-13 by /audit independent. The unreachable guard
was ported unchanged into `requestToken`; `getToken` at
`src/server/openskyToken.ts:98` still returns early for the anonymous case.
Status unchanged, still open.

### F-06 [P3] open - Token failure paths other than a 401 status are untested

**File:** src/api/opensky.test.ts:222
**Found:** 2026-09-13 by /audit (scope: current; lens: tests)
**Why it matters:** The suite is strong on decoding and on states-call failures,
but the only token failure it exercises is a 401 response. The auth endpoint
rejecting the fetch outright, returning a non-object body, or returning 200 with
no `access_token` are all separate branches in `requestToken` and none is
covered. That is also why F-01 is invisible to the suite. The `time` fallback
when the payload omits `time`, and a non-numeric credit header, are likewise
uncovered.
**Suggested fix:** Add cases for a rejected token fetch, a token body with no
`access_token`, an omitted `time`, and a junk `X-Rate-Limit-Remaining`, asserting
the reason each produces.
**Resolution:** Partially addressed and re-scoped 2026-09-13 by /audit independent.
`src/server/openskyToken.test.ts:173-215` now covers a rejected exchange, a
non-object body, a missing and a blank `access_token`, and a thrown fetch, so the
token half of this finding no longer reproduces. Still uncovered: the client
`time` fallback at `src/api/opensky.ts:203` (no 200 body without `time` is
tested) and a non-numeric `X-Rate-Limit-Remaining`. Not closed; remaining scope is
those two cases.

### F-07 [P2] open - The states route is publicly callable, not same-origin only

**File:** src/server/response.ts:4
**Found:** 2026-09-13 by /audit independent (scope: current; lens: security)
**Why it matters:** `src/server/response.ts:4`, `src/server/statesHandler.ts:8`
and `docs/proxy.md:16` all state that the routes are "same-origin only" because
no handler sets `Access-Control-Allow-Origin`. That is not what the header does.
A missing `Access-Control-Allow-Origin` stops a cross-origin page from *reading*
the response; it does not stop the request from executing. `curl`, any
server-side client, and a cross-origin `fetch(url, { mode: 'no-cors' })` all
reach OpenSky through this proxy and spend the account's credits. There is no
`Origin` check, no `Sec-Fetch-Site` check, and no authentication, and
`parseBoundingBox` accepts the whole globe (`statesHandler.test.ts:129` asserts a
`-90,-180,90,180` box returns 200), which OpenSky bills at 4 credits instead of
1. `docs/proxy.md:52` already notes the 4000/day budget is shared per account
across every user, so one third party can exhaust the app for everyone.
Throttling and budget enforcement are explicitly out of scope for this feature,
which is why this is P2 rather than P1: the missing mitigation was deferred on
purpose. The inaccurate claim of protection was not.
**Suggested fix:** Correct the three comments and the doc line to say what is
actually true, that the route is unauthenticated and public. If a cheap guard is
wanted now, reject a request whose `Sec-Fetch-Site` header is present and is
neither `same-origin` nor `none`. A real limit belongs with the credit-budget
work. Do not deploy publicly until that lands.
**Resolution:**

### F-08 [P2] open - The remaining-credit header is dropped on every error, including 429

**File:** src/server/statesHandler.ts:106
**Found:** 2026-09-13 by /audit independent (scope: current; lens: quality)
**Why it matters:** `credits` is only read at line 130, after every failure
branch has already returned. `errorResponse` carries no upstream header, so the
`rate-limited` 429 response, the one moment where the remaining credit count is
the information the client actually needs, arrives with no
`X-Rate-Limit-Remaining` at all and `creditsRemaining` lands `undefined` in
`src/api/opensky.ts:198`. OpenSky does send the header on a 429. The spec lists
"Forwards `X-Rate-Limit-Remaining` verbatim when upstream sent it" as its own
behavior, not as part of the success row, and the module docstring at
`src/server/statesHandler.ts:8` says the proxy "reports the remaining credit
header" without qualification. Feature 10 is meant to show why polling slowed
down and will have nothing to show it with.
**Suggested fix:** Read the credit header immediately after the `fetchImpl` call
succeeds and pass it through `errorResponse` for the upstream-derived failures
(429, 401/403, 5xx, malformed). Leave it off the responses produced before the
upstream call, which have no header to forward.
**Resolution:**

### F-09 [P3] open - Error-path header forwarding and the env URL defaults are asserted only weakly

**File:** src/server/statesHandler.test.ts:226
**Found:** 2026-09-13 by /audit independent (scope: current; lens: tests)
**Why it matters:** Two gaps that let real behavior through unchecked. First,
`X-Rate-Limit-Remaining` is asserted on the 200 path (line 226) and asserted
absent when upstream sent none (line 239), but no case asserts it on any error
response, which is exactly why F-08 is invisible to a green suite. Second,
`src/server/env.test.ts:57-62` checks a blank `OPENSKY_API_BASE` and
`OPENSKY_AUTH_URL` with `expect(...).not.toThrow()` and nothing else; a fallback
that returned the wrong URL, an empty string, or the other variable's default
would pass that test unchanged. The neighbouring cases in the same file assert
exact values, so this is drift within one file rather than a house style.
**Suggested fix:** Add a 429 case asserting the forwarded credit header, and
change the blank-URL cases to assert `DEFAULT_OPENSKY_API_BASE` /
`DEFAULT_OPENSKY_AUTH_URL` on the returned object.
**Resolution:**

### F-10 [P3] open - The dev and preview middleware has no automated or manual evidence

**File:** vite.config.ts:21
**Found:** 2026-09-13 by /audit independent (scope: current; lens: tests)
**Why it matters:** `middleware` is the only code in this feature that converts
between Node `req`/`res` and Web `Request`/`Response`: it builds the URL from the
client-supplied `Host` header, decides fall-through from an `undefined` return,
copies headers, and buffers the whole body. None of it is covered.
`vite.config.ts` is outside vitest's `include: ['src/**/*.test.{ts,tsx}']`, so it
cannot be reached by the suite as configured, and the spec's single manual check
(run `npm run dev`, open the states route and `/api/health`, repeat under
`npm run preview`) is recorded as still outstanding. The result is that the
feature's 153 passing tests prove the handlers and prove nothing about either
route being reachable over HTTP in any environment.
**Suggested fix:** Either run the recorded manual check and write the observed
result into the review packet, or extract the req/res conversion into
`src/server/` where the existing include glob reaches it and test the
fall-through, header-copy, and body cases directly.
**Resolution:**

### F-11 [P3] open - The 'server' error reason is now unreachable

**File:** src/api/opensky.ts:37
**Found:** 2026-09-13 by /audit independent (scope: current; lens: quality)
**Why it matters:** `OpenSkyErrorReason` still declares `'server'`, but after the
rewrite no code path produces it: `REASON_BY_PROXY_CODE` maps three codes and
`reasonForFailure` returns `'malformed'` for everything else, including a thrown
JSON parse and an unrecognised code. A dead member of a union that feature 10 is
meant to exhaustively switch on invites a branch that can never render. It also
hides a real collapse: `proxy-misconfigured` (500, an operator error that will
never fix itself) and `invalid-request` (400, a caller bug) both surface as
`malformed`, the same reason as corrupt upstream data. The spec asked for exactly
this mapping, so the mapping is not the defect; the leftover variant is.
**Suggested fix:** Drop `'server'` from the union, or give it the operator-error
codes (`proxy-misconfigured`, `invalid-request`, `method-not-allowed`) so the
never-retry-and-tell-someone case stays distinguishable from bad data.
**Resolution:**

### F-12 [P3] open - api/ is linted but never format-checked

**File:** package.json:12
**Found:** 2026-09-13 by /audit independent (scope: current; lens: quality)
**Why it matters:** The `format` and `format:check` globs are
`"src/**/*.{ts,tsx,css}"`, top-level `"*.{js,ts,json}"`, and `index.html`. The
three new files under `api/` match none of them, so `npm run format:check` passes
over them without reading them and `npm run format` will never rewrite them. This
feature extended `eslint.config.js:32` to cover `api/**/*.ts` and `src/server/**`
but did not make the matching change to the prettier globs, so the new
entrypoints are the only project source outside both the formatter and its gate.
**Suggested fix:** Add `"api/**/*.ts"` to both the `format` and `format:check`
globs in `package.json`.
**Resolution:**

### F-13 [P3] open - api/_router.ts adds an undocumented eighth error code and duplicates the response helper

**File:** api/_router.ts:18
**Found:** 2026-09-13 by /audit independent (scope: current; lens: quality)
**Why it matters:** `notFound()` hand-builds a `Response` with the same
`Content-Type` and `Cache-Control` headers that `src/server/response.ts` exists
to centralize, and emits `{"error":"not-found"}`. That code appears in neither
the spec's error table nor `docs/proxy.md:22-30`, both of which present the seven
codes as a stable contract consumed by features 5 and 10. `ProxyErrorCode` does
not include it, so the type that is supposed to enumerate the contract no longer
does. The client maps it to `malformed`, so nothing breaks today, but the next
person reading either the doc or the type gets an incomplete list.
**Suggested fix:** Either route it through `errorResponse` with a `not-found`
member added to `ProxyErrorCode` and to the table in `docs/proxy.md`, or drop the
fallback and let an unmatched path return the platform 404.
**Resolution:**

### F-14 [P3] open - Nothing mechanically enforces the src/server to client boundary

**File:** src/server/router.ts:1
**Found:** 2026-09-13 by /audit independent (scope: current; lens: security, quality)
**Why it matters:** The spec states the rule plainly ("`src/server/` is
server-only. Nothing under `src/` other than the `api/` entrypoints may import
from it") and then relies on tree-shaking to hold it: `src/server/**` lives
inside Vite's client root and is compiled by `tsconfig.app.json`, whose `include`
is `["src"]`. An import from a component would typecheck, lint, and pass
`npm run verify` in silence. The blast radius is genuinely small today, and this
is P3 rather than P2 for that reason: no module under `src/server` reads a secret
from its own environment, every credential is injected at the entrypoint
(`api/_router.ts:11` passes `process.env`, `vite.config.ts:19` passes the loaded
env), and a scan of the freshly built `dist/` for `OPENSKY_CLIENT`,
`client_secret` and `grant_type` matched nothing. The rule is right; it just has
no enforcement behind it, and this feature exists because that boundary matters.
**Suggested fix:** Add an eslint `no-restricted-imports` zone banning
`src/server/*` from `src/**` with `src/server/**` excepted, so the rule fails
`npm run lint` instead of relying on review.
**Resolution:**
