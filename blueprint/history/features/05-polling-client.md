# Feature: Polling client

**From build-plan:** feature 5
**Build attempt:** 1

**Branch:** feature/polling-client
**Status:** verified

## Goal

Drive the shipped OpenSky transport on a repeating interval against one fixed
bounding box, so the rest of v1 has a live stream of snapshots to build on. The
loop must pause when the tab is hidden, back off when the proxy or upstream
fails, stop rather than hammer when credentials are rejected or the daily credit
budget is gone, and never spend more than one credit per interval.

This feature owns `VITE_OPENSKY_BBOX`, which the plans introduce but no module
reads yet (`project-overview.md` open question 2 names feature 5 as its home).

## In scope

- `VITE_OPENSKY_BBOX` parsed and validated in `src/config.ts`, defaulting to
  `50.5,3.0,53.8,7.3`, exposed as a typed `BoundingBox` on `config`
- A pure scheduling module: given the last outcome and the consecutive failure
  count, what the next poll status and the next delay are
- A poll loop over the existing `OpenSkyClient.fetchStates`, with exactly one
  request in flight at a time and no overlapping timers
- Visibility pause and elapsed-aware resume
- Exponential backoff on retryable failures
- Terminal stop on `auth` and on budget exhaustion, with an explicit
  `retryNow()` for the manual refresh feature 10 will add
- Credit tracking: the latest `creditsRemaining` from the transport is carried on
  the poller state, and a successful snapshot reporting `0` remaining moves the
  poller to `budget-exhausted` instead of firing a request that will 429
- A `usePolling` React hook that starts and stops the loop with the component,
  survives StrictMode double-mounting without a second request or a leaked
  timer, and re-renders only on status, count, and credit changes
- A provisional one-line readout in `App.tsx` so the loop is observable in the
  running app

## Out of scope

- The aircraft store and snapshot reconciliation (feature 6). This feature hands
  each snapshot to a caller-supplied callback and keeps no fleet state beyond the
  most recent snapshot's aircraft count.
- The map layer (feature 7) and any rendering of aircraft.
- The poll status bar, remaining-credit presentation, stale-snapshot warning,
  manual refresh control, and the "outside the covered box" state (feature 10).
  The provisional readout is a placeholder that feature 10 replaces, not a
  design.
- Drawing the bounding box outline on the map. Still unowned; feature 10's UI
  work is the likely home and it is not pulled forward here.
- The `stale` member of the overview's `PollStatus`. Staleness is derived from
  per-aircraft `lastContact` by the store (feature 6) and composed into the
  displayed status by feature 10. This poller reports poll lifecycle only and
  must not invent a snapshot-age rule: the mock's `stale` fault backdates contact
  times while leaving the snapshot's own `time` current, so a `time`-based rule
  here would be wrong.
- Any change to `src/server/`, the proxy error contract, or the mock feed.

## Build loop

One review packet after all steps (`workflow.stepReview: "feature"`), with step
checkpoint commits disabled. Implement the steps in order, keep the project
working after each, and run `npm run verify` before presenting the packet.
`/complete` creates the final feature commit.

## Build steps

- [x] **1. Fixed bounding box configuration.** Add `VITE_OPENSKY_BBOX` to
  `src/config.ts` as `lamin,lomin,lamax,lomax`, defaulting to
  `50.5,3.0,53.8,7.3`. Reject anything that is not four finite numbers, a
  latitude outside -90..90, a longitude outside -180..180, `lamin > lamax`, or
  `lomin > lomax`, with the existing `ConfigError` shape that names the variable
  and never its value. Export the default as a constant and reuse the transport's
  `BoundingBox` type rather than declaring a second one. Document the variable in
  `.env.example` alongside the other client variables.
  *Done when:* new `src/config.test.ts` cases cover the default, a valid box, and
  each rejection, `npm test` passes, and `npm run typecheck` is clean.

- [x] **2. Pure poll scheduling.** Add `src/api/pollSchedule.ts` with the poller
  status type and two pure functions: one mapping an attempt outcome plus the
  prior state to the next status, one returning the delay until the next attempt.
  Retryable failures (`network`, `server`, `malformed`) are separated from the
  terminal ones per the Data / contracts table below. Backoff is
  `min(pollIntervalMs * 2 ** (consecutiveFailures - 1), 300000)`, deterministic
  and without jitter: one browser tab is not a thundering herd, and a
  reproducible delay is testable.
  *Done when:* `src/api/pollSchedule.test.ts` covers the status transitions for
  every `OpenSkyErrorReason`, the backoff sequence 30s/60s/120s/240s/300s/300s at
  the default interval, the reset to the plain interval after a success, and the
  zero-credit transition; `npm test` passes.

