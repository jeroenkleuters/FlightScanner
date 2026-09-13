import { describe, expect, it } from 'vitest'
import {
  DEFAULT_OPENSKY_API_BASE,
  DEFAULT_OPENSKY_AUTH_URL,
  readServerEnv,
} from './env.ts'

const CLIENT_ID = 'flightscanner-api-client'
const SECRET = 'super-secret-client-secret-value'

describe('readServerEnv', () => {
  it('defaults to anonymous OpenSky access with no variables at all', () => {
    expect(readServerEnv({})).toEqual({
      apiBase: DEFAULT_OPENSKY_API_BASE,
      authUrl: DEFAULT_OPENSKY_AUTH_URL,
      credentials: undefined,
    })
  })

  it('reads a complete credential pair', () => {
    expect(
      readServerEnv({
        OPENSKY_CLIENT_ID: CLIENT_ID,
        OPENSKY_CLIENT_SECRET: SECRET,
      }).credentials,
    ).toEqual({ clientId: CLIENT_ID, clientSecret: SECRET })
  })

  it('trims trailing slashes off the API base', () => {
    expect(
      readServerEnv({ OPENSKY_API_BASE: 'https://opensky.example.com/api///' })
        .apiBase,
    ).toBe('https://opensky.example.com/api')
  })

  it('rejects a client ID without a secret', () => {
    expect(() => readServerEnv({ OPENSKY_CLIENT_ID: CLIENT_ID })).toThrow(
      'OPENSKY_CLIENT_SECRET',
    )
  })

  it('rejects a secret without a client ID', () => {
    expect(() => readServerEnv({ OPENSKY_CLIENT_SECRET: SECRET })).toThrow(
      'OPENSKY_CLIENT_ID',
    )
  })

  it('treats a whitespace only secret as absent', () => {
    expect(() =>
      readServerEnv({
        OPENSKY_CLIENT_ID: CLIENT_ID,
        OPENSKY_CLIENT_SECRET: '   ',
      }),
    ).toThrow('OPENSKY_CLIENT_SECRET')
  })

  it.each(['OPENSKY_API_BASE', 'OPENSKY_AUTH_URL'])(
    'falls back to the default when %s is blank',
    (key) => {
      expect(() => readServerEnv({ [key]: '   ' })).not.toThrow()
    },
  )

  it.each(['OPENSKY_API_BASE', 'OPENSKY_AUTH_URL'])(
    'rejects a relative %s',
    (key) => {
      expect(() => readServerEnv({ [key]: '/api' })).toThrow(key)
    },
  )

  it.each(['OPENSKY_API_BASE', 'OPENSKY_AUTH_URL'])(
    'rejects a non http scheme on %s',
    (key) => {
      expect(() =>
        readServerEnv({ [key]: 'ws://opensky.example.com' }),
      ).toThrow(key)
    },
  )

  it('never leaks the credentials in an error message', () => {
    const failures = [
      { OPENSKY_API_BASE: 'not-a-url' },
      { OPENSKY_AUTH_URL: 'not-a-url' },
      { OPENSKY_CLIENT_SECRET: undefined },
    ]

    for (const overrides of failures) {
      let message = ''
      try {
        readServerEnv({
          OPENSKY_CLIENT_ID: CLIENT_ID,
          OPENSKY_CLIENT_SECRET: SECRET,
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
