/**
 * Poll lifecycle rules, as pure functions the loop in `pollingClient.ts` drives.
 *
 * Status here describes polling only. Per-aircraft staleness is the store's job
 * and is derived from `lastContact`, not from anything this module sees.
 */

import type { OpenSkyResult, StatesSnapshot } from './opensky'

export type PollStatus =
  | 'idle'
  | 'polling'
  | 'ok'
  | 'budget-exhausted'
  | 'auth-failed'
  | 'unreachable'

/**
 * Five minutes. Long enough that a proxy outage costs almost nothing, short
 * enough that recovery is noticed without a reload.
 */
export const MAX_BACKOFF_MS = 300_000

export interface PollProgress {
  status: PollStatus
  consecutiveFailures: number
  creditsRemaining?: number
}

export const INITIAL_PROGRESS: PollProgress = {
  status: 'idle',
  consecutiveFailures: 0,
}

/**
 * Terminal statuses stop the loop. Nothing on the client knows when the OpenSky
 * daily budget resets, and retrying rejected credentials cannot succeed, so both
 * wait for an explicit retry rather than spending requests to learn nothing.
 */
export function isTerminal(status: PollStatus): boolean {
  return status === 'budget-exhausted' || status === 'auth-failed'
}

function failure(
  status: PollStatus,
  previous: PollProgress,
): PollProgress {
  return {
    status,
    consecutiveFailures: previous.consecutiveFailures + 1,
    creditsRemaining: previous.creditsRemaining,
  }
}

export function nextProgress(
  outcome: OpenSkyResult<StatesSnapshot>,
  previous: PollProgress,
): PollProgress {
  if (outcome.status === 'found') {
    // A snapshot without the header leaves the last known figure standing
    // rather than erasing it.
    const creditsRemaining =
      outcome.data.creditsRemaining ?? previous.creditsRemaining

    return {
      // The next request would only earn a 429, so stop one request early.
      status: creditsRemaining === 0 ? 'budget-exhausted' : 'ok',
      consecutiveFailures: 0,
      creditsRemaining,
    }
  }

  // `fetchStates` never returns `missing` today, but the union has the branch
  // and a retryable transport oddity is the safer reading of it.
  if (outcome.status === 'missing') return failure('unreachable', previous)

  switch (outcome.reason) {
    case 'auth':
      return failure('auth-failed', previous)
    case 'rate-limited':
      return failure('budget-exhausted', previous)
    default:
      return failure('unreachable', previous)
  }
}

/** Milliseconds until the next attempt, or undefined when nothing is scheduled. */
export function nextDelayMs(
  progress: PollProgress,
  intervalMs: number,
): number | undefined {
  if (isTerminal(progress.status)) return undefined
  if (progress.consecutiveFailures === 0) return intervalMs

  const backoff = intervalMs * 2 ** (progress.consecutiveFailures - 1)
  // The cap never pulls a retry inside the configured interval, so the credit
  // floor holds on the retry path too however slowly the app is configured.
  return Math.min(backoff, Math.max(MAX_BACKOFF_MS, intervalMs))
}
