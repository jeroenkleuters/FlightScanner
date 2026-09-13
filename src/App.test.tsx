import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { UsePollingResult } from './api/usePolling'

// The map itself needs WebGL, which jsdom does not have. App's job here is only
// to place FlightMap inside the full-viewport shell.
vi.mock('./map/FlightMap', () => ({
  FlightMap: () => <div data-testid="flight-map" />,
}))

const pollState = vi.fn<() => UsePollingResult>()

vi.mock('./api/usePolling', () => ({
  usePolling: () => pollState(),
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
    pollState.mockReturnValue(
      state({ aircraftCount: 0, creditsRemaining: 3999 }),
    )
    render(<App />)

    expect(screen.getByText('Live')).toBeTruthy()
    expect(screen.getByText('0 aircraft')).toBeTruthy()
    expect(screen.getByText('3999 credits')).toBeTruthy()
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
