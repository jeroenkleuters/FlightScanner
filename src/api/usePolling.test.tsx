import { act, render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { config } from '../config'
import type { FetchLike, StatesSnapshot } from './opensky'
import { usePolling } from './usePolling'

const SNAPSHOT = { time: 1_700_000_000, states: [['abc123', 'KLM1  ']] }

function jsonResponse(body: unknown, credits = '3999'): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'X-Rate-Limit-Remaining': credits,
    },
  })
}

function Probe({ fetch }: { fetch: FetchLike }) {
  const { status, aircraftCount, creditsRemaining } = usePolling({ fetch })

  return (
    <p>
      {status} {aircraftCount ?? '-'} {creditsRemaining ?? '-'}
    </p>
  )
}

/** Advances fake time and lets React flush the state updates that follow. */
async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('usePolling', () => {
  it('polls once per interval and reports the snapshot figures', async () => {
    const fetch = vi.fn(() => Promise.resolve(jsonResponse(SNAPSHOT))) as unknown as FetchLike

    render(<Probe fetch={fetch} />)
    await advance(0)

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(screen.getByText('ok 1 3999')).toBeTruthy()

    await advance(config.pollIntervalMs)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('requests the configured fixed bounding box', async () => {
    const fetch = vi.fn(() => Promise.resolve(jsonResponse(SNAPSHOT))) as unknown as FetchLike

    render(<Probe fetch={fetch} />)
    await advance(0)

    const url = String(vi.mocked(fetch).mock.calls[0][0])
    expect(url).toContain('/api/opensky/states?')
    expect(url).toContain(`lamin=${config.boundingBox.lamin}`)
    expect(url).toContain(`lomax=${config.boundingBox.lomax}`)
  })

  it('spends one request per interval under StrictMode double mounting', async () => {
    const fetch = vi.fn(() => Promise.resolve(jsonResponse(SNAPSHOT))) as unknown as FetchLike

    render(
      <StrictMode>
        <Probe fetch={fetch} />
      </StrictMode>,
    )
    await advance(0)

    expect(fetch).toHaveBeenCalledTimes(1)

    await advance(config.pollIntervalMs)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('leaves no timer or request behind after unmount', async () => {
    const fetch = vi.fn(() => Promise.resolve(jsonResponse(SNAPSHOT))) as unknown as FetchLike

    const view = render(<Probe fetch={fetch} />)
    await advance(0)
    view.unmount()

    expect(vi.getTimerCount()).toBe(0)

    await advance(config.pollIntervalMs * 3)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('surfaces a rejected credential as a terminal status', async () => {
    const fetch = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: 'credentials-rejected' }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    ) as unknown as FetchLike

    render(<Probe fetch={fetch} />)
    await advance(0)

    expect(screen.getByText('auth-failed - -')).toBeTruthy()

    await advance(config.pollIntervalMs * 5)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('hands each snapshot to the caller', async () => {
    const fetch = vi.fn(() => Promise.resolve(jsonResponse(SNAPSHOT))) as unknown as FetchLike
    const onSnapshot = vi.fn<(snapshot: StatesSnapshot) => void>()

    function Consumer() {
      usePolling({ fetch, onSnapshot })
      return null
    }

    render(<Consumer />)
    await advance(0)

    expect(onSnapshot).toHaveBeenCalledTimes(1)
    expect(onSnapshot.mock.calls[0][0].aircraft[0].hex).toBe('abc123')
  })
})
