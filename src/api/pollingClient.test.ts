import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  Aircraft,
} from '../types/aircraft'
import type {
  BoundingBox,
  OpenSkyClient,
  OpenSkyErrorReason,
  OpenSkyResult,
  StatesSnapshot,
} from './opensky'
import {
  createPollingClient,
  type PollerState,
  type VisibilitySource,
} from './pollingClient'

const INTERVAL = 30_000

const BOX: BoundingBox = { lamin: 50.5, lomin: 3, lamax: 53.8, lomax: 7.3 }

function ok(
  count = 2,
  creditsRemaining?: number,
): OpenSkyResult<StatesSnapshot> {
  const aircraft: Aircraft[] = Array.from({ length: count }, (_value, index) => ({
    hex: `abc${index}`,
    lastSeen: 0,
    stale: false,
  }))

  return { status: 'found', data: { time: 1_700_000_000, aircraft, creditsRemaining } }
}

function failed(reason: OpenSkyErrorReason): OpenSkyResult<StatesSnapshot> {
  return { status: 'error', reason }
}

/** Answers with the queued outcomes, repeating the last one once exhausted. */
function scriptedClient(outcomes: OpenSkyResult<StatesSnapshot>[]) {
  const boxes: BoundingBox[] = []
  let index = 0

  const fetchStates = vi.fn((box: BoundingBox) => {
    boxes.push(box)
    const outcome = outcomes[Math.min(index, outcomes.length - 1)]
    index += 1
    return Promise.resolve(outcome)
  })

  return { client: { fetchStates } satisfies OpenSkyClient, fetchStates, boxes }
}

/** A client whose one response is resolved by hand, to model a slow proxy. */
function deferredClient() {
  let release: (outcome: OpenSkyResult<StatesSnapshot>) => void = () => {}
  const fetchStates = vi.fn(
    () =>
      new Promise<OpenSkyResult<StatesSnapshot>>((resolve) => {
        release = resolve
      }),
  )

  return {
    client: { fetchStates } satisfies OpenSkyClient,
    fetchStates,
    release: (outcome: OpenSkyResult<StatesSnapshot>) => release(outcome),
  }
}

function fakeVisibility(hidden = false) {
  const listeners = new Set<() => void>()

  const source: VisibilitySource = {
    isHidden: () => hidden,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }

  return {
    source,
    listenerCount: () => listeners.size,
    set(next: boolean) {
      hidden = next
      for (const listener of [...listeners]) listener()
    },
  }
}