- [x] **3. The poll loop.** Add `src/api/pollingClient.ts` exporting
  `createPollingClient({ client, box, intervalMs, onSnapshot, onStateChange, now,
  schedule })`, where `schedule` wraps `setTimeout` and `clearTimeout` so tests
  drive it. It exposes `start()`, `stop()`, and `retryNow()`. Guarantees: at most
  one request in flight; a second `start()` on a running poller is a no-op;
  `stop()` clears the pending timer and ignores the result of any in-flight
  request; `retryNow()` cancels the pending timer and attempts immediately,
  including from a terminal status. Snapshots go to `onSnapshot` unchanged; the
  poller keeps only status, `creditsRemaining`, `lastSnapshotAt`, the last
  snapshot's aircraft count, and `consecutiveFailures`. It derives no staleness
  and touches no map.
  *Done when:* `src/api/pollingClient.test.ts` uses `vi.useFakeTimers()` and an
  injected fake `OpenSkyClient` to prove the interval cadence, no overlap when a
  response is slower than the interval, backoff on failure and recovery after it,
  the terminal stop on `auth` and on budget exhaustion, `retryNow()` from a
  terminal status, and that `stop()` leaves no pending timer; `npm test` passes.

- [x] **4. Visibility pause.** Pause the loop while `document.visibilityState`
  is `hidden`: cancel the pending timer, let any in-flight request finish and
  deliver, and start no new attempt. On becoming visible, poll immediately when
  at least `intervalMs` has elapsed since the last attempt started, otherwise
  schedule the remainder, so switching tabs repeatedly cannot spend extra
  credits. The listener is injected the same way the timer is, registered on
  `start()` and removed on `stop()`. A terminal status stays terminal across a
  visibility change.
  *Done when:* tests cover pause while hidden, immediate poll on resume after a
  full interval, remainder-only scheduling on an early resume, no duplicate
  request from repeated visibility events, listener removal on `stop()`, and that
  a hidden tab fires no request at all; `npm test` passes.

- [x] **5. React hook and provisional readout.** Add `src/api/usePolling.ts`
  wrapping the poller for React: it builds the client from
  `createOpenSkyClient({ fetch: window.fetch.bind(window) })`, reads
  `config.boundingBox` and `config.pollIntervalMs`, starts on mount, stops on
  unmount, and returns the poller state plus `retryNow`. Aircraft data does not
  enter React state: the hook re-renders on status, count, and credit changes
  only, and the snapshot callback is what feature 6 will hook the store into.
  Mount it in `App.tsx` with a single `aria-live="polite"` provisional line
  giving status, aircraft count, and credits remaining, with absent values as a
  dash rather than `0`.
  *Done when:* a React Testing Library test with fake timers proves one request
  per interval under `StrictMode` double-mounting and no pending timer or
  listener after unmount; the readout renders the status text; `npm run verify`
  passes; and `npm run mock` plus `npm run dev` shows the line moving through
  `polling` and `ok`, with the mock's `unauthorized`, `rate-limited`, and
  `server-error` faults producing `auth-failed`, `budget-exhausted`, and
  `unreachable` respectively.

## Verification

`npm run verify` (typecheck, 244 tests across 14 files, production build) passed
on 2026-09-13, plus `npm run lint` clean. `npm run format:check` reports 33 files
including untouched ones; it fails the same way on a clean checkout of master, so
it is pre-existing and not from this feature.

Step 5's live mock run is the one item not covered automatically: implement does
not start servers. The manual path is in the final packet.

## Files / areas

- `src/config.ts`, `src/config.test.ts` - bounding box parsing (step 1)
- `.env.example` - document `VITE_OPENSKY_BBOX` (step 1)
- `src/api/pollSchedule.ts`, `src/api/pollSchedule.test.ts` - new (step 2)
- `src/api/pollingClient.ts`, `src/api/pollingClient.test.ts` - new (steps 3, 4)
- `src/api/usePolling.ts`, `src/api/usePolling.test.tsx` - new (step 5)
- `src/App.tsx`, `src/App.test.tsx` - mount the hook, provisional readout (step 5)
- `src/index.css` - one class for the provisional readout, if needed (step 5)
- Unchanged: `src/api/opensky.ts`, all of `src/server/`, `api/`, `mock/`,
  `src/map/`

## Data / contracts

