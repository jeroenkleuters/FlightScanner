# The mock feed server

OpenSky grants 4000 credits a day and a bounded query costs one, so a 30 s poll
spends about 2880 of them just by being left open. Credits are the scarce
resource in this project, and burning them on a UI that is still being written
is the easiest way to run out mid-afternoon. This replays a real captured
snapshot instead, at no cost, and it can be told to fail on demand.

**It impersonates OpenSky, not our proxy.** Point `OPENSKY_API_BASE` and
`OPENSKY_AUTH_URL` at it and the entire real stack runs unchanged: the proxy's
validation and error classification in `src/server/statesHandler.ts`, the
positional decoding in `src/api/opensky.ts`, and everything built on top. A mock
standing in for our own proxy would bypass exactly the layer the polling and
status features have to trust.

It is development-only. Nothing under `src/` or `api/` imports it, it is never
part of a build, and it binds to `127.0.0.1` because it has no authentication
and its control routes let any caller reshape the feed.

## Running it

Two terminals.

```bash
npm run mock    # http://127.0.0.1:8787
npm run dev     # http://localhost:5173
```

Then put these in `.env`:

```bash
OPENSKY_API_BASE=http://127.0.0.1:8787
OPENSKY_AUTH_URL=http://127.0.0.1:8787/token
```

Or set them for one run without touching `.env`:

```bash
OPENSKY_API_BASE=http://127.0.0.1:8787 OPENSKY_AUTH_URL=http://127.0.0.1:8787/token npm run dev
```

**Blank both variables again to reach the real API.** A `.env` left pointing at
the mock is silent: the app looks healthy and the data is a replay. When in
doubt, `curl http://127.0.0.1:8787/__mock/control` answers only if the mock is
what you are talking to.

Credentials are irrelevant in mock mode. The mock's token endpoint issues a
token to anyone, and with no credentials set the proxy never asks for one.

| Variable | Default | Purpose |
| --- | --- | --- |
| `MOCK_PORT` | `8787` | Port to listen on |
| `MOCK_CREDITS` | `4000` | Starting `X-Rate-Limit-Remaining` |

## Routes

| Route | Purpose |
| --- | --- |
| `GET /states/all?lamin&lomin&lamax&lomax` | One snapshot, filtered to the box. Decrements the credit counter. |
| `POST /token` | OAuth2 stand-in: `{"access_token": "...", "expires_in": 1800}` |
| `GET /__mock/control` | Current fault, credits, elapsed seconds, visible count |
| `POST /__mock/control` | Set `fault` and/or `credits` |
| `POST /__mock/reset` | Clock back to zero, fault off, credits restored |

Everything else is a 404. Errors from the mock's own routes use the proxy's
shape, `{"error": "<code>"}`.

## Faults

Each mode produces a distinct client-visible state, which is the point: a frozen
map that looks healthy is worse than one that admits it is stale.

```bash
curl -X POST http://127.0.0.1:8787/__mock/control -d '{"fault":"rate-limited"}'
curl -X POST http://127.0.0.1:8787/__mock/control -d '{"fault":"off"}'
```

| Mode | The mock answers | Proxy turns it into | Client reason |
| --- | --- | --- | --- |
| `off` | normal 200 | - | normal snapshot |
| `server-error` | 503, empty body | `upstream-unavailable` | `network` |
| `rate-limited` | 429, `X-Rate-Limit-Remaining: 0` | `rate-limited` | `rate-limited` |
| `unauthorized` | 401, and `POST /token` also 401 | `credentials-rejected` | `auth` |
| `malformed` | 200 with `{"time": "soon"}` | `upstream-malformed` | `malformed` |
| `empty` | 200 with `"states": null` | - | a valid empty box, not an error |
| `stale` | 200, contact times backdated 600 s | - | drives the stale and fade path |

An unknown mode, a negative or non-integer `credits`, or an unparseable body is
a 400 that changes nothing, so the mock can never be left half-configured and
quietly lying about its own state.

**The fifth failure mode, proxy unreachable, is produced by stopping the mock**
(or the dev server). There is no fault for it, because a stopped process is
already the most faithful simulation of one.

**Budget exhaustion can also be reached honestly.** `X-Rate-Limit-Remaining`
counts down from `MOCK_CREDITS` and answers 429 at zero, so setting
`{"credits": 3}` and waiting for the poller to spend them exercises the real
sequence rather than a switch being flipped.

Hang and slow-response injection is deliberately absent. The proxy sets no
upstream timeout, so a hanging mock would wedge the dev server rather than teach
anything. Worth adding alongside a timeout in `statesHandler.ts`, not before.

## What the feed does

The source is `docs/fixtures/opensky-states-nl.json`, 149 real vectors captured
over the Netherlands on 2026-09-13, nulls and all.

**Movement.** Every aircraft is dead-reckoned from its captured position along
its captured track at its captured ground speed, using a spherical
destination-point formula. Altitude follows the vertical rate and is floored at
zero. Aircraft on the ground taxi but do not climb. Anything the capture left
null stays null, so the decoder's guarded reads keep being exercised.

**Churn.** Each aircraft disappears for 45 seconds out of every 600, at an
offset derived from a hash of its hex. Roughly 7.5% of the fleet is missing at
any moment.

The 45 seconds is not arbitrary: it exceeds the store's 30 s removal rule, so at
a 30 s poll at least one snapshot omits the aircraft, the rule actually fires,
and the aircraft's return is a genuine insert rather than an update. A mock that
only moved aircraft could not exercise the reconciler at all, which is the whole
reason this exists.

**Determinism.** Everything is a pure function of elapsed time. No random
numbers, no accumulating position. The same elapsed time always produces the
same feed, and `POST /__mock/reset` reproduces a run exactly, so a bug in the
store can be reproduced rather than hunted.

**Box filtering is real.** Vectors outside the requested box are dropped, and an
empty result is `"states": null`, the shape OpenSky actually sends. Positionless
vectors are returned whatever the box says, matching OpenSky and the rule that
an aircraft without a fix still counts.

## Tests

`mock/feed.test.mjs` covers the projection maths, the null guards, the altitude
floor, and the churn cycle's exact boundaries. It runs inside `npm test` and
spends no credit. The HTTP layer is thin plumbing over that core and is verified
by `curl`, not by a test restating the routing table.