function poller(
  client: OpenSkyClient,
  overrides: Partial<Parameters<typeof createPollingClient>[0]> = {},
) {
  const snapshots: StatesSnapshot[] = []
  const states: PollerState[] = []

  const instance = createPollingClient({
    client,
    box: BOX,
    intervalMs: INTERVAL,
    onSnapshot: (snapshot) => snapshots.push(snapshot),
    onStateChange: (state) => states.push(state),
    now: () => Date.now(),
    ...overrides,
  })

  return { instance, snapshots, states }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createPollingClient', () => {
  it('polls once on start and then once per interval', async () => {
    const { client, fetchStates, boxes } = scriptedClient([ok()])
    const { instance } = poller(client)

    instance.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchStates).toHaveBeenCalledTimes(1)
    expect(boxes[0]).toEqual(BOX)

    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(fetchStates).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(INTERVAL * 3)
    expect(fetchStates).toHaveBeenCalledTimes(5)

    instance.stop()
  })

  it('is idle until started', async () => {
    const { client, fetchStates } = scriptedClient([ok()])
    const { instance } = poller(client)

    await vi.advanceTimersByTimeAsync(INTERVAL * 2)

    expect(fetchStates).not.toHaveBeenCalled()
    expect(instance.getState().status).toBe('idle')
  })

  it('ignores a second start on a running poller', async () => {
    const { client, fetchStates } = scriptedClient([ok()])
    const { instance } = poller(client)

    instance.start()
    instance.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(fetchStates).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(1)

    instance.stop()
  })

  it('hands the snapshot on and records the count and arrival time', async () => {
    const { client } = scriptedClient([ok(3, 3999)])
    const { instance, snapshots } = poller(client)

    instance.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(snapshots).toHaveLength(1)
    expect(snapshots[0].aircraft).toHaveLength(3)
    expect(instance.getState()).toMatchObject({
      status: 'ok',
      aircraftCount: 3,
      creditsRemaining: 3999,
      consecutiveFailures: 0,
    })
    expect(instance.getState().lastSnapshotAt).toBe(Date.now())

    instance.stop()
  })

  it('reports polling before the answer arrives', async () => {
    const { client, release } = deferredClient()
    const { instance, states } = poller(client)

    instance.start()
    expect(instance.getState().status).toBe('polling')

    release(ok())
    await vi.advanceTimersByTimeAsync(0)

    expect(states.map((state) => state.status)).toEqual(['polling', 'ok'])

    instance.stop()
  })

  it('never overlaps requests when a response outlasts the interval', async () => {
    const { client, fetchStates, release } = deferredClient()
    const { instance } = poller(client)

    instance.start()
    await vi.advanceTimersByTimeAsync(INTERVAL * 3)
    expect(fetchStates).toHaveBeenCalledTimes(1)

    release(ok())
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchStates).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(fetchStates).toHaveBeenCalledTimes(2)

    instance.stop()
  })

  it('backs off after failures and recovers after a success', async () => {
    const { client, fetchStates } = scriptedClient([
      failed('network'),
      failed('network'),
      ok(),
    ])
    const { instance } = poller(client)

    instance.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(instance.getState()).toMatchObject({
      status: 'unreachable',
      consecutiveFailures: 1,
    })

    await vi.advanceTimersByTimeAsync(INTERVAL - 1)
    expect(fetchStates).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(fetchStates).toHaveBeenCalledTimes(2)
    expect(instance.getState().consecutiveFailures).toBe(2)

    // Second failure doubles the wait, so nothing fires at one interval.
    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(fetchStates).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(fetchStates).toHaveBeenCalledTimes(3)
    expect(instance.getState()).toMatchObject({
      status: 'ok',
      consecutiveFailures: 0,
    })

    // Recovery returns to the plain interval.
    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(fetchStates).toHaveBeenCalledTimes(4)

    instance.stop()
  })

  it('keeps the last snapshot figures through a failure', async () => {
    const { client } = scriptedClient([ok(4, 3999), failed('server')])
    const { instance } = poller(client)

    instance.start()
    await vi.advanceTimersByTimeAsync(0)
    const snapshotAt = instance.getState().lastSnapshotAt

    await vi.advanceTimersByTimeAsync(INTERVAL)

    expect(instance.getState()).toMatchObject({
      status: 'unreachable',
      aircraftCount: 4,
      creditsRemaining: 3999,
      lastSnapshotAt: snapshotAt,
    })

    instance.stop()
  })

  it('treats a thrown client error as a retryable failure', async () => {
    const fetchStates = vi.fn(() => Promise.reject(new Error('boom')))
    const { instance } = poller({ fetchStates })

    instance.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(instance.getState().status).toBe('unreachable')
    expect(vi.getTimerCount()).toBe(1)

    instance.stop()
  })

  it('stops polling for good when credentials are rejected', async () => {
    const { client, fetchStates } = scriptedClient([failed('auth')])
    const { instance } = poller(client)

    instance.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(instance.getState().status).toBe('auth-failed')
    expect(vi.getTimerCount()).toBe(0)

    await vi.advanceTimersByTimeAsync(INTERVAL * 20)
    expect(fetchStates).toHaveBeenCalledTimes(1)

    instance.stop()
  })

  it('stops polling when the proxy reports the budget is gone', async () => {
    const { client, fetchStates } = scriptedClient([failed('rate-limited')])
    const { instance } = poller(client)

    instance.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(instance.getState().status).toBe('budget-exhausted')

    await vi.advanceTimersByTimeAsync(INTERVAL * 20)
    expect(fetchStates).toHaveBeenCalledTimes(1)

    instance.stop()
  })

  it('stops one request early when a snapshot reports no credits left', async () => {
    const { client, fetchStates } = scriptedClient([ok(1, 0)])
    const { instance, snapshots } = poller(client)

    instance.start()
    await vi.advanceTimersByTimeAsync(0)

    // The snapshot is still real data and must reach the store.
    expect(snapshots).toHaveLength(1)
    expect(instance.getState()).toMatchObject({
      status: 'budget-exhausted',
      creditsRemaining: 0,
    })

    await vi.advanceTimersByTimeAsync(INTERVAL * 20)
    expect(fetchStates).toHaveBeenCalledTimes(1)

    instance.stop()
  })

  it('retries on demand from a terminal status and resumes the interval', async () => {
    const { client, fetchStates } = scriptedClient([failed('auth'), ok()])
    const { instance } = poller(client)

    instance.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(instance.getState().status).toBe('auth-failed')

    instance.retryNow()
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchStates).toHaveBeenCalledTimes(2)
    expect(instance.getState().status).toBe('ok')

    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(fetchStates).toHaveBeenCalledTimes(3)

    instance.stop()
  })

  it('does not stack a request when a retry arrives mid-flight', async () => {
    const { client, fetchStates, release } = deferredClient()
    const { instance } = poller(client)

    instance.start()
    instance.retryNow()
    instance.retryNow()

    expect(fetchStates).toHaveBeenCalledTimes(1)

    release(ok())
    await vi.advanceTimersByTimeAsync(0)
    instance.stop()
  })

  it('ignores a retry before start', async () => {
    const { client, fetchStates } = scriptedClient([ok()])
    const { instance } = poller(client)

    instance.retryNow()
    await vi.advanceTimersByTimeAsync(0)

    expect(fetchStates).not.toHaveBeenCalled()
  })

  it('leaves no timer behind on stop', async () => {
    const { client } = scriptedClient([ok()])
    const { instance } = poller(client)

    instance.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.getTimerCount()).toBe(1)

    instance.stop()
    expect(vi.getTimerCount()).toBe(0)
  })

  describe('visibility', () => {
    it('fires no request at all while the tab is hidden', async () => {
      const { client, fetchStates } = scriptedClient([ok()])
      const visibility = fakeVisibility(true)
      const { instance } = poller(client, { visibility: visibility.source })

      instance.start()
      await vi.advanceTimersByTimeAsync(INTERVAL * 5)

      expect(fetchStates).not.toHaveBeenCalled()
      expect(instance.getState().status).toBe('idle')
      expect(vi.getTimerCount()).toBe(0)

      instance.stop()
    })

    it('pauses the loop when the tab is hidden mid-run', async () => {
      const { client, fetchStates } = scriptedClient([ok()])
      const visibility = fakeVisibility()
      const { instance } = poller(client, { visibility: visibility.source })

      instance.start()
      await vi.advanceTimersByTimeAsync(0)
      expect(fetchStates).toHaveBeenCalledTimes(1)

      visibility.set(true)
      expect(vi.getTimerCount()).toBe(0)

      await vi.advanceTimersByTimeAsync(INTERVAL * 5)
      expect(fetchStates).toHaveBeenCalledTimes(1)

      instance.stop()
    })

    it('polls at once when a full interval passed while hidden', async () => {
      const { client, fetchStates } = scriptedClient([ok()])
      const visibility = fakeVisibility()
      const { instance } = poller(client, { visibility: visibility.source })

      instance.start()
      await vi.advanceTimersByTimeAsync(0)
      visibility.set(true)
      await vi.advanceTimersByTimeAsync(INTERVAL * 3)

      visibility.set(false)
      await vi.advanceTimersByTimeAsync(0)

      expect(fetchStates).toHaveBeenCalledTimes(2)

      instance.stop()
    })

    it('waits out the remainder when the tab comes back early', async () => {
      const { client, fetchStates } = scriptedClient([ok()])
      const visibility = fakeVisibility()
      const { instance } = poller(client, { visibility: visibility.source })

      instance.start()
      await vi.advanceTimersByTimeAsync(0)
      visibility.set(true)
      await vi.advanceTimersByTimeAsync(10_000)

      visibility.set(false)
      await vi.advanceTimersByTimeAsync(0)
      expect(fetchStates).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(INTERVAL - 10_000 - 1)
      expect(fetchStates).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(1)
      expect(fetchStates).toHaveBeenCalledTimes(2)

      instance.stop()
    })

    it('spends nothing extra when the tab is flicked repeatedly', async () => {
      const { client, fetchStates } = scriptedClient([ok()])
      const visibility = fakeVisibility()
      const { instance } = poller(client, { visibility: visibility.source })

      instance.start()
      await vi.advanceTimersByTimeAsync(0)

      for (let flick = 0; flick < 5; flick += 1) {
        visibility.set(true)
        await vi.advanceTimersByTimeAsync(100)
        visibility.set(false)
        await vi.advanceTimersByTimeAsync(100)
      }

      expect(fetchStates).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(1)

      instance.stop()
    })

    it('respects the backoff wait rather than the plain interval on resume', async () => {
      const { client, fetchStates } = scriptedClient([
        failed('network'),
        failed('network'),
        ok(),
      ])
      const visibility = fakeVisibility()
      const { instance } = poller(client, { visibility: visibility.source })

      instance.start()
      await vi.advanceTimersByTimeAsync(INTERVAL)
      expect(fetchStates).toHaveBeenCalledTimes(2)

      visibility.set(true)
      await vi.advanceTimersByTimeAsync(INTERVAL)
      visibility.set(false)
      await vi.advanceTimersByTimeAsync(0)

      // Two failures means a 60 s wait, and only 30 s of it has passed.
      expect(fetchStates).toHaveBeenCalledTimes(2)

      await vi.advanceTimersByTimeAsync(INTERVAL)
      expect(fetchStates).toHaveBeenCalledTimes(3)

      instance.stop()
    })

    it('stays terminal across a visibility change', async () => {
      const { client, fetchStates } = scriptedClient([failed('auth')])
      const visibility = fakeVisibility()
      const { instance } = poller(client, { visibility: visibility.source })

      instance.start()
      await vi.advanceTimersByTimeAsync(0)

      visibility.set(true)
      visibility.set(false)
      await vi.advanceTimersByTimeAsync(INTERVAL * 5)

      expect(fetchStates).toHaveBeenCalledTimes(1)
      expect(instance.getState().status).toBe('auth-failed')

      instance.stop()
    })

    it('lets an in-flight request finish after the tab hides', async () => {
      const { client, release } = deferredClient()
      const visibility = fakeVisibility()
      const { instance, snapshots } = poller(client, {
        visibility: visibility.source,
      })

      instance.start()
      visibility.set(true)
      release(ok())
      await vi.advanceTimersByTimeAsync(0)

      expect(snapshots).toHaveLength(1)
      expect(instance.getState().status).toBe('ok')
      expect(vi.getTimerCount()).toBe(0)

      instance.stop()
    })

    it('removes its visibility listener on stop', async () => {
      const { client } = scriptedClient([ok()])
      const visibility = fakeVisibility()
      const { instance } = poller(client, { visibility: visibility.source })

      instance.start()
      await vi.advanceTimersByTimeAsync(0)
      expect(visibility.listenerCount()).toBe(1)

      instance.stop()
      expect(visibility.listenerCount()).toBe(0)
    })
  })

  it('ignores a response that lands after stop', async () => {
    const { client, fetchStates, release } = deferredClient()
    const { instance, snapshots, states } = poller(client)

    instance.start()
    instance.stop()
    release(ok())
    await vi.advanceTimersByTimeAsync(INTERVAL * 2)

    expect(snapshots).toHaveLength(0)
    expect(states.map((state) => state.status)).toEqual(['polling'])
    expect(fetchStates).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})