**Bounding box.** `VITE_OPENSKY_BBOX` is `lamin,lomin,lamax,lomax`, matching the
order the proxy and transport already use. Default `50.5,3.0,53.8,7.3`. Fixed for
the session: the camera never changes it, and nothing in this feature reads the
map viewport.

**Poller status**, the poll lifecycle only:

`idle` | `polling` | `ok` | `budget-exhausted` | `auth-failed` | `unreachable`

**Outcome to status and retry**, keyed on the transport's existing
`OpenSkyResult`:

| Outcome | Status | Next attempt |
| --- | --- | --- |
| `found`, `creditsRemaining` absent or above 0 | `ok` | after `pollIntervalMs`, failure count reset to 0 |
| `found`, `creditsRemaining === 0` | `budget-exhausted` | none, terminal until `retryNow()` |
| `error` `network` | `unreachable` | backoff |
| `error` `server` | `unreachable` | backoff |
| `error` `malformed` | `unreachable` | backoff |
| `error` `rate-limited` | `budget-exhausted` | none, terminal until `retryNow()` |
| `error` `auth` | `auth-failed` | none, terminal until `retryNow()` |
| `missing` | `unreachable` | backoff |

`missing` does not occur on this route today (`fetchStates` never returns it),
but the discriminated union requires a branch, and treating it as a retryable
transport oddity is safer than assuming it cannot happen.

An empty box is a success, not an error: `states: null` decodes to zero aircraft
and produces `ok` with a count of 0.

**Backoff.** `min(pollIntervalMs * 2 ** (consecutiveFailures - 1), 300000)`, so
30s, 60s, 120s, 240s, 300s, 300s at the default interval. It never schedules
sooner than `pollIntervalMs`, which keeps the hard 30 s credit floor intact on
the retry path as well as the steady-state one.

**Terminal statuses do not self-retry.** Nothing on the client knows when the
OpenSky daily budget resets, and retrying rejected credentials cannot succeed.
Blind retries in either case spend requests to learn nothing, so both stop and
wait for `retryNow()`, which feature 10's manual refresh will call.

**Poller state**, the object passed to `onStateChange`:

- `status` - the value above
- `creditsRemaining?: number` - latest reported by the proxy header, absent until
  a snapshot carries one; absent renders as a dash, never as 0
- `lastSnapshotAt?: number` - client clock, ms, when the last snapshot arrived
- `aircraftCount?: number` - size of the last snapshot, not a running fleet total
- `consecutiveFailures: number`

**Credit cost.** One poll is one credit. Overlapping requests, double-started
loops, and a second poller mounted by StrictMode are all budget bugs, which is
why the single-in-flight and idempotent-`start()` guarantees are contract, not
polish.

## Testing

The test gate is on and every step here is logic-bearing, so each ships tests in
the same diff. Use `vi.useFakeTimers()` for all timing, an injected fake
`OpenSkyClient` or `FetchLike` rather than a mocked global `fetch`, and an
injected visibility source rather than reaching for jsdom's real
`document.visibilityState` where injection is cleaner. No test may reach OpenSky
or the mock server over the network.

Browser verification is manual against `npm run mock` in step 5; this project has
no browser test command, so none is claimed.

## Notes for the AI

- Transport code owns transport. `pollingClient.ts` schedules and classifies; it
  does not decode vectors, derive staleness, or hold fleet state. The one
  snapshot it retains is for the count and timestamp, not for the store.
- Do not add a second `BoundingBox` type. Import the one exported from
  `src/api/opensky.ts`.
- `src/config.ts` stays the only reader of `import.meta.env`.
- Every timer and listener needs a matching teardown, and the hook must be clean
  under StrictMode. This is the leak-prone part of the feature and it costs real
  credits when it goes wrong.
- No em dashes in code comments, docs, or commit messages.
- Comment the why, not the what: the 30 s floor, the terminal-status reasoning,
  and the visibility resume rule are worth a line each; nothing else is.


<!-- blueprint:completion {"schemaVersion":1,"specBytes":13565,"specSha256":"4ef866c10a6301afb8070321181fc41781be969271058878dc0ed2e851a437b3","branch":"refs/heads/feature/polling-client","head":"6abb00a95e6b2c57a96c8ea006e2e33326a84977","baseRef":"refs/heads/master","baseCommit":"6abb00a95e6b2c57a96c8ea006e2e33326a84977","sourceTree":"7bdbd09e8d0de94ff86cb0514c4865ee3ca44613","absentOptional":[]} -->
