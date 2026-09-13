import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AIRCRAFT_PALETTE } from '../map/aircraftStyle'
import { Legend } from './Legend'

describe('Legend', () => {
  it('lists every altitude stop with its figure, not just a swatch', () => {
    render(<Legend />)

    for (const stop of AIRCRAFT_PALETTE.altitudeStops) {
      expect(screen.getByText(stop.label)).toBeTruthy()
    }
  })

  it('explains the no-altitude neutral too', () => {
    render(<Legend />)

    expect(screen.getByText(AIRCRAFT_PALETTE.noAltitude.label)).toBeTruthy()
  })

  it('takes its colours from the palette rather than repeating hex values', () => {
    const { container } = render(<Legend />)

    const swatches = container.querySelectorAll('.legend-swatch')
    const rendered = [...swatches].map((node) =>
      (node as HTMLElement).style.background.replace(/\s/g, ''),
    )

    // jsdom normalises hex to rgb(), so compare on channel values.
    const expected = [
      ...AIRCRAFT_PALETTE.altitudeStops.map((stop) => stop.color),
      AIRCRAFT_PALETTE.noAltitude.color,
    ].map((hex) => {
      const [r, g, b] = [1, 3, 5].map((i) =>
        Number.parseInt(hex.slice(i, i + 2), 16),
      )
      return `rgb(${r},${g},${b})`
    })

    expect(rendered).toEqual(expected)
  })

  it('is findable as the altitude key', () => {
    render(<Legend />)

    const key = screen.getByRole('region', { name: 'Altitude key' })
    expect(within(key).getByRole('heading', { name: 'Altitude' })).toBeTruthy()
  })

  it('has one row per palette entry and no invented extras', () => {
    const { container } = render(<Legend />)

    expect(container.querySelectorAll('.legend-row')).toHaveLength(
      AIRCRAFT_PALETTE.altitudeStops.length + 1,
    )
  })
})
