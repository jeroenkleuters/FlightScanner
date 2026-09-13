import { describe, expect, it } from 'vitest'
import { AIRCRAFT_ICON_ID } from './aircraftIcon'
import {
  AIRCRAFT_LAYER_ID,
  AIRCRAFT_SOURCE_ID,
  aircraftLayout,
  aircraftPaint,
  emptyFeatureCollection,
} from './aircraftStyle'

describe('aircraftLayout', () => {
  it('draws the registered icon', () => {
    expect(aircraftLayout['icon-image']).toBe(AIRCRAFT_ICON_ID)
  })

  it('rotates from track, falling back to 0 when the key is absent', () => {
    // `toGeoJSON` omits the key entirely for a heading-less aircraft, so this
    // has to be a coalesce and not a bare get.
    expect(aircraftLayout['icon-rotate']).toEqual([
      'coalesce',
      ['get', 'track'],
      0,
    ])
  })

  it('aligns rotation to the map, so a heading points at real-world east', () => {
    expect(aircraftLayout['icon-rotation-alignment']).toBe('map')
  })

  it('never hides an aircraft to collision', () => {
    expect(aircraftLayout['icon-allow-overlap']).toBe(true)
    expect(aircraftLayout['icon-ignore-placement']).toBe(true)
  })
})

describe('aircraftPaint', () => {
  it('colours the SDF icon, which would otherwise paint black on a dark map', () => {
    expect(aircraftPaint['icon-color']).toBe('#e6e6e6')
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
