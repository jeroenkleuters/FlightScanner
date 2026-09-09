# Feature: Live instance verification

**From build-plan:** feature 03
**Build attempt:** 1
**Branch:** feature/03-live-instance-verification

Source: `docs/flight-map-plan.md` §3 and §6 Step 3.

## Goal

Replace two documented-but-unconfirmed assumptions with captured evidence: the
exact `Sec-WebSocket-Protocol` handshake SkySpy accepts, and the real shape of
its aircraft messages. Produce fixtures that every later feature is built and
tested against.

## In scope

- Confirming host reachability and whether auth is enabled
- Settling the WebSocket subprotocol handshake, in a real browser
- Capturing one frame of every aircraft message type
- Writing `src/types/aircraft.ts` from captured data
- Writing `src/ws/buildProtocols.ts`
- Probing the v2 airframes endpoint (recording only)

## Out of scope

- The WebSocket client, the store, the map layer - all later features
- Building anything on the airframes probe result

## Build loop

Investigation first, then two small source files. One review packet.

## Build steps

- [ ] **Confirm the host and auth mode.** `curl {HTTP_BASE}/health` and
  `curl {HTTP_BASE}/api/v1/aircraft/`. Record whether a token is required, and
  if so which kind.
  **Done when:** both responses are recorded in `docs/fixtures/NOTES.md`.
- [ ] **Settle the subprotocol handshake.** Try both shapes with `websocat`,
  passing the token as a bare `Sec-WebSocket-Protocol` value, then as a
  namespaced `skyspy, <token>` value. Record which connects and what subprotocol
  the server echoes back. Then repeat in a real browser using the `WebSocket`
  constructor's second argument from the devtools console - `websocat` tolerates
  a missing server echo where a browser fails the connection, so the browser
  result is the authoritative one.
  **Done when:** `docs/fixtures/NOTES.md` records the working protocol array and
  the echoed value, confirmed in a browser.
- [ ] **Capture one frame of each message type.** Subscribe with the documented
  subscribe action for the `aircraft` topic and capture `aircraft:snapshot`,
  `:update`, `:new`, `:remove`, `:delta`, and `:heartbeat`. Record the exact
  envelope nesting - whether aircraft live at `data.aircraft`,
  `data.data.aircraft`, an array, or an object keyed by hex.
  **Done when:** `docs/fixtures/` holds one JSON file per message type, verbatim
  from the wire.
- [ ] **Write `src/types/aircraft.ts` from the captured data,** not from the
  documentation. Every field optional except `hex`. Include a type for the
  envelope and a discriminated union of message types.
  **Done when:** the types compile and a test asserts each captured fixture
  parses against them.
- [ ] **Write `src/ws/buildProtocols.ts`.** One exported
  `buildProtocols(token?: string): string[] | undefined` returning the confirmed
  array shape, `undefined` when no token. A comment records what was tested and
  what the server echoed.
  **Done when:** unit tests cover the token and no-token cases and the function
  matches the browser-confirmed shape.
- [ ] **Probe the v2 airframes endpoint (record only).** Take a `hex` from the
  capture and `curl` `{HTTP_BASE}/api/v1/airframes/{hex}/`. Record whether
  `registration`, `operator`, and `photo_url` are populated or `fetch_failed` is
  set. Build nothing on it.
  **Done when:** the result is recorded in `docs/fixtures/NOTES.md`.

## Files / areas

- `docs/fixtures/*.json`, `docs/fixtures/NOTES.md`
- `src/types/aircraft.ts`, `src/ws/buildProtocols.ts`

## Data / contracts

The captured fixtures become the contract. Where documentation and capture
disagree, **the capture wins** and the disagreement is noted.

`hex` is the identity key everywhere in this project. Never key on `flight` -
callsigns change and repeat.

The aircraft object is declared `additionalProperties: {}` in SkySpy's OpenAPI
schema, i.e. effectively untyped and possibly deployment-specific. Treat every
field as optional and guard every read.

## Testing

- Each captured fixture parses against the types and its type guard.
- `buildProtocols` returns the confirmed array with a token, `undefined` without.

## Notes for the AI

- **This feature may be blocked.** It needs a reachable SkySpy instance. If there
  is none, stop and report rather than inventing fixtures: hand-written fixtures
  that encode the documented-but-wrong shape are worse than no fixtures, because
  everything downstream is then tested against a fiction. Feature 04's mock can
  be built from documented shapes as an interim, clearly labelled unverified.
- If neither protocol shape completes the handshake, that is a **blocker to
  raise**. Do not fall back to a query-string token - that decision is settled.
  See `docs/flight-map-plan.md` §2.
- Scrub any real token from fixtures and notes before writing them to disk.

## Open questions

- Is there a reachable SkySpy instance for this project, or is development
  mock-only for now?
- API key, JWT login, or public mode? An API key avoids mid-session JWT expiry.
