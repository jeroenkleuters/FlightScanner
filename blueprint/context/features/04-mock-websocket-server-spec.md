# Feature: Mock WebSocket server

**From build-plan:** feature 04
**Build attempt:** 1
**Branch:** feature/04-mock-websocket-server

Source: `docs/flight-map-plan.md` §6 Step 4.

## Goal

A local WebSocket server that replays captured fixtures as a moving, live-looking
aircraft feed - so the client, store, and map can be built and demonstrated
without a SkySpy instance, and so failure modes can be triggered on demand.

## In scope

- `mock/server.mjs`, started with `npm run mock`
- Subprotocol handshake validation mirroring the real server
- Snapshot on connect, then periodic updates with moving positions
- Heartbeats, deltas, new and remove events
- Deliberate fault injection: drop connection, reject auth, go silent

## Out of scope

- The client that connects to it (feature 05)
- REST endpoint mocking (add only if feature 10 needs it)
- Any production or deployed use

## Build loop

Implement all steps, then one review packet.

## Build steps

- [ ] **Add `ws` as a dev dependency and create `mock/server.mjs`** listening on
  a configurable port (default 8080) at path `/ws/aircraft/`.
  **Done when:** `npm run mock` starts and a WebSocket client can connect.
- [ ] **Validate and echo the subprotocol.** Apply the rule confirmed in feature
  03: accept the correct offer, echo the accepted value, and reject a connection
  with a missing or wrong protocol. Without this the mock accepts handshakes the
  real server rejects, and the auth path stays untested until production.
  **Done when:** a correct offer connects; a missing or wrong one is rejected
  with a close code.
- [ ] **Handle subscribe and unsubscribe.** Send nothing until a subscribe action
  for the `aircraft` topic arrives; stop sending on unsubscribe. Ignore unknown
  actions without crashing.
  **Done when:** frames only flow after subscribing, and stop after
  unsubscribing.
- [ ] **Replay fixtures as a live feed.** On subscribe, send `aircraft:snapshot`
  built from the fixtures. Then every ~500 ms send `aircraft:update` with
  positions advanced along each aircraft's `track` at its `gs`, so aircraft
  visibly fly. Emit `aircraft:heartbeat` every 5 s. Periodically emit
  `aircraft:new`, `aircraft:remove`, and `aircraft:delta` so every code path is
  exercised.
  **Done when:** a connected client receives a snapshot then a continuous stream
  in which coordinates change coherently, and all six message types appear
  within two minutes.
- [ ] **Add fault injection via CLI flags.** `--drop-every=<seconds>` closes the
  socket periodically to exercise reconnect; `--reject-auth` refuses every
  handshake; `--silent-after=<seconds>` stops sending without closing, to
  exercise staleness detection. Frames must match the exact envelope nesting
  captured in feature 03.
  **Done when:** each flag produces its documented behaviour.
- [ ] **Add a `--count=<n>` flag** synthesising up to n aircraft from the fixture
  set, for load testing feature 07.
  **Done when:** the mock streams 2000 distinct aircraft when asked for 2000.
- [ ] **Document it** in `mock/README.md`: flags, port, and how to point the app
  at it.
  **Done when:** someone can start the mock and connect the app using only that
  file.

## Files / areas

- `mock/server.mjs`, `mock/README.md`
- `package.json` - `mock` script, `ws` devDependency
- Reads `docs/fixtures/*.json`

## Data / contracts

The mock is only useful if it is faithful. Every frame must match the envelope
nesting, field names, and types captured in feature 03 - byte-compatible where
possible. A mock that is subtly wrong produces a client that works locally and
fails against the real server.

Position advance: dead reckoning from `lat`/`lon` along `track` at `gs`, with
small jitter. Aircraft that leave a bounding box are removed and replaced with a
`new`, exercising both events naturally.

## Testing

- Manual exercise of each flag.
- One integration test: start the server on a random port, connect, subscribe,
  assert a snapshot arrives followed by an update, then shut down cleanly.

## Notes for the AI

- Plain Node ESM, no TypeScript build step - this is a dev tool.
- It must exit cleanly on Ctrl-C and free the port; a mock that leaks a port
  wastes more time than it saves.
- If feature 03 was blocked and no real fixtures exist, build from the documented
  shapes in `docs/flight-map-plan.md` §2 and put a prominent unverified warning
  at the top of `mock/README.md`.
