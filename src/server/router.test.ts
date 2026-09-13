import { describe, expect, it } from 'vitest'
import type { FetchLike } from './openskyToken.ts'
import { createProxyRouter, HEALTH_PATH, STATES_PATH } from './router.ts'

const CLIENT_ID = 'flightscanner-api-client'
const SECRET = 'super-secret-client-secret-value'
const ORIGIN = 'https://app.example.com'
const BOX_QUERY = 'lamin=50.5&lomin=3&lamax=53.8&lomax=7.3'

const neverCalled: FetchLike = (url) => {
  throw new Error(`unexpected fetch call to ${url}`)
}

function get(path: string): Request {
  return new Request(`${ORIGIN}${path}`)
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>
}

describe('createProxyRouter', () => {
  it('falls through for a path the proxy does not own', () => {
    const router = createProxyRouter({}, neverCalled)

    expect(router.handle(get('/'))).toBeUndefined()
    expect(router.handle(get('/api/other'))).toBeUndefined()
    expect(router.handle(get('/api/opensky/states/extra'))).toBeUndefined()
  })

  describe(HEALTH_PATH, () => {
    it('reports anonymous when no credentials are configured', async () => {
      const router = createProxyRouter({}, neverCalled)
      const response = await router.handle(get(HEALTH_PATH))!

      expect(response.status).toBe(200)
      expect(await body(response)).toEqual({
        status: 'ok',
        credentials: 'anonymous',
      })
    })

    it('reports configured when a credential pair is present', async () => {
      const router = createProxyRouter(
        { OPENSKY_CLIENT_ID: CLIENT_ID, OPENSKY_CLIENT_SECRET: SECRET },
        neverCalled,
      )
      const response = await router.handle(get(HEALTH_PATH))!

      expect(await body(response)).toEqual({
        status: 'ok',
        credentials: 'configured',
      })
    })

    it('reveals no secret and no upstream URL', async () => {
      const router = createProxyRouter(
        {
          OPENSKY_CLIENT_ID: CLIENT_ID,
          OPENSKY_CLIENT_SECRET: SECRET,
          OPENSKY_API_BASE: 'https://internal.example.com/api',
        },
        neverCalled,
      )
      const text = await (await router.handle(get(HEALTH_PATH))!).text()

      expect(text).not.toContain(SECRET)
      expect(text).not.toContain(CLIENT_ID)
      expect(text).not.toContain('internal.example.com')
    })

    it('rejects a non GET', async () => {
      const router = createProxyRouter({}, neverCalled)
      const response = await router.handle(
        new Request(`${ORIGIN}${HEALTH_PATH}`, { method: 'POST' }),
      )!

      expect(response.status).toBe(405)
    })
  })

  describe('misconfiguration', () => {
    it.each([
      ['an ID without a secret', { OPENSKY_CLIENT_ID: CLIENT_ID }],
      ['a secret without an ID', { OPENSKY_CLIENT_SECRET: SECRET }],
      ['an unusable API base', { OPENSKY_API_BASE: 'not-a-url' }],
    ])('reports proxy-misconfigured for %s', async (_case, env) => {
      const router = createProxyRouter(env, neverCalled)

      for (const path of [HEALTH_PATH, `${STATES_PATH}?${BOX_QUERY}`]) {
        const response = await router.handle(get(path))!
        expect(response.status).toBe(500)
        expect(await body(response)).toEqual({ error: 'proxy-misconfigured' })
      }
    })

    it('never silently falls back to the anonymous quota', async () => {
      const router = createProxyRouter(
        { OPENSKY_CLIENT_ID: CLIENT_ID },
        neverCalled,
      )
      const response = await router.handle(get(HEALTH_PATH))!

      expect(await body(response)).not.toMatchObject({
        credentials: 'anonymous',
      })
    })
  })

  describe(STATES_PATH, () => {
    it('reaches the states handler and returns a snapshot', async () => {
      const fetchImpl: FetchLike = () =>
        Promise.resolve(
          new Response(JSON.stringify({ time: 1789290616, states: null }), {
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      const router = createProxyRouter({}, fetchImpl)
      const response = await router.handle(get(`${STATES_PATH}?${BOX_QUERY}`))!

      expect(response.status).toBe(200)
      expect(await body(response)).toEqual({ time: 1789290616, states: null })
    })

    it('validates the box before spending a request', async () => {
      const router = createProxyRouter({}, neverCalled)
      const response = await router.handle(get(STATES_PATH))!

      expect(response.status).toBe(400)
      expect(await body(response)).toEqual({ error: 'invalid-request' })
    })

    it('reuses one token across successive requests', async () => {
      const calls: string[] = []
      const fetchImpl: FetchLike = (url) => {
        calls.push(url)
        if (url.includes('/token')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({ access_token: 'token-one', expires_in: 1800 }),
              { headers: { 'Content-Type': 'application/json' } },
            ),
          )
        }
        return Promise.resolve(
          new Response(JSON.stringify({ time: 1, states: [] }), {
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }

      const router = createProxyRouter(
        {
          OPENSKY_CLIENT_ID: CLIENT_ID,
          OPENSKY_CLIENT_SECRET: SECRET,
          OPENSKY_AUTH_URL: 'https://auth.example.com/token',
          OPENSKY_API_BASE: 'https://opensky.example.com/api',
        },
        fetchImpl,
      )

      await router.handle(get(`${STATES_PATH}?${BOX_QUERY}`))!
      await router.handle(get(`${STATES_PATH}?${BOX_QUERY}`))!

      expect(calls.filter((url) => url.includes('/token'))).toHaveLength(1)
      expect(calls).toHaveLength(3)
    })
  })
})
