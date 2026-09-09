import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MAP_STYLE_URL,
  DEFAULT_ZOOM,
  parseConfig,
  type RawEnv,
} from './config'

const TOKEN = 'super-secret-token-value'

function env(overrides: RawEnv = {}): RawEnv {
  return {
    VITE_SKYSPY_HTTP: 'http://localhost:8000',
    VITE_SKYSPY_WS: 'ws://localhost:8000',
    ...overrides,
  }
}

describe('parseConfig', () => {
  it('parses a fully valid environment', () => {
    const result = parseConfig(
      env({
        VITE_SKYSPY_HTTP: 'https://skyspy.example.com/',
        VITE_SKYSPY_WS: 'wss://skyspy.example.com///',
        VITE_SKYSPY_TOKEN: TOKEN,
        VITE_MAP_STYLE_URL: 'https://tiles.example.com/style.json',
        VITE_DEFAULT_CENTER: '52.3676,4.9041',
        VITE_DEFAULT_ZOOM: '9.5',
      }),
    )

    expect(result).toEqual({
      skySpyHttp: 'https://skyspy.example.com',
      skySpyWs: 'wss://skyspy.example.com',
      skySpyToken: TOKEN,
      mapStyleUrl: 'https://tiles.example.com/style.json',
      defaultCenter: { lat: 52.3676, lon: 4.9041 },
      defaultZoom: 9.5,
    })
  })

  it('applies defaults when the optional variables are absent', () => {
    const result = parseConfig(env())

    expect(result.skySpyToken).toBeUndefined()
    expect(result.mapStyleUrl).toBe(DEFAULT_MAP_STYLE_URL)
    expect(result.defaultCenter).toEqual({ lat: 0, lon: 0 })
    expect(result.defaultZoom).toBe(DEFAULT_ZOOM)
  })

  describe('required variables', () => {
    it.each(['VITE_SKYSPY_HTTP', 'VITE_SKYSPY_WS'])(
      'throws naming %s when it is missing',
      (key) => {
        expect(() => parseConfig(env({ [key]: undefined }))).toThrow(key)
      },
    )

    it.each(['VITE_SKYSPY_HTTP', 'VITE_SKYSPY_WS'])(
      'throws naming %s when it is blank',
      (key) => {
        expect(() => parseConfig(env({ [key]: '   ' }))).toThrow(key)
      },
    )

    it('rejects a relative SkySpy HTTP URL', () => {
      expect(() => parseConfig(env({ VITE_SKYSPY_HTTP: '/api' }))).toThrow(
        'VITE_SKYSPY_HTTP',
      )
    })

    it('rejects the wrong scheme on each SkySpy URL', () => {
      expect(() =>
        parseConfig(env({ VITE_SKYSPY_HTTP: 'ws://localhost:8000' })),
      ).toThrow('VITE_SKYSPY_HTTP')
      expect(() =>
        parseConfig(env({ VITE_SKYSPY_WS: 'http://localhost:8000' })),
      ).toThrow('VITE_SKYSPY_WS')
    })
  })

  describe('VITE_MAP_STYLE_URL', () => {
    it('rejects a non https style URL', () => {
      expect(() =>
        parseConfig(
          env({ VITE_MAP_STYLE_URL: 'http://tiles.example.com/s.json' }),
        ),
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
      expect(() => parseConfig(env({ VITE_DEFAULT_CENTER: value }))).toThrow(
        'VITE_DEFAULT_CENTER',
      )
    })

    it('accepts the range boundaries', () => {
      expect(
        parseConfig(env({ VITE_DEFAULT_CENTER: '-90,-180' })).defaultCenter,
      ).toEqual({ lat: -90, lon: -180 })
      expect(
        parseConfig(env({ VITE_DEFAULT_CENTER: '90,180' })).defaultCenter,
      ).toEqual({ lat: 90, lon: 180 })
    })
  })

  describe('VITE_DEFAULT_ZOOM', () => {
    it.each([
      ['below range', '-1'],
      ['above range', '23'],
      ['not a number', 'close'],
    ])('throws naming the variable for a zoom %s', (_case, value) => {
      expect(() => parseConfig(env({ VITE_DEFAULT_ZOOM: value }))).toThrow(
        'VITE_DEFAULT_ZOOM',
      )
    })

    it('accepts the range boundaries', () => {
      expect(parseConfig(env({ VITE_DEFAULT_ZOOM: '0' })).defaultZoom).toBe(0)
      expect(parseConfig(env({ VITE_DEFAULT_ZOOM: '22' })).defaultZoom).toBe(22)
    })
  })

  describe('VITE_SKYSPY_TOKEN', () => {
    it.each([
      ['absent', undefined],
      ['empty', ''],
      ['whitespace only', '   '],
    ])('resolves to undefined when %s', (_case, value) => {
      expect(
        parseConfig(env({ VITE_SKYSPY_TOKEN: value })).skySpyToken,
      ).toBeUndefined()
    })

    it('never leaks the token value in an error message', () => {
      // Every failure path runs with a valid token present. None may echo it.
      const failures: RawEnv[] = [
        { VITE_SKYSPY_HTTP: undefined },
        { VITE_SKYSPY_WS: undefined },
        { VITE_SKYSPY_HTTP: 'not-a-url' },
        { VITE_SKYSPY_WS: 'not-a-url' },
        { VITE_MAP_STYLE_URL: 'http://tiles.example.com/s.json' },
        { VITE_DEFAULT_CENTER: 'nope' },
        { VITE_DEFAULT_ZOOM: '99' },
      ]

      for (const overrides of failures) {
        let message = ''
        try {
          parseConfig(env({ VITE_SKYSPY_TOKEN: TOKEN, ...overrides }))
        } catch (error) {
          message = error instanceof Error ? error.message : String(error)
        }

        expect(message).not.toBe('')
        expect(message).not.toContain(TOKEN)
      }
    })
  })
})
