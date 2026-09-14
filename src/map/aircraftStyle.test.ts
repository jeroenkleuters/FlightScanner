import { describe, expect, it } from 'vitest'
import { AIRCRAFT_ICON_ID } from './aircraftIcon'
import {
  AIRCRAFT_LAYER_ID,
  AIRCRAFT_PALETTE,
  AIRCRAFT_SOURCE_ID,
  LABEL_MIN_ZOOM,
  aircraftLayout,
  aircraftOpacity,
  aircraftPaint,
  aircraftPaintFor,
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

describe('selection styling', () => {
  const selected = { selected: true }

  const colorWith = (
    properties: Record<string, unknown>,
    featureState?: Record<string, unknown>,
  ) => evaluate(aircraftPaint['icon-color'], { properties, featureState })

  it('overrides the altitude ramp for the selected aircraft only', () => {
    expect(colorWith({ alt_baro: 31_000 }, selected)).toBe(
      AIRCRAFT_PALETTE.selected.color,
    )
    // Everyone else keeps their altitude colour.
    expect(colorWith({ alt_baro: 25_000 })).toBe(fl250.color)
  })

  it('overrides the neutral for a selected aircraft with no altitude', () => {
    expect(colorWith({ hex: 'abc123' }, selected)).toBe(
      AIRCRAFT_PALETTE.selected.color,
    )
  })

  it('does not try to size the selected icon from feature state', () => {
    // MapLibre rejects feature-state in any layout property, and a rejected
    // layout expression takes the whole layer down. Selection reads through
    // colour and opacity instead, which are paint.
    expect(JSON.stringify(aircraftLayout['icon-size'])).not.toContain(
      'feature-state',
    )
    expect(JSON.stringify(aircraftLayout)).not.toContain('feature-state')
  })

  describe('opacity across selection and staleness together', () => {
    // The four combinations that must all stay distinguishable: selecting one
    // aircraft must not promote a stale contact back to looking live, and must
    // not hide the rest of the fleet either.
    const opacityOf = (
      hasSelection: boolean,
      properties: Record<string, unknown>,
      featureState?: Record<string, unknown>,
    ) =>
      evaluate(aircraftOpacity(hasSelection), {
        properties,
        featureState,
      }) as number

    it('leaves the fleet untouched while nothing is selected', () => {
      expect(opacityOf(false, { stale: false })).toBe(
        AIRCRAFT_PALETTE.liveOpacity,
      )
      expect(opacityOf(false, { stale: true })).toBe(
        AIRCRAFT_PALETTE.staleOpacity,
      )
    })

    it('gives the selected aircraft full opacity even when it is stale', () => {
      expect(opacityOf(true, { stale: true }, selected)).toBe(
        AIRCRAFT_PALETTE.liveOpacity,
      )
    })

    it('dims the rest, and dims a stale one further still', () => {
      const live = opacityOf(true, { stale: false })
      const stale = opacityOf(true, { stale: true })

      expect(live).toBe(AIRCRAFT_PALETTE.dimmedOpacity)
      expect(stale).toBe(AIRCRAFT_PALETTE.dimmedStaleOpacity)
      // The stale fade survives selection rather than being flattened away.
      expect(stale).toBeLessThan(live)
    })

    it('dims rather than hides, so the fleet stays readable', () => {
      expect(opacityOf(true, { stale: true })).toBeGreaterThan(0.1)
    })
  })

  it('carries the same opacity rule to the labels', () => {
    for (const hasSelection of [false, true]) {
      const paint = aircraftPaintFor(hasSelection)
      expect(paint['text-opacity']).toEqual(paint['icon-opacity'])
    }
  })

  it('keeps the no-selection constant equal to the no-selection function', () => {
    expect(aircraftPaint).toEqual(aircraftPaintFor(false))
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

describe('expression grammar MapLibre enforces at runtime', () => {
  // These are not style preferences. MapLibre rejects a layout property that
  // breaks them, and a rejected layout expression takes the whole layer down -
  // which surfaces as an error before load, so FlightMap replaces the map with
  // its failure state. Evaluating an expression by hand cannot catch this; only
  // its shape can.
  it('keeps zoom as the direct input of a top-level interpolate in icon-size', () => {
    const size = aircraftLayout['icon-size'] as unknown[]

    expect(size[0]).toBe('interpolate')
    expect(size[2]).toEqual(['zoom'])
  })

  it('keeps zoom as the direct input of a top-level interpolate in text-size', () => {
    const size = aircraftLayout['text-size'] as unknown[]

    expect(size[0]).toBe('interpolate')
    expect(size[2]).toEqual(['zoom'])
  })

  it('keeps zoom out of the paint expressions entirely', () => {
    // Same rule, and paint has no legitimate need for zoom here.
    for (const value of Object.values(aircraftPaintFor(true))) {
      expect(JSON.stringify(value)).not.toContain('"zoom"')
    }
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
