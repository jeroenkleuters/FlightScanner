import { describe, expect, it, vi } from 'vitest'
import {
  createThrottle,
  type ThrottleScheduler,
  type Throttled,
} from './throttle'

/**
 * A scheduler with a hand-cranked clock. `flush` runs the pending callback the
 * way a real frame eventually would, so the coalescing rules are tested without
 * timers or frames.
 */
function fakeScheduler() {
  let pending: (() => void) | undefined
  let lastDelay: number | undefined
  let cancelled = 0

  const scheduler: ThrottleScheduler = {
    schedule(callback, delayMs) {
      pending = callback
      lastDelay = delayMs
    },
    cancel() {
      pending = undefined
      cancelled += 1
    },
  }

  return {
    scheduler,
    get lastDelay() {
      return lastDelay
    },
    get cancelCount() {
      return cancelled
    },
    get isPending() {
      return pending !== undefined
    },
    flush: () => {
      const callback = pending
      pending = undefined
      callback?.()
    },
  }
}

function setup(intervalMs = 250) {
  const run = vi.fn<(value: string) => void>()
  const fake = fakeScheduler()
  let clock = 1000
  const throttled: Throttled<string> = createThrottle(run, {
    intervalMs,
    scheduler: fake.scheduler,
    now: () => clock,
  })

  return {
    run,
    fake,
    throttled,
    advance: (ms: number) => {
      clock += ms
    },
  }
}

describe('createThrottle', () => {
  it('collapses many calls in one window into a single invocation', () => {
    const { run, fake, throttled } = setup()

    throttled.call('a')
    throttled.call('b')
    throttled.call('c')
    expect(run).not.toHaveBeenCalled()

    fake.flush()

    expect(run).toHaveBeenCalledTimes(1)
  })

  it('invokes with the most recent value, not the first', () => {
    const { run, fake, throttled } = setup()

    throttled.call('stale')
    throttled.call('newest')
    fake.flush()

    expect(run).toHaveBeenCalledWith('newest')
  })

  it('opens a new window for a call made after the previous one ran', () => {
    const { run, fake, throttled, advance } = setup(250)

    throttled.call('first')
    fake.flush()
    expect(run).toHaveBeenCalledTimes(1)

    advance(250)
    throttled.call('second')
    fake.flush()

    expect(run).toHaveBeenCalledTimes(2)
    expect(run).toHaveBeenLastCalledWith('second')
  })

  it('delays a call that arrives before the interval has elapsed', () => {
    const { fake, throttled, advance } = setup(250)

    throttled.call('first')
    expect(fake.lastDelay).toBe(0)
    fake.flush()

    advance(100)
    throttled.call('second')

    // 150 ms of the 250 ms window remain.
    expect(fake.lastDelay).toBe(150)
  })

  it('never waits a negative amount when the window has long passed', () => {
    const { fake, throttled, advance } = setup(250)

    throttled.call('first')
    fake.flush()

    advance(10_000)
    throttled.call('second')

    expect(fake.lastDelay).toBe(0)
  })

  it('cancel drops the pending invocation', () => {
    const { run, fake, throttled } = setup()

    throttled.call('dropped')
    throttled.cancel()
    fake.flush()

    expect(run).not.toHaveBeenCalled()
    expect(fake.isPending).toBe(false)
  })

  it('cancel is a no-op when nothing is pending', () => {
    const { fake, throttled } = setup()

    throttled.cancel()

    expect(fake.cancelCount).toBe(0)
  })

  it('accepts calls again after a cancel', () => {
    const { run, fake, throttled } = setup()

    throttled.call('dropped')
    throttled.cancel()
    throttled.call('kept')
    fake.flush()

    expect(run).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledWith('kept')
  })
})
