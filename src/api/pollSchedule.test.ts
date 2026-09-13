import { describe, expect, it } from 'vitest'
import { DEFAULT_POLL_INTERVAL_MS } from '../config'
import type { OpenSkyErrorReason, OpenSkyResult, StatesSnapshot } from './opensky'
import {
  INITIAL_PROGRESS,
  MAX_BACKOFF_MS,
  isTerminal,
  nextDelayMs,
  nextProgress,
  type PollProgress,
} from './pollSchedule'

function snapshot(
  creditsRemaining?: number,
): OpenSkyResult<StatesSnapshot> {
  return {
    status: 'found',
    data: { time: 1_700_000_000, aircraft: [], creditsRemaining },
  }
}

function failed(reason: OpenSkyErrorReason): OpenSkyResult<StatesSnapshot> {
  return { status: 'error', reason }
}

const afterFailures = (count: number): PollProgress => ({
  status: 'unreachable',
  consecutiveFailures: count,
})

describe('nextProgress', () => {
  it('reports ok and clears the failure count on a snapshot', () => {
    expect(nextProgress(snapshot(3999), afterFailures(4))).toEqual({
      status: 'ok',
      consecutiveFailures: 0,
      creditsRemaining: 3999,
    })
  })

  it('treats an empty box as a success', () => {
    expect(nextProgress(snapshot(3999), INITIAL_PROGRESS).status).toBe('ok')
  })

  it('keeps the last known credit figure when a snapshot carries no header', () => {
    const previous: PollProgress = {
      status: 'ok',
      consecutiveFailures: 0,
      creditsRemaining: 12,
    }

    expect(nextProgress(snapshot(undefined), previous).creditsRemaining).toBe(12)
  })

  it('leaves credits absent when none has ever been reported', () => {
    expect(
      nextProgress(snapshot(undefined), INITIAL_PROGRESS).creditsRemaining,
    ).toBeUndefined()
  })

  it('stops one request early when a snapshot reports no credits left', () => {
    expect(nextProgress(snapshot(0), INITIAL_PROGRESS)).toEqual({
      status: 'budget-exhausted',
      consecutiveFailures: 0,
      creditsRemaining: 0,
    })
  })

  it.each([
    ['auth', 'auth-failed'],
    ['rate-limited', 'budget-exhausted'],
    ['network', 'unreachable'],
    ['server', 'unreachable'],
    ['malformed', 'unreachable'],
  ] as const)('maps the %s reason to %s', (reason, status) => {
    expect(nextProgress(failed(reason), INITIAL_PROGRESS)).toEqual({
      status,
      consecutiveFailures: 1,
      creditsRemaining: undefined,
    })
  })

  it('treats a missing result as a retryable transport oddity', () => {
    expect(nextProgress({ status: 'missing' }, INITIAL_PROGRESS).status).toBe(
      'unreachable',
    )
  })

  it('counts consecutive failures', () => {
    expect(
      nextProgress(failed('network'), afterFailures(2)).consecutiveFailures,
    ).toBe(3)
  })

  it('preserves the credit figure across a failure', () => {
    const previous: PollProgress = {
      status: 'ok',
      consecutiveFailures: 0,
      creditsRemaining: 40,
    }

    expect(nextProgress(failed('network'), previous).creditsRemaining).toBe(40)
  })
})

describe('isTerminal', () => {
  it.each(['budget-exhausted', 'auth-failed'] as const)(
    'stops the loop on %s',
    (status) => {
      expect(isTerminal(status)).toBe(true)
    },
  )

  it.each(['idle', 'polling', 'ok', 'unreachable'] as const)(
    'keeps the loop running on %s',
    (status) => {
      expect(isTerminal(status)).toBe(false)
    },
  )
})

describe('nextDelayMs', () => {
  it('uses the plain interval after a success', () => {
    expect(
      nextDelayMs(
        { status: 'ok', consecutiveFailures: 0 },
        DEFAULT_POLL_INTERVAL_MS,
      ),
    ).toBe(DEFAULT_POLL_INTERVAL_MS)
  })

  it('backs off exponentially and then holds at the cap', () => {
    const sequence = [1, 2, 3, 4, 5, 6].map((failures) =>
      nextDelayMs(afterFailures(failures), DEFAULT_POLL_INTERVAL_MS),
    )

    expect(sequence).toEqual([30_000, 60_000, 120_000, 240_000, 300_000, 300_000])
  })

  it('never retries sooner than a configured interval longer than the cap', () => {
    const slow = MAX_BACKOFF_MS * 2

    expect(nextDelayMs(afterFailures(1), slow)).toBe(slow)
    expect(nextDelayMs(afterFailures(5), slow)).toBe(slow)
  })

  it.each(['budget-exhausted', 'auth-failed'] as const)(
    'schedules nothing after %s',
    (status) => {
      expect(
        nextDelayMs(
          { status, consecutiveFailures: 1 },
          DEFAULT_POLL_INTERVAL_MS,
        ),
      ).toBeUndefined()
    },
  )
})
