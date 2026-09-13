# Findings

> **Generated file.** The findings ledger: review findings raised by `/audit`
> against the work in progress, each with a durable ID, severity (P0-P3), and
> status. `/implement` marks repaired findings `fixed`, a later `/audit` pass
> moves them to `closed`, and `/complete` refuses to merge while any P0 or P1
> finding is `open` or `fixed`, then archives resolved findings with the work
> and resets this file.

### F-01 [P2] open - A token endpoint outage is reported as an auth failure

**File:** src/api/opensky.ts:205
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
**Resolution:**

### F-02 [P2] open - The OAuth token endpoint may be overridden to plain http

**File:** src/config.ts:191
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
**Resolution:**

### F-03 [P3] open - A token response without expires_in caches an already expired token

**File:** src/api/opensky.ts:180
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
**Resolution:**

### F-04 [P3] open - An empty rate limit header reports zero credits remaining

**File:** src/api/opensky.ts:258
**Found:** 2026-09-13 by /audit (scope: current; lens: quality)
**Why it matters:** `Number('')` is `0`, and `Number.isFinite(0)` is true, so a
present but empty `X-Rate-Limit-Remaining` header sets `creditsRemaining` to 0
instead of leaving it absent. Zero credits is a meaningful value that a later
status surface will treat as quota exhausted, and the standards rule that an
absent value must never render as 0 is the one this breaks.
**Suggested fix:** Reject a blank header before converting, for example by
trimming and returning undefined on an empty string.
**Resolution:**

### F-05 [P3] open - Unreachable credentials guard inside requestToken

**File:** src/api/opensky.ts:151
**Found:** 2026-09-13 by /audit (scope: current; lens: quality)
**Why it matters:** `getToken` already returns early when `credentials` is
absent, so `requestToken`'s own `if (!credentials) return undefined` can never
run. Its only effect is to widen the return type to `CachedToken | undefined`,
which then forces the optional chain in `cached?.value` and makes the cache look
as if it can legitimately hold nothing after a successful request.
**Suggested fix:** Drop the guard, return `CachedToken`, and let the single
check in `getToken` own the anonymous path.
**Resolution:**

### F-06 [P3] open - Token failure paths other than a 401 status are untested

**File:** src/api/opensky.test.ts:236
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
**Resolution:**
