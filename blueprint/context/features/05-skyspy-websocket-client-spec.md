# Feature: SkySpy WebSocket client

**From build-plan:** feature 05
**Build attempt:** 1
**Branch:** feature/05-skyspy-websocket-client

Source: `docs/flight-map-plan.md` §6 Step 5.

## Goal

A resilient, typed WebSocket client that connects to SkySpy, authenticates via
`Sec-WebSocket-Protocol`, subscribes to the aircraft topic, dispatches typed
frames to a consumer, and recovers from disconnection on its own.

## In scope

- `SkySpyClient` class: connect, subscribe, dispatch, reconnect, close
- Auth via the subprotocol array from `buildProtocols()`
- Exponential backoff with jitter, per the documented server expectation
- 30 s ping/pong keepalive
- Resubscribe after every reconnect
- A distinct `auth-failed` status
- `useSkySpy` React hook binding lifecycle and status

## Out of scope

- Storing aircraft (feature 06) or rendering them (feature 07)
- The request/response pattern for `aircraft-info` (not needed until v2, if ever)
- REST calls

## Build loop

Implement all steps, then one review packet.

## Build steps

- [ ] **Add `ws/messages.ts`:** the envelope type, a discriminated union of the
  six aircraft message types, and a type guard per type built on the feature 03
  fixtures. Unknown message types are ignored, not thrown on - a server that
  adds a type must not break the client.
  **Done when:** every fixture is correctly narrowed by its guard, and an unknown
  type is ignored without error.
- [ ] **Add `ws/SkySpyClient.ts` with connect and dispatch.** Constructor takes
  url, optional token, and an `onMessage` callback.
  `new WebSocket(url, buildProtocols(token))`. On open, send the subscribe
  action for the `aircraft` topic. On message, parse, guard, and dispatch.
  Malformed JSON is logged and skipped, never fatal.
  **Done when:** against the mock, every frame type reaches `onMessage`
  correctly typed, and a corrupt frame does not kill the connection.
- [ ] **Add status reporting.** A `ConnectionStatus` of `connecting`,
  `connected`, `reconnecting`, `auth-failed`, or `closed`, exposed via an
  `onStatusChange` callback. A handshake rejection (close before open, or close
  code 1002/1008/4001-range) reports `auth-failed` and **stops retrying** - a
  bad token otherwise looks identical to an unreachable server and hides itself
  in an endless silent reconnect loop.
  **Done when:** the mock's `--reject-auth` flag produces `auth-failed` and no
  further reconnect attempts.
- [ ] **Add reconnection with backoff.** Exponential with jitter: 1000 ms start,
  30000 ms max, x2 multiplier, 0-30% random variance, matching the documented
  server expectation. Reset the delay after a connection stays up past a
  threshold. Resubscribe on every reconnect.
  **Done when:** the mock's `--drop-every` flag shows connected → reconnecting →
  connected repeatedly, with delays growing then resetting.
- [ ] **Add a 30 s ping keepalive** and track the last frame timestamp so
  consumers can detect a silent-but-open connection.
  **Done when:** the mock's `--silent-after` flag leaves the socket open while
  `lastFrameAt` visibly stops advancing.
- [ ] **Add `close()` and prove no leaks.** Closing must clear every timer,
  detach every listener, and prevent any queued reconnect from firing.
  **Done when:** a test closes the client mid-backoff and asserts no timer fires
  and no reconnect is attempted afterwards.
- [ ] **Add `ws/useSkySpy.ts`.** Creates the client once, connects on mount,
  closes on unmount, returns status and `lastFrameAt`. Must survive React 18
  StrictMode double-mounting without opening two sockets or leaking the first.
  **Done when:** in StrictMode dev, exactly one socket is open and unmounting
  leaves none.

## Files / areas

- `src/ws/SkySpyClient.ts`, `src/ws/messages.ts`, `src/ws/useSkySpy.ts`
- `src/ws/buildProtocols.ts` (from feature 03, consumed here)

## Data / contracts

Auth transport is settled: token travels via `Sec-WebSocket-Protocol`, using the
array shape confirmed in feature 03. **No query-string fallback**, not even in
development.

Subscribe and unsubscribe use the documented action/topics envelope.

Backoff parameters come from SkySpy's documented client expectation. Do not
invent different numbers.

The client owns transport only. It never interprets aircraft semantics, holds
aircraft state, or touches the map - that separation is what makes it testable
against a fake socket.

## Testing

Unit, against an injectable fake WebSocket (constructor injection so tests can
substitute it):

- The exact protocol array passed to the constructor, with and without a token
- Subscribe sent on open, and again after reconnect
- Each fixture dispatched with the right narrowed type
- Malformed JSON skipped without closing
- Backoff delay sequence with jitter stubbed to a fixed value
- `auth-failed` stops retrying
- `close()` mid-backoff fires no timer and no reconnect
- StrictMode double-mount opens one socket

## Notes for the AI

- Timer-heavy code: use Vitest fake timers, and make the jitter source injectable
  so backoff is deterministic under test.
- Reconnect logic is where subtle leaks live. Every path that schedules a timer
  needs a matching clear, and `close()` needs a guard flag that queued callbacks
  check before running.
- Do not add a WebSocket wrapper library. The custom subprotocol auth and
  subscribe protocol are the whole job; a library would be wrapped anyway.
