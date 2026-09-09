import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

// The map itself needs WebGL, which jsdom does not have. App's job here is only
// to place FlightMap inside the full-viewport shell.
vi.mock('./map/FlightMap', () => ({
  FlightMap: () => <div data-testid="flight-map" />,
}))

const { default: App } = await import('./App')

describe('App', () => {
  it('renders the map inside the full viewport shell', () => {
    const { container } = render(<App />)
    const shell = container.querySelector('.app-shell')

    expect(shell).not.toBeNull()
    expect(shell?.contains(screen.getByTestId('flight-map'))).toBe(true)
  })
})
