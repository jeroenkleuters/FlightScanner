/**
 * Trailing-edge coalescing: many calls inside one window become one invocation,
 * carrying the most recent value.
 *
 * The store notifies once per snapshot, which on a 30 s poll floor is about
 * twice a minute - this is not here to survive a firehose. It is here because
 * one store notification must produce at most one `setData()` no matter what
 * drives it, and features 9 and 10 add callers that fire more often than the
 * poll does.
 *
 * Pure and injectable: the scheduler and clock are parameters, so the coalescing
 * rules are tested with fake time instead of real frames.
 */

/**
 * Owns at most one pending callback. Collapsing the handle into the scheduler
 * keeps `cancel` unambiguous: there is never a second timer to lose track of.
 */
export interface ThrottleScheduler {
  schedule: (callback: () => void, delayMs: number) => void
  cancel: () => void
}

export interface ThrottleOptions {
  /** Minimum gap between two invocations. */
  intervalMs: number
  scheduler: ThrottleScheduler
  now?: () => number
}

export interface Throttled<T> {
  /** Records the value and ensures exactly one pending invocation. */
  call: (value: T) => void
  /** Drops any pending invocation. Safe to call when nothing is pending. */
  cancel: () => void
}

export function createThrottle<T>(
  run: (value: T) => void,
  { intervalMs, scheduler, now = () => Date.now() }: ThrottleOptions,
): Throttled<T> {
  // A holder rather than a bare `T | undefined`, so a legitimately undefined
  // value is still distinguishable from "nothing pending".
  let pending: { value: T } | undefined
  let lastRunAt = Number.NEGATIVE_INFINITY

  return {
    call(value) {
      const alreadyScheduled = pending !== undefined
      pending = { value }
      if (alreadyScheduled) return

      const wait = Math.max(0, lastRunAt + intervalMs - now())
      scheduler.schedule(() => {
        const scheduled = pending
        pending = undefined
        lastRunAt = now()
        if (scheduled !== undefined) run(scheduled.value)
      }, wait)
    },

    cancel() {
      if (pending === undefined) return
      pending = undefined
      scheduler.cancel()
    },
  }
}

/**
 * The production scheduler: wait out the interval, then land on a frame.
 *
 * Aligning to `requestAnimationFrame` means the `setData` lands with the
 * browser's paint rather than between two of them, and a backgrounded tab stops
 * redrawing a map nobody is looking at.
 */
export function createFrameScheduler(): ThrottleScheduler {
  let timer: ReturnType<typeof setTimeout> | undefined
  let frame: number | undefined

  function requestFrame(callback: () => void): void {
    frame = requestAnimationFrame(() => {
      frame = undefined
      callback()
    })
  }

  return {
    schedule(callback, delayMs) {
      if (delayMs <= 0) {
        requestFrame(callback)
        return
      }
      timer = setTimeout(() => {
        timer = undefined
        requestFrame(callback)
      }, delayMs)
    },

    cancel() {
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
      if (frame !== undefined) {
        cancelAnimationFrame(frame)
        frame = undefined
      }
    },
  }
}
