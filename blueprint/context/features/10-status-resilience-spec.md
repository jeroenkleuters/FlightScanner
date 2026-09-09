# Feature: Connection status and resilience

**From build-plan:** feature 10
**Build attempt:** 1
**Branch:** feature/10-status-resilience

Source: `docs/flight-map-plan.md` §6 Step 10.

## Goal

Make the app's health legible and its startup graceful: a clear connection
indicator, live counts, a REST-seeded map so it is never blank on load, and
honest degraded states instead of a silently frozen map.

## In scope

- `ConnectionStatus` indicator with every client state
- `StatsBar`: tracked count, seconds since heartbeat
- REST seed via `/api/v1/aircraft/` on first load
- Manual reconnect control
- A stale-data warning distinct from disconnection

## Out of scope

- Auth login flows (public mode or a configured token only)
- Historical charts or message-rate graphing beyond a simple indicator

## Build loop

Implement all steps, then one review packet.

## Build steps

- [ ] **Add `api/rest.ts`** with a typed `fetchAircraft()` calling
  `GET {HTTP_BASE}/api/v1/aircraft/`, sending the token as an `Authorization`
  header when configured, and unwrapping the
  `{ aircraft, count, now, messages, timestamp }` envelope. Handle non-200 and
  network failure by returning an error result, never throwing into render.
  **Done when:** the function returns parsed aircraft against a mocked response
  and an error result on failure.
- [ ] **Seed the store on first load.** Call `fetchAircraft()` at startup and
  apply it as a snapshot, so the map has aircraft before the first WebSocket
  frame. A failed seed is non-fatal - the WebSocket snapshot will populate the
  map shortly.
  **Done when:** the map shows aircraft immediately on load, and a failing seed
  logs a warning while the app continues to work.
- [ ] **Add `ui/ConnectionStatus.tsx`** rendering the client's status:
  connecting, connected, reconnecting, `auth-failed`, closed. `auth-failed` must
  be visibly different and state that the token was rejected - it is the one
  status the user can act on, and it stops retrying.
  **Done when:** each mock fault flag produces its correct distinct indicator.
- [ ] **Add a stale-data warning.** When the socket is open but no frame has
  arrived for ~15 s, show "connected, no data" - distinct from disconnected. A
  silent-but-open connection otherwise looks identical to a quiet sky.
  **Done when:** the mock's `--silent-after` flag shows the stale warning while
  the status stays connected.
- [ ] **Add `ui/StatsBar.tsx`:** aircraft tracked, aircraft with position, and
  seconds since last heartbeat. Counts come from the store's selectors, throttled
  to about 1 Hz so this does not become a per-frame React render.
  **Done when:** counts track the mock's fleet and update about once a second.
- [ ] **Add a manual reconnect control,** shown when reconnecting, closed, or
  `auth-failed`, resetting backoff and retrying immediately.
  **Done when:** clicking it during backoff attempts a connection at once.

## Files / areas

- `src/api/rest.ts`, `src/api/rest.test.ts`
- `src/ui/ConnectionStatus.tsx`, `src/ui/StatsBar.tsx`
- `src/App.tsx`, `src/ws/useSkySpy.ts` (expose reconnect)

## Data / contracts

The REST list envelope is `{ aircraft, count, now, messages, timestamp }`, with
aircraft objects in the same loose shape as the WebSocket payload - every field
optional, guarded on read.

The seed is applied exactly like `aircraft:snapshot`, reusing that store path
rather than adding a second ingestion route.

Status values come from feature 05's client. This feature only renders them.

Three failure modes must be visually distinguishable: **disconnected** (socket
down, retrying), **connected-but-silent** (socket up, no data), and
**auth-failed** (token rejected, not retrying).

## Testing

- Unit: `fetchAircraft` parses a valid envelope, handles non-200 and network
  error, sends the auth header when a token is configured.
- RTL: `ConnectionStatus` renders each status distinctly; the stale warning
  appears after the threshold with fake timers.
- Manual: each mock fault flag; kill the mock mid-session and confirm recovery.

## Notes for the AI

- CORS applies to the REST call from the browser. Use Vite's dev proxy for both
  HTTP and WS in development, and confirm the proxy forwards
  `Sec-WebSocket-Protocol` intact - proxies that strip it break auth in dev only,
  which is a confusing failure. See `docs/flight-map-plan.md` §8 risk 4.
- Never let a failed REST seed block startup. The WebSocket is the primary
  source; the seed only removes the initial blank moment.
- Keep the stats throttle out of the render path - compute on an interval, not
  on every store change.
