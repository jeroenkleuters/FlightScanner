import { describe, expect, it } from 'vitest'
import type { Aircraft } from '../types/aircraft'
import { createAircraftStore } from './aircraftStore'
import { toGeoJSON } from './aircraftGeoJSON'

function aircraft(hex: string, overrides: Partial<Aircraft> = {}): Aircraft {
  return { hex, lastSeen: 0, stale: false, ...overrides }
}

describe('toGeoJSON', () => {
  it('projects a positioned aircraft as lon, lat in that order', () => {
    const { features } = toGeoJSON([
      aircraft('abc123', { lat: 52.3676, lon: 4.9041 }),
    ])

    expect(features).toHaveLength(1)
    expect(features[0].geometry).toEqual({
      type: 'Point',
      coordinates: [4.9041, 52.3676],
    })
  })

  it('carries the six properties the layer reads', () => {
    const { features } = toGeoJSON([
      aircraft('abc123', {
        lat: 52,
        lon: 4,
        flight: 'KLM1',
        alt_baro: 30000,
        gs: 450,
        track: 270,
        stale: true,
      }),
    ])

    expect(features[0].properties).toEqual({
      hex: 'abc123',
      flight: 'KLM1',
      alt_baro: 30000,
      gs: 450,
      track: 270,
      stale: true,
    })
  })

  it('omits absent optionals rather than emitting undefined', () => {
    const { features } = toGeoJSON([aircraft('abc123', { lat: 52, lon: 4 })])
    const properties = features[0].properties

    expect(properties).toEqual({ hex: 'abc123', stale: false })
    expect(Object.keys(properties)).not.toContain('flight')
    expect(Object.keys(properties)).not.toContain('track')
    // What matters in the end is what survives the wire to MapLibre.
    expect(JSON.parse(JSON.stringify(properties))).toEqual({
      hex: 'abc123',
      stale: false,
    })
  })

  it('keeps a zero heading rather than dropping it as falsy', () => {
    const { features } = toGeoJSON([
      aircraft('abc123', { lat: 52, lon: 4, track: 0 }),
    ])

    expect(features[0].properties.track).toBe(0)
  })

  it('omits a positionless aircraft while the store still holds it', () => {
    const store = createAircraftStore()
    store.applySnapshot({
      time: 1_700_000_000,
      aircraft: [
        aircraft('abc123', { lat: 52, lon: 4 }),
        aircraft('nofix99'),
        aircraft('halffix', { lat: 52 }),
      ],
    })

    const { features } = toGeoJSON(store.values())

    expect(store.size).toBe(3)
    expect(features.map((feature) => feature.properties.hex)).toEqual([
      'abc123',
    ])
  })

  it('returns a valid empty collection for an empty fleet', () => {
    expect(toGeoJSON([])).toEqual({ type: 'FeatureCollection', features: [] })
  })

  it('reads straight from the store', () => {
    const store = createAircraftStore()
    store.applySnapshot({
      time: 1_700_000_000,
      aircraft: [
        aircraft('abc123', { lat: 52, lon: 4 }),
        aircraft('def456', { lat: 53, lon: 5 }),
      ],
    })

    expect(toGeoJSON(store.values()).features).toHaveLength(2)
  })
})
