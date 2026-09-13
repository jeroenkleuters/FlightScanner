import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StatesSnapshot } from './api/opensky'
import type { UsePollingOptions, UsePollingResult } from './api/usePolling'

// The map itself needs WebGL, which jsdom does not have. App's job here is only
// to place FlightMap inside the full-viewport shell.
vi.mock('./map/FlightMap', () => ({
  FlightMap: () => <div data-testid="flight-map" />,
}))

const pollState = vi.fn<() => UsePollingResult>()

// Captured so a test can deliver a snapshot the way the real poller would, and
// prove App wired it to the store rather than to a figure of its own.
let deliver: UsePollingOptions['onSnapshot']

vi.mock('./api/usePolling', () => ({
  usePolling: (options: UsePollingOptions = {}) => {
    deliver = options.onSnapshot
    return pollState()
  },
}))

const { default: App } = await import('./App')

function state(overrides: Partial<UsePollingResult> = {}): UsePollingResult {
  return {
    status: 'ok',
    consecutiveFailures: 0,
    retryNow: vi.fn(),
    ...overrides,
  }
}

function snapshot(hexes: string[]): StatesSnapshot {
  return {
    time: 1_700_000_000,
    aircraft: hexes.map((hex) => ({ hex, lastSeen: 0, stale: false })),
  }
}

beforeEach(() => {
  deliver = undefined
})

describe('App', () => {
  it('renders the map inside the full viewport shell', () => {
    pollState.mockReturnValue(state())
    const { container } = render(<App />)
    const shell = container.querySelector('.app-shell')

    expect(shell).not.toBeNull()
    expect(shell?.contains(screen.getByTestId('flight-map'))).toBe(true)
  })

  it('reads absent figures as a dash rather than zero', () => {
    pollState.mockReturnValue(state({ status: 'idle' }))
    render(<App />)

    expect(screen.getByText('Starting')).toBeTruthy()
    expect(screen.getByText('- aircraft')).toBeTruthy()
    expect(screen.getByText('- credits')).toBeTruthy()
  })

  it('shows the live figures once a snapshot arrives', () => {
    pollState.mockReturnValue(state({ creditsRemaining: 3999 }))
    render(<App />)

    act(() => deliver?.(snapshot(['abc123', 'def456'])))

    expect(screen.getByText('Live')).toBeTruthy()
    expect(screen.getByText('2 aircraft')).toBeTruthy()
    expect(screen.getByText('3999 credits')).toBeTruthy()
  })

  it('counts the fleet rather than the size of the last snapshot', () => {
    // The poller's own aircraftCount is the snapshot size, which resets every
    // poll. The readout must show what the store still holds instead.
    pollState.mockReturnValue(state({ aircraftCount: 1 }))
    render(<App />)

    act(() => deliver?.(snapshot(['abc123', 'def456'])))
    act(() => deliver?.(snapshot(['abc123'])))

    expect(screen.getByText('2 aircraft')).toBeTruthy()
  })

  it.each([
    ['unreachable', 'Proxy unreachable, retrying'],
    ['budget-exhausted', 'Daily credit budget spent'],
    ['auth-failed', 'Credentials rejected'],
  ] as const)('keeps %s distinguishable from the others', (status, text) => {
    pollState.mockReturnValue(state({ status }))
    render(<App />)

    expect(screen.getByText(text)).toBeTruthy()
  })

  it('announces status changes politely', () => {
    pollState.mockReturnValue(state())
    const { container } = render(<App />)

    expect(
      container.querySelector('.poll-readout')?.getAttribute('aria-live'),
    ).toBe('polite')
  })
})
