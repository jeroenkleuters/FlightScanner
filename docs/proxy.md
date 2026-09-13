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

Vercel is the deployment target and the repository is imported as a Vercel
project. `vercel.json` holds the whole configuration:

- `buildCommand: npm run build` and `outputDirectory: dist` for the SPA.
- A rewrite sending every non-`/api/` path to `/index.html`, so client routes
  and deep links resolve while the functions keep their own paths.

`api/opensky/states.ts` and `api/health.ts` are the function entrypoints; both
delegate to `src/server/router.ts`, the same router `npm run dev` and
`npm run preview` mount. There is no deploy-only code path.

Environment variables are set in the Vercel project, not in a committed file.
`OPENSKY_CLIENT_ID` and `OPENSKY_CLIENT_SECRET` are both set, so the deployment
runs authenticated at 4000 credits per day rather than the anonymous 400. Set
them for every environment that should be authenticated: Preview and Development
deployments do not inherit Production values. The `VITE_` variables are optional
and compiled into the bundle at build time, so changing one needs a redeploy,
not just a restart.

After a deploy, `/api/health` is the first thing to check: it costs no credits
and reports whether the function holds credentials. It answers
`{"status":"ok","credentials":"configured"}` when the pair is present; a
`"credentials":"anonymous"` on a deployment that should be authenticated means
the variables are missing from that environment's scope.

The credit budget is per OpenSky account, so a public deployment shares one 4000
per day allowance across everyone who loads the app.
