import { describe, expect, it } from 'vitest'
import { createTokenProvider, type FetchLike } from './openskyToken.ts'

const AUTH_URL = 'https://auth.example.com/token'
const CLIENT_ID = 'flightscanner-api-client'
const SECRET = 'super-secret-client-secret-value'
const CREDENTIALS = { clientId: CLIENT_ID, clientSecret: SECRET }

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function tokenResponse(value: string, expiresIn = 1800): Response {
  return jsonResponse({ access_token: value, expires_in: expiresIn })
}

function fakeFetch(responses: Array<Response | Error>) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const queue = [...responses]

  const fetchImpl: FetchLike = (url, init) => {
    calls.push({ url, init })
    const next = queue.shift()
    if (next === undefined) throw new Error(`unexpected fetch call to ${url}`)
    if (next instanceof Error) return Promise.reject(next)
    return Promise.resolve(next)
  }

  return { fetchImpl, calls }
}

describe('createTokenProvider', () => {
  it('returns undefined and makes no request without credentials', async () => {
    const { fetchImpl, calls } = fakeFetch([])
    const provider = createTokenProvider({
      authUrl: AUTH_URL,
      fetch: fetchImpl,
    })

    expect(await provider.getToken()).toBeUndefined()
    expect(calls).toHaveLength(0)
  })

  it('posts form-encoded client credentials to the auth URL', async () => {
    const { fetchImpl, calls } = fakeFetch([tokenResponse('token-one')])
    const provider = createTokenProvider({
      authUrl: AUTH_URL,
      credentials: CREDENTIALS,
      fetch: fetchImpl,
      now: () => 0,
    })

    expect(await provider.getToken()).toBe('token-one')
    expect(calls[0].url).toBe(AUTH_URL)
    expect(calls[0].init?.method).toBe('POST')
    expect(calls[0].init?.headers).toEqual({
      'Content-Type': 'application/x-www-form-urlencoded',
    })
    // The body is always the string built by URLSearchParams.toString().
    const body = calls[0].init?.body
    expect(typeof body).toBe('string')
    expect(body).toContain('grant_type=client_credentials')
    expect(body).toContain(`client_id=${CLIENT_ID}`)
  })

  it('caches the token across calls', async () => {
    const { fetchImpl, calls } = fakeFetch([tokenResponse('token-one')])
    const provider = createTokenProvider({
      authUrl: AUTH_URL,
      credentials: CREDENTIALS,
      fetch: fetchImpl,
      now: () => 1_000_000,
    })

    expect(await provider.getToken()).toBe('token-one')
    expect(await provider.getToken()).toBe('token-one')
    expect(calls).toHaveLength(1)
  })

  it('refreshes early, inside the lifetime but within the margin', async () => {
    const { fetchImpl, calls } = fakeFetch([
      tokenResponse('token-one', 1800),
      tokenResponse('token-two', 1800),
    ])
    let clock = 0
    const provider = createTokenProvider({
      authUrl: AUTH_URL,
      credentials: CREDENTIALS,
      fetch: fetchImpl,
      now: () => clock,
    })

    expect(await provider.getToken()).toBe('token-one')

    // 1 740 000 ms in: still inside the 1800 s lifetime, but past the 60 s margin.
    clock = 1_750_000
    expect(await provider.getToken()).toBe('token-two')
    expect(calls).toHaveLength(2)
  })

  it('keeps the token while it is still outside the refresh margin', async () => {
    const { fetchImpl, calls } = fakeFetch([tokenResponse('token-one', 1800)])
    let clock = 0
    const provider = createTokenProvider({
      authUrl: AUTH_URL,
      credentials: CREDENTIALS,
      fetch: fetchImpl,
      now: () => clock,
    })

    await provider.getToken()
    clock = 1_700_000
    expect(await provider.getToken()).toBe('token-one')
    expect(calls).toHaveLength(1)
  })

  it('does not spend two exchanges on concurrent callers', async () => {
    const { fetchImpl, calls } = fakeFetch([tokenResponse('token-one')])
    const provider = createTokenProvider({
      authUrl: AUTH_URL,
      credentials: CREDENTIALS,
      fetch: fetchImpl,
      now: () => 0,
    })

    const [first, second] = await Promise.all([
      provider.getToken(),
      provider.getToken(),
    ])

    expect(first).toBe('token-one')
    expect(second).toBe('token-one')
    expect(calls).toHaveLength(1)
  })

  it('re-requests after invalidate', async () => {
    const { fetchImpl, calls } = fakeFetch([
      tokenResponse('stale-token'),
      tokenResponse('fresh-token'),
    ])
    const provider = createTokenProvider({
      authUrl: AUTH_URL,
      credentials: CREDENTIALS,
      fetch: fetchImpl,
      now: () => 0,
    })

    expect(await provider.getToken()).toBe('stale-token')
    provider.invalidate()
    expect(await provider.getToken()).toBe('fresh-token')
    expect(calls).toHaveLength(2)
  })

  it('recovers after a failed exchange rather than caching the failure', async () => {
    const { fetchImpl } = fakeFetch([
      jsonResponse({ error: 'invalid_client' }, 401),
      tokenResponse('token-one'),
    ])
    const provider = createTokenProvider({
      authUrl: AUTH_URL,
      credentials: CREDENTIALS,
      fetch: fetchImpl,
      now: () => 0,
    })

    await expect(provider.getToken()).rejects.toThrow()
    expect(await provider.getToken()).toBe('token-one')
  })

  it.each([
    ['a rejected exchange', jsonResponse({ error: 'invalid_client' }, 401)],
    ['a non object body', jsonResponse('nope')],
    ['a body with no access_token', jsonResponse({ expires_in: 1800 })],
    ['a blank access_token', jsonResponse({ access_token: '   ' })],
  ])('throws on %s', async (_case, response) => {
    const { fetchImpl } = fakeFetch([response])
    const provider = createTokenProvider({
      authUrl: AUTH_URL,
      credentials: CREDENTIALS,
      fetch: fetchImpl,
    })

    await expect(provider.getToken()).rejects.toThrow()
  })

  it('never names the credentials in a thrown error', async () => {
    const failures: Array<Response | Error> = [
      jsonResponse({ error: 'invalid_client', client_secret: SECRET }, 401),
      jsonResponse({ expires_in: 1800 }),
      new TypeError('Failed to fetch'),
    ]

    for (const failure of failures) {
      const { fetchImpl } = fakeFetch([failure])
      const provider = createTokenProvider({
        authUrl: AUTH_URL,
        credentials: CREDENTIALS,
        fetch: fetchImpl,
      })

      let thrown = ''
      try {
        await provider.getToken()
      } catch (error) {
        thrown = error instanceof Error ? error.message : String(error)
      }

      expect(thrown).not.toBe('')
      expect(thrown).not.toContain(SECRET)
      expect(thrown).not.toContain(CLIENT_ID)
    }
  })
})
