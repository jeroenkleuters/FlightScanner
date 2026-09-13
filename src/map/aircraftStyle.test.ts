import { describe, expect, it } from 'vitest'
import { AIRCRAFT_ICON_ID } from './aircraftIcon'
import {
  AIRCRAFT_LAYER_ID,
  AIRCRAFT_PALETTE,
  AIRCRAFT_SOURCE_ID,
  LABEL_MIN_ZOOM,
  aircraftLayout,
  aircraftPaint,
  emptyFeatureCollection,
} from './aircraftStyle'
import { evaluate } from '../test/styleExpression'

const [ground, fl100, fl250, fl400] = AIRCRAFT_PALETTE.altitudeStops

/** The colour the map would paint an aircraft with these properties. */
function colorFor(properties: Record<string, unknown>): unknown {
  return evaluate(aircraftPaint['icon-color'], { properties })
}

describe('altitude colour ramp', () => {
  it('paints each stop its own colour', () => {
    expect(colorFor({ alt_baro: ground.feet })).toBe(ground.color)
    expect(colorFor({ alt_baro: fl100.feet })).toBe(fl100.color)
    expect(colorFor({ alt_baro: fl250.feet })).toBe(fl250.color)
    expect(colorFor({ alt_baro: fl400.feet })).toBe(fl400.color)
  })

  it('blends between two stops rather than snapping', () => {
    const halfway = colorFor({ alt_baro: 5_000 })

    expect(halfway).not.toBe(ground.color)
    expect(halfway).not.toBe(fl100.color)
    expect(halfway).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('clamps a negative altitude to the ground colour', () => {
    // The committed fixture really does contain negative barometric altitudes.
    expect(colorFor({ alt_baro: -200 })).toBe(ground.color)
  })

  it('clamps above the top stop instead of running off the ramp', () => {
    expect(colorFor({ alt_baro: 60_000 })).toBe(fl400.color)
  })

  it('gives an aircraft with no altitude the neutral, not a ramp colour', () => {
    // `toGeoJSON` omits the key entirely, which is why this is a `has` test.
    const neutral = colorFor({ hex: 'abc123' })

    expect(neutral).toBe(AIRCRAFT_PALETTE.noAltitude.color)
    expect(AIRCRAFT_PALETTE.altitudeStops.map((s) => s.color)).not.toContain(
      neutral,
    )
  })
})

describe('stale fading', () => {
  it('dims a stale contact and leaves a live one at full strength', () => {
    expect(
      evaluate(aircraftPaint['icon-opacity'], { properties: { stale: true } }),
    ).toBe(AIRCRAFT_PALETTE.staleOpacity)
    expect(
      evaluate(aircraftPaint['icon-opacity'], { properties: { stale: false } }),
    ).toBe(AIRCRAFT_PALETTE.liveOpacity)
  })

  it('fades the label with its aircraft', () => {
    expect(aircraftPaint['text-opacity']).toEqual(aircraftPaint['icon-opacity'])
  })

  it('is actually a visible difference', () => {
    expect(AIRCRAFT_PALETTE.staleOpacity).toBeLessThan(
      AIRCRAFT_PALETTE.liveOpacity - 0.25,
    )
  })
})

describe('icon sizing', () => {
  it('grows with zoom', () => {
    const at = (zoom: number) =>
      evaluate(aircraftLayout['icon-size'], { zoom }) as number

    expect(at(4)).toBeLessThan(at(7))
    expect(at(7)).toBeLessThan(at(11))
    expect(at(11)).toBeLessThan(at(14))
  })

  it('keeps the 64 px source icon well under full size at low zoom', () => {
    // Feature 7 shipped a fixed size 1, which was a blot across a province.
    expect(evaluate(aircraftLayout['icon-size'], { zoom: 7 })).toBeLessThan(0.5)
  })

  it('clamps rather than shrinking to nothing or exploding', () => {
    expect(evaluate(aircraftLayout['icon-size'], { zoom: 0 })).toBeGreaterThan(
      0,
    )
    expect(evaluate(aircraftLayout['icon-size'], { zoom: 22 })).toBeLessThan(1)
  })
})

describe('callsign labels', () => {
  const labelAt = (zoom: number, properties: Record<string, unknown>) =>
    evaluate(aircraftLayout['text-field'], { zoom, properties })

  it('shows nothing below the zoom threshold', () => {
    expect(labelAt(LABEL_MIN_ZOOM - 1, { flight: 'KLM123' })).toBe('')
  })

  it('shows the callsign at and above the threshold', () => {
    expect(labelAt(LABEL_MIN_ZOOM, { flight: 'KLM123' })).toBe('KLM123')
    expect(labelAt(LABEL_MIN_ZOOM + 3, { flight: 'KLM123' })).toBe('KLM123')
  })

  it('falls back to no label when the aircraft sent no callsign', () => {
    expect(labelAt(LABEL_MIN_ZOOM + 3, { hex: 'abc123' })).toBe('')
  })

  it('lets a label be dropped without taking its icon with it', () => {
    // Without text-optional a colliding label suppresses the whole symbol.
    expect(aircraftLayout['text-optional']).toBe(true)
    expect(aircraftLayout['icon-allow-overlap']).toBe(true)
  })

  it('uses a font stack the basemap style already loads', () => {
    expect(aircraftLayout['text-font']).toContain('Open Sans Bold')
  })

  it('offsets the label clear of the icon', () => {
    const [, vertical] = aircraftLayout['text-offset'] as [number, number]
    expect(vertical).toBeGreaterThan(0)
    expect(aircraftLayout['text-anchor']).toBe('top')
  })

  it('halos the text so it survives a light patch of map', () => {
    expect(aircraftPaint['text-halo-width']).toBeGreaterThan(0)
    expect(aircraftPaint['text-halo-color']).toBe(
      AIRCRAFT_PALETTE.label.haloColor,
    )
  })
})

describe('aircraftLayout', () => {
  it('draws the registered icon', () => {
    expect(aircraftLayout['icon-image']).toBe(AIRCRAFT_ICON_ID)
  })

  it('rotates from track, falling back to 0 when the key is absent', () => {
    expect(evaluate(aircraftLayout['icon-rotate'], { properties: {} })).toBe(0)
    expect(
      evaluate(aircraftLayout['icon-rotate'], { properties: { track: 125.5 } }),
    ).toBe(125.5)
  })

  it('aligns rotation to the map, so a heading points at real-world east', () => {
    expect(aircraftLayout['icon-rotation-alignment']).toBe('map')
  })

  it('never hides an aircraft to collision', () => {
    expect(aircraftLayout['icon-allow-overlap']).toBe(true)
    expect(aircraftLayout['icon-ignore-placement']).toBe(true)
  })
})

describe('AIRCRAFT_PALETTE', () => {
  it('lists altitude stops in ascending order', () => {
    const feet = AIRCRAFT_PALETTE.altitudeStops.map((stop) => stop.feet)
    expect(feet).toEqual([...feet].sort((a, b) => a - b))
  })

  it('labels every stop, so the encoding is never colour alone', () => {
    for (const stop of AIRCRAFT_PALETTE.altitudeStops) {
      expect(stop.label.trim().length).toBeGreaterThan(0)
    }
    expect(AIRCRAFT_PALETTE.noAltitude.label.trim().length).toBeGreaterThan(0)
  })

  it('uses one hue for the ramp, with the neutral clearly outside it', () => {
    // A magnitude ramp is one hue stepped by lightness; the neutral is grey so
    // "no altitude" cannot read as an altitude.
    const { color } = AIRCRAFT_PALETTE.noAltitude
    const [r, g, b] = [1, 3, 5].map((i) =>
      Number.parseInt(color.slice(i, i + 2), 16),
    )
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(20)
  })
})

describe('emptyFeatureCollection', () => {
  it('is an empty GeoJSON FeatureCollection', () => {
    expect(emptyFeatureCollection()).toEqual({
      type: 'FeatureCollection',
      features: [],
    })
  })

  it('returns a fresh object each call, so nothing can share and mutate it', () => {
    expect(emptyFeatureCollection()).not.toBe(emptyFeatureCollection())
  })
})

describe('ids', () => {
  it('keeps the source and layer ids distinct', () => {
    expect(AIRCRAFT_SOURCE_ID).not.toBe(AIRCRAFT_LAYER_ID)
  })
})
