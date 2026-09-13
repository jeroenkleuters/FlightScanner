/**
 * The poll loop over the OpenSky transport.
 *
 * It schedules, classifies, and reports. It does not decode vectors, hold fleet
 * state, derive staleness, or touch the map: snapshots go straight to
 * `onSnapshot`, which is where the aircraft store will attach.
 *
 * One poll is one credit against a daily 4000, so a duplicated loop or an
 * overlapping request is a budget bug rather than a performance one. Hence the
 * single in-flight guard and the idempotent `start()`.
 */

import type {
  BoundingBox,
  OpenSkyClient,
  OpenSkyResult,
  StatesSnapshot,
} from './opensky'
import {
  INITIAL_PROGRESS,
  nextDelayMs,
  nextProgress,
  type PollProgress,
} from './pollSchedule'

export interface PollerState extends PollProgress {
  /** Client clock in ms when the last snapshot arrived. */
  lastSnapshotAt?: number
  /** Size of the last snapshot, not a running fleet total. */
  aircraftCount?: number
}

/** Injected so tests drive time instead of waiting for it. */
export interface Scheduler {
  setTimeout(callback: () => void, delayMs: number): number
  clearTimeout(handle: number): void
}

export const REAL_SCHEDULER: Scheduler = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle),
}

/** Injected for the same reason as the scheduler: tests drive it directly. */
export interface VisibilitySource {
  isHidden(): boolean
  /** Returns its own unsubscribe. */
  subscribe(listener: () => void): () => void
}

export const DOCUMENT_VISIBILITY: VisibilitySource = {
  isHidden: () =>
    typeof document !== 'undefined' && document.visibilityState === 'hidden',
  subscribe(listener) {
    document.addEventListener('visibilitychange', listener)
    return () => document.removeEventListener('visibilitychange', listener)
  },
}

export interface PollingClientOptions {
  client: OpenSkyClient
  box: BoundingBox
  intervalMs: number
  onSnapshot?: (snapshot: StatesSnapshot) => void
  onStateChange?: (state: PollerState) => void
  now?: () => number
  scheduler?: Scheduler
  visibility?: VisibilitySource
}

export interface PollingClient {
  start(): void
  stop(): void
  /** Polls immediately, including from a terminal status. */
  retryNow(): void
  getState(): PollerState
}

export function createPollingClient({
  client,
  box,
  intervalMs,
  onSnapshot,
  onStateChange,
  now = Date.now,
  scheduler = REAL_SCHEDULER,
  visibility = DOCUMENT_VISIBILITY,
}: PollingClientOptions): PollingClient {
  let state: PollerState = { ...INITIAL_PROGRESS }
  let running = false
  let inFlight = false
  let timer: number | undefined
  let lastAttemptAt: number | undefined
  let unsubscribe: (() => void) | undefined
  // Bumped by stop(), so a response that lands after teardown is ignored rather
  // than reviving a dead loop.
  let generation = 0

  function setState(next: PollerState): void {
    state = next
    onStateChange?.(state)
  }

  function cancelTimer(): void {
    if (timer !== undefined) {
      scheduler.clearTimeout(timer)
      timer = undefined
    }
  }

  function scheduleIn(delayMs: number): void {
    cancelTimer()
    timer = scheduler.setTimeout(() => {
      timer = undefined
      attempt()
    }, delayMs)
  }

  function scheduleNext(): void {
    cancelTimer()
    // A hidden tab schedules nothing at all; the visibility listener restarts
    // the loop, so no request is queued up to fire behind the user's back.
    if (visibility.isHidden()) return

    const delay = nextDelayMs(state, intervalMs)
    if (delay !== undefined) scheduleIn(delay)
  }

  function handleVisibilityChange(): void {
    if (!running) return

    if (visibility.isHidden()) {
      // An in-flight request is left to finish and deliver; only the next one
      // is withheld.
      cancelTimer()
      return
    }

    if (inFlight) return

    const delay = nextDelayMs(state, intervalMs)
    if (delay === undefined) return

    const elapsed =
      lastAttemptAt === undefined ? Number.POSITIVE_INFINITY : now() - lastAttemptAt

    // Resuming never buys a request the cadence had not already earned, so
    // flicking between tabs cannot spend extra credits.
    if (elapsed >= delay) attempt()
    else scheduleIn(delay - elapsed)
  }

  function attempt(): void {
    if (!running || inFlight || visibility.isHidden()) return

    cancelTimer()
    inFlight = true
    lastAttemptAt = now()
    const attemptGeneration = generation
    setState({ ...state, status: 'polling' })

    void client
      .fetchStates(box)
      .catch<OpenSkyResult<StatesSnapshot>>(() => ({
        // fetchStates classifies its own failures, so this only catches a
        // broken client. Retrying is still the right response.
        status: 'error',
        reason: 'network',
      }))
      .then((outcome) => {
        if (attemptGeneration !== generation) return
        inFlight = false

        const progress = nextProgress(outcome, state)
        if (outcome.status === 'found') {
          setState({
            ...progress,
            lastSnapshotAt: now(),
            aircraftCount: outcome.data.aircraft.length,
          })
          onSnapshot?.(outcome.data)
        } else {
          setState({
            ...progress,
            lastSnapshotAt: state.lastSnapshotAt,
            aircraftCount: state.aircraftCount,
          })
        }

        if (running) scheduleNext()
      })
  }

  return {
    start() {
      if (running) return
      running = true
      unsubscribe = visibility.subscribe(handleVisibilityChange)
      attempt()
    },

    stop() {
      running = false
      inFlight = false
      generation += 1
      cancelTimer()
      unsubscribe?.()
      unsubscribe = undefined
    },

    retryNow() {
      if (!running) return
      // A terminal status has no pending timer; this is the only way out of one.
      cancelTimer()
      attempt()
    },

    getState() {
      return state
    },
  }
}
