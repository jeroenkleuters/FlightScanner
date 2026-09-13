import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MAP_STYLE_URL,
  DEFAULT_OPENSKY_API_BASE,
  DEFAULT_OPENSKY_AUTH_URL,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_ZOOM,
  MIN_POLL_INTERVAL_MS,
  parseConfig,
  type RawEnv,
} from './config'

const CLIENT_ID = 'flightscanner-api-client'
const SECRET = 'super-secret-client-secret-value'

describe('parseConfig', () => {
  it('parses a fully valid environment', () => {
    const result = parseConfig({
      VITE_OPENSKY_API_BASE: 'https://opensky.example.com/api/',
      VITE_OPENSKY_AUTH_URL: 'https://auth.example.com/token///',
      VITE_OPENSKY_CLIENT_ID: CLIENT_ID,
      VITE_OPENSKY_CLIENT_SECRET: SECRET,
      VITE_OPENSKY_POLL_MS: '60000',
      VITE_MAP_STYLE_URL: 'https://tiles.example.com/style.json',
      VITE_DEFAULT_CENTER: '52.3676,4.9041',
      VITE_DEFAULT_ZOOM: '9.5',
    })

    expect(result).toEqual({
      openSkyApiBase: 'https://opensky.example.com/api',
      openSkyAuthUrl: 'https://auth.example.com/token',
      openSkyClientId: CLIENT_ID,
      openSkyClientSecret: SECRET,
      pollIntervalMs: 60000,
      mapStyleUrl: 'https://tiles.example.com/style.json',
      defaultCenter: { lat: 52.3676, lon: 4.9041 },
      defaultZoom: 9.5,
    })
  })

  it('needs no variables at all, defaulting to anonymous OpenSky access', () => {
    const result = parseConfig({})

    expect(result).toEqual({
      openSkyApiBase: DEFAULT_OPENSKY_API_BASE,
      openSkyAuthUrl: DEFAULT_OPENSKY_AUTH_URL,
      openSkyClientId: undefined,
      openSkyClientSecret: undefined,
      pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
      mapStyleUrl: DEFAULT_MAP_STYLE_URL,
      defaultCenter: { lat: 0, lon: 0 },
      defaultZoom: DEFAULT_ZOOM,
    })
  })

  describe('OpenSky URLs', () => {
    it.each(['VITE_OPENSKY_API_BASE', 'VITE_OPENSKY_AUTH_URL'])(
      'falls back to the default when %s is blank',
      (key) => {
        expect(() => parseConfig({ [key]: '   ' })).not.toThrow()
      },
    )

    it.each(['VITE_OPENSKY_API_BASE', 'VITE_OPENSKY_AUTH_URL'])(
      'rejects a relative %s',
      (key) => {
        expect(() => parseConfig({ [key]: '/api' })).toThrow(key)
      },
    )

    it.each(['VITE_OPENSKY_API_BASE', 'VITE_OPENSKY_AUTH_URL'])(
      'rejects a non http scheme on %s',
      (key) => {
        expect(() => parseConfig({ [key]: 'ws://opensky.example.com' })).toThrow(
          key,
        )
      },
    )
  })

  describe('OpenSky credentials', () => {
    it('resolves both to undefined when neither is set', () => {
      const result = parseConfig({})
      expect(result.openSkyClientId).toBeUndefined()
      expect(result.openSkyClientSecret).toBeUndefined()
    })

    it('rejects a client ID without a secret', () => {
      expect(() =>
        parseConfig({ VITE_OPENSKY_CLIENT_ID: CLIENT_ID }),
      ).toThrow('VITE_OPENSKY_CLIENT_SECRET')
    })

    it('rejects a secret without a client ID', () => {
      expect(() =>
        parseConfig({ VITE_OPENSKY_CLIENT_SECRET: SECRET }),
      ).toThrow('VITE_OPENSKY_CLIENT_ID')
    })

    it('treats a whitespace only secret as absent', () => {
      expect(() =>
        parseConfig({
          VITE_OPENSKY_CLIENT_ID: CLIENT_ID,
          VITE_OPENSKY_CLIENT_SECRET: '   ',
        }),
      ).toThrow('VITE_OPENSKY_CLIENT_SECRET')
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

  it('never leaks the client secret in an error message', () => {
    // Every failure path runs with valid credentials present. None may echo them.
    const failures: RawEnv[] = [
      { VITE_OPENSKY_API_BASE: 'not-a-url' },
      { VITE_OPENSKY_AUTH_URL: 'not-a-url' },
      { VITE_OPENSKY_POLL_MS: '1000' },
      { VITE_MAP_STYLE_URL: 'http://tiles.example.com/s.json' },
      { VITE_DEFAULT_CENTER: 'nope' },
      { VITE_DEFAULT_ZOOM: '99' },
      { VITE_OPENSKY_CLIENT_SECRET: undefined },
    ]

    for (const overrides of failures) {
      let message = ''
      try {
        parseConfig({
          VITE_OPENSKY_CLIENT_ID: CLIENT_ID,
          VITE_OPENSKY_CLIENT_SECRET: SECRET,
          ...overrides,
        })
      } catch (error) {
        message = error instanceof Error ? error.message : String(error)
      }

      expect(message).not.toBe('')
      expect(message).not.toContain(SECRET)
    }
  })
})
