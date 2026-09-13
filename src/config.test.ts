import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BOUNDING_BOX,
  DEFAULT_MAP_STYLE_URL,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_ZOOM,
  MIN_POLL_INTERVAL_MS,
  parseConfig,
  type RawEnv,
} from './config'

describe('parseConfig', () => {
  it('parses a fully valid environment', () => {
    const result = parseConfig({
      VITE_OPENSKY_POLL_MS: '60000',
      VITE_OPENSKY_BBOX: '51,4,52,5',
      VITE_MAP_STYLE_URL: 'https://tiles.example.com/style.json',
      VITE_DEFAULT_CENTER: '52.3676,4.9041',
      VITE_DEFAULT_ZOOM: '9.5',
    })

    expect(result).toEqual({
      pollIntervalMs: 60000,
      boundingBox: { lamin: 51, lomin: 4, lamax: 52, lomax: 5 },
      mapStyleUrl: 'https://tiles.example.com/style.json',
      defaultCenter: { lat: 52.3676, lon: 4.9041 },
      defaultZoom: 9.5,
    })
  })

  it('needs no variables at all', () => {
    const result = parseConfig({})

    expect(result).toEqual({
      pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
      boundingBox: DEFAULT_BOUNDING_BOX,
      mapStyleUrl: DEFAULT_MAP_STYLE_URL,
      defaultCenter: { lat: 0, lon: 0 },
      defaultZoom: DEFAULT_ZOOM,
    })
  })

  describe('VITE_OPENSKY_POLL_MS', () => {
    it('accepts the minimum', () => {
      expect(
        parseConfig({ VITE_OPENSKY_POLL_MS: String(MIN_POLL_INTERVAL_MS) })
          .pollIntervalMs,
      ).toBe(MIN_POLL_INTERVAL_MS)
    })

    it.each([
      ['below the credit budget floor', '15000'],
      ['zero', '0'],
      ['negative', '-1'],
      ['not a number', 'often'],
    ])('throws naming the variable for an interval %s', (_case, value) => {
      expect(() => parseConfig({ VITE_OPENSKY_POLL_MS: value })).toThrow(
        'VITE_OPENSKY_POLL_MS',
      )
    })
  })

  describe('VITE_OPENSKY_BBOX', () => {
    it('defaults to the Netherlands box the fixture was captured over', () => {
      expect(parseConfig({}).boundingBox).toEqual({
        lamin: 50.5,
        lomin: 3.0,
        lamax: 53.8,
        lomax: 7.3,
      })
    })

    it('returns a copy, so a caller cannot mutate the default', () => {
      const box = parseConfig({}).boundingBox
      box.lamin = 0

      expect(DEFAULT_BOUNDING_BOX.lamin).toBe(50.5)
    })

    it('accepts the range boundaries', () => {
      expect(
        parseConfig({ VITE_OPENSKY_BBOX: '-90,-180,90,180' }).boundingBox,
      ).toEqual({ lamin: -90, lomin: -180, lamax: 90, lomax: 180 })
    })

    it('accepts a degenerate box with equal edges', () => {
      expect(parseConfig({ VITE_OPENSKY_BBOX: '52,4,52,4' }).boundingBox).toEqual(
        { lamin: 52, lomin: 4, lamax: 52, lomax: 4 },
      )
    })

    it.each([
      ['three parts', '50.5,3.0,53.8'],
      ['five parts', '50.5,3.0,53.8,7.3,1'],
      ['a non numeric corner', '50.5,3.0,north,7.3'],
      ['an empty corner', '50.5,,53.8,7.3'],
      ['a latitude out of range', '50.5,3.0,91,7.3'],
      ['a longitude out of range', '50.5,-181,53.8,7.3'],
      ['a southern edge north of the northern edge', '53.8,3.0,50.5,7.3'],
      ['a western edge east of the eastern edge', '50.5,7.3,53.8,3.0'],
    ])('throws naming the variable for %s', (_case, value) => {
      expect(() => parseConfig({ VITE_OPENSKY_BBOX: value })).toThrow(
        'VITE_OPENSKY_BBOX',
      )
    })
  })

  describe('VITE_MAP_STYLE_URL', () => {
    it('rejects a non https style URL', () => {
      expect(() =>
        parseConfig({ VITE_MAP_STYLE_URL: 'http://tiles.example.com/s.json' }),
      ).toThrow('VITE_MAP_STYLE_URL')
    })
  })

  describe('VITE_DEFAULT_CENTER', () => {
    it.each([
      ['not two parts', '52.3676'],
      ['three parts', '1,2,3'],
      ['non numeric latitude', 'north,4.9'],
      ['non numeric longitude', '52.3,east'],
      ['empty longitude', '52.3,'],
      ['latitude out of range', '91,0'],
      ['longitude out of range', '0,181'],
    ])('throws naming the variable for %s', (_case, value) => {
      expect(() => parseConfig({ VITE_DEFAULT_CENTER: value })).toThrow(
        'VITE_DEFAULT_CENTER',
      )
    })

    it('accepts the range boundaries', () => {
      expect(
        parseConfig({ VITE_DEFAULT_CENTER: '-90,-180' }).defaultCenter,
      ).toEqual({ lat: -90, lon: -180 })
      expect(
        parseConfig({ VITE_DEFAULT_CENTER: '90,180' }).defaultCenter,
      ).toEqual({ lat: 90, lon: 180 })
    })
  })

  describe('VITE_DEFAULT_ZOOM', () => {
    it.each([
      ['below range', '-1'],
      ['above range', '23'],
      ['not a number', 'close'],
    ])('throws naming the variable for a zoom %s', (_case, value) => {
      expect(() => parseConfig({ VITE_DEFAULT_ZOOM: value })).toThrow(
        'VITE_DEFAULT_ZOOM',
      )
    })

    it('accepts the range boundaries', () => {
      expect(parseConfig({ VITE_DEFAULT_ZOOM: '0' }).defaultZoom).toBe(0)
      expect(parseConfig({ VITE_DEFAULT_ZOOM: '22' }).defaultZoom).toBe(22)
    })
  })

  it('names the offending variable without echoing its value', () => {
    const failures: RawEnv[] = [
      { VITE_OPENSKY_POLL_MS: '1000' },
      { VITE_OPENSKY_BBOX: '91,3.0,53.8,7.3' },
      { VITE_MAP_STYLE_URL: 'http://tiles.example.com/s.json' },
      { VITE_DEFAULT_CENTER: 'nope' },
      { VITE_DEFAULT_ZOOM: '99' },
    ]

    for (const overrides of failures) {
      const key = Object.keys(overrides)[0]
      let message = ''
      try {
        parseConfig(overrides)
      } catch (error) {
        message = error instanceof Error ? error.message : String(error)
      }

      expect(message).toContain(key)
      expect(message).not.toContain(String(overrides[key]))
    }
  })
})
