/**
 * React binding for the poll loop.
 *
 * Only poll status, the aircraft count, and the credit figure pass through
 * React state. Snapshots go to `onSnapshot`, which is where the aircraft store
 * will attach, so hundreds of moving aircraft never reach the reconciler.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { config } from '../config'
import {
  createOpenSkyClient,
  type FetchLike,
  type StatesSnapshot,
} from './opensky'
import { INITIAL_PROGRESS } from './pollSchedule'
import {
  createPollingClient,
  type PollerState,
  type PollingClient,
} from './pollingClient'

export interface UsePollingOptions {
  onSnapshot?: (snapshot: StatesSnapshot) => void
  /** Overridden only by tests; the app always talks to its own proxy. */
  fetch?: FetchLike
}

export interface UsePollingResult extends PollerState {
  retryNow: () => void
}

export function usePolling(options: UsePollingOptions = {}): UsePollingResult {
  const [state, setState] = useState<PollerState>(() => ({
    ...INITIAL_PROGRESS,
  }))

  const optionsRef = useRef(options)
  useEffect(() => {
    optionsRef.current = options
  })

  const pollerRef = useRef<PollingClient | undefined>(undefined)

  useEffect(() => {
    const poller = createPollingClient({
      client: createOpenSkyClient({
        fetch:
          optionsRef.current.fetch ??
          ((input, init) => window.fetch(input, init)),
      }),
      box: config.boundingBox,
      intervalMs: config.pollIntervalMs,
      onSnapshot: (snapshot) => optionsRef.current.onSnapshot?.(snapshot),
      onStateChange: setState,
    })
    pollerRef.current = poller

    // Deferred by one turn so StrictMode's immediate remount cancels the first
    // start instead of spending a second credit on it.
    const pending = window.setTimeout(() => poller.start(), 0)

    return () => {
      window.clearTimeout(pending)
      poller.stop()
      pollerRef.current = undefined
    }
  }, [])

  const retryNow = useCallback(() => pollerRef.current?.retryNow(), [])

  return { ...state, retryNow }
}
