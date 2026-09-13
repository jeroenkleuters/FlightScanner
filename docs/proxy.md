# Running the proxy

The browser cannot call OpenSky directly. `states/all` answers every origin with
`Access-Control-Allow-Origin: https://opensky-network.org`, and the OAuth2 token
endpoint sends no CORS header at all. The proxy is required in every
environment, not just production, and it is also what keeps the OpenSky client
secret out of the bundle.

## Routes

| Route | Purpose |
| --- | --- |
| `GET /api/opensky/states?lamin&lomin&lamax&lomax` | One bounded snapshot. Costs one OpenSky credit. |
| `GET /api/health` | Proxy reachable, and whether it holds credentials. Costs nothing. |

Both are same-origin only. Neither sets `Access-Control-Allow-Origin`: a
wildcard would let any site spend this account's daily credit budget.

Errors always look like `{"error": "<code>"}`. The codes are a stable contract
consumed by the polling client:

| Code | Status | Meaning |
| --- | --- | --- |
| `invalid-request` | 400 | Missing or out-of-range bounding box |
| `method-not-allowed` | 405 | Non-GET |
| `rate-limited` | 429 | Daily credit budget exhausted |
| `proxy-misconfigured` | 500 | Half a credential pair on the server |
| `credentials-rejected` | 502 | Token exchange failed, or upstream rejected it |
| `upstream-unavailable` | 502 | OpenSky unreachable or erroring |
| `upstream-malformed` | 502 | OpenSky returned something unusable |

## Locally

`npm run dev` and `npm run preview` both mount the same handlers the Vercel
functions run, so there is no dev-only code path to drift. Copy `.env.example`
to `.env` first. With no credentials the proxy works anonymously at 400 credits
per day per IP instead of 4000.

Check it with `http://localhost:5173/api/health`.

## Configuration

Server-side only, never `VITE_` prefixed and never sent to the browser:
`OPENSKY_CLIENT_ID`, `OPENSKY_CLIENT_SECRET`, `OPENSKY_API_BASE`,
`OPENSKY_AUTH_URL`. Set both credentials or neither; half a pair is rejected
rather than silently downgraded to the smaller anonymous quota.

## On Vercel

`api/opensky/states.ts` and `api/health.ts` are the function entrypoints; both
delegate to `src/server/router.ts`. Set the two credential variables as project
environment variables, not in a committed file. The credit budget is per
account, so a public deployment shares one 4000 per day allowance across
everyone who loads the app.
