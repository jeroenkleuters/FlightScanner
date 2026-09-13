import { describe, expect, it, vi } from 'vitest'
import {
  createOpenSkyClient,
  decodeStateVector,
  type BoundingBox,
  type FetchLike,
} from './opensky'

const API_BASE = 'https://opensky.example.com/api'
const AUTH_URL = 'https://auth.example.com/token'
const CREDENTIALS = { clientId: 'client', clientSecret: 'secret' }

const BOX: BoundingBox = { lamin: 50.5, lomin: 3, lamax: 53.8, lomax: 7.3 }

/** A real vector captured from the live API, Hungary registered, airborne. */
const LIVE_VECTOR = [
  '470BC9',
  'FCA1MB  ',
  'Hungary',
  1789290615,
  1789290615,
  3.6431,
  50.7893,
  12496.8,
  false,
  189.33,
  29.28,
  0.33,
  null,
  12938.76,
  '1000',
  false,
  0,
]

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  })
}

function statesResponse(
  states: unknown[] | null,
  headers?: Record<string, string>,
): Response {
  return jsonResponse({ time: 1789290616, states }, { headers })
}

function tokenResponse(value: string, expiresIn = 1800): Response {
  return jsonResponse({ access_token: value, expires_in: expiresIn })
}

/** Returns responses in order, recording every call. */
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

describe('decodeStateVector', () => {
  it('decodes a live vector, converting units and trimming the callsign', () => {
    const aircraft = decodeStateVector(LIVE_VECTOR, 1_700_000_000_000)

    expect(aircraft).not.toBeNull()
    expect(aircraft).toMatchObject({
      hex: '470bc9',
      flight: 'FCA1MB',
      lat: 50.7893,
      lon: 3.6431,
      on_ground: false,
      squawk: '1000',
      track: 29.28,
      lastContact: 1789290615,
      lastSeen: 1_700_000_000_000,
      stale: false,
    })
    expect(aircraft?.alt_baro).toBeCloseTo(40999.99, 1)
    expect(aircraft?.gs).toBeCloseTo(368.02, 1)
    expect(aircraft?.baro_rate).toBeCloseTo(64.96, 1)
  })

  it('lowercases the identity key', () => {
    expect(decodeStateVector(['ABCDEF'], 0)?.hex).toBe('abcdef')
  })

  it('leaves every absent field undefined rather than zero', () => {
    const aircraft = decodeStateVector(['abcdef'], 1)

    expect(aircraft).toEqual({
      hex: 'abcdef',
      flight: undefined,
      lat: undefined,
      lon: undefined,
      alt_baro: undefined,
      gs: undefined,
      track: undefined,
      squawk: undefined,
      baro_rate: undefined,
      on_ground: undefined,
      lastContact: undefined,
      lastSeen: 1,
      stale: false,
    })
  })

  it('treats null and blank payload fields as absent', () => {
    const vector = ['abcdef', '        ', 'Country', null, null]
    const aircraft = decodeStateVector(vector, 0)

    expect(aircraft?.flight).toBeUndefined()
    expect(aircraft?.lastContact).toBeUndefined()
  })

  it.each([
    ['not an array', { icao24: 'abcdef' }],
    ['empty', []],
    ['a non string identity', [42]],
    ['a blank identity', ['   ']],
    ['null', null],
  ])('returns null for a vector that is %s', (_case, vector) => {
    expect(decodeStateVector(vector, 0)).toBeNull()
  })
})

describe('createOpenSkyClient', () => {
  describe('anonymous access', () => {
    it('sends no Authorization header and requests no token', async () => {
      const { fetchImpl, calls } = fakeFetch([statesResponse([LIVE_VECTOR])])
      const client = createOpenSkyClient({
        apiBase: API_BASE,
        authUrl: AUTH_URL,
        fetch: fetchImpl,
      })

      const result = await client.fetchStates(BOX)

      expect(result.status).toBe('found')
      expect(calls).toHaveLength(1)
      expect(calls[0].url).toBe(
        `${API_BASE}/states/all?lamin=50.5&lomin=3&lamax=53.8&lomax=7.3`,
      )
      expect(calls[0].init?.headers).toBeUndefined()
      expect(client.isAuthenticated()).toBe(false)
    })
  })

  describe('authenticated access', () => {
    it('requests a token once and reuses it across polls', async () => {
      const { fetchImpl, calls } = fakeFetch([
        tokenResponse('token-one'),
        statesResponse([]),
        statesResponse([]),
      ])
      const client = createOpenSkyClient({
        apiBase: API_BASE,
        authUrl: AUTH_URL,
        credentials: CREDENTIALS,
        fetch: fetchImpl,
        now: () => 1_000_000,
      })

      await client.fetchStates(BOX)
      await client.fetchStates(BOX)

      expect(calls).toHaveLength(3)
      expect(calls[0].url).toBe(AUTH_URL)
      expect(calls[0].init?.method).toBe('POST')
      expect(calls[1].init?.headers).toEqual({
        Authorization: 'Bearer token-one',
      })
      expect(calls[2].init?.headers).toEqual({
        Authorization: 'Bearer token-one',
      })
      expect(client.isAuthenticated()).toBe(true)
    })

    it('refreshes early, before the token actually expires', async () => {
      const { fetchImpl, calls } = fakeFetch([
        tokenResponse('token-one', 1800),
        statesResponse([]),
        tokenResponse('token-two', 1800),
        statesResponse([]),
      ])
      let clock = 0
      const client = createOpenSkyClient({
        apiBase: API_BASE,
        authUrl: AUTH_URL,
        credentials: CREDENTIALS,
        fetch: fetchImpl,
        now: () => clock,
      })

      await client.fetchStates(BOX)
      // Inside the 1800 s lifetime but within the 60 s refresh margin.
      clock = 1_750_000
      await client.fetchStates(BOX)

      expect(calls).toHaveLength(4)
      expect(calls[3].init?.headers).toEqual({
        Authorization: 'Bearer token-two',
      })
    })

    it('does not spend two token requests on concurrent polls', async () => {
      const { fetchImpl, calls } = fakeFetch([
        tokenResponse('token-one'),
        statesResponse([]),
        statesResponse([]),
      ])
      const client = createOpenSkyClient({
        apiBase: API_BASE,
        authUrl: AUTH_URL,
        credentials: CREDENTIALS,
        fetch: fetchImpl,
        now: () => 0,
      })

      await Promise.all([client.fetchStates(BOX), client.fetchStates(BOX)])

      expect(calls.filter((call) => call.url === AUTH_URL)).toHaveLength(1)
    })

    it('reports an auth error when the token request is rejected', async () => {
      const { fetchImpl } = fakeFetch([
        jsonResponse({ error: 'invalid_client' }, { status: 401 }),
      ])
      const client = createOpenSkyClient({
        apiBase: API_BASE,
        authUrl: AUTH_URL,
        credentials: CREDENTIALS,
        fetch: fetchImpl,
      })

      expect(await client.fetchStates(BOX)).toEqual({
        status: 'error',
        reason: 'auth',
      })
    })

    it('discards a rejected token so the next poll fetches a fresh one', async () => {
      const { fetchImpl, calls } = fakeFetch([
        tokenResponse('stale-token'),
        jsonResponse({}, { status: 401 }),
        tokenResponse('fresh-token'),
        statesResponse([]),
      ])
      const client = createOpenSkyClient({
        apiBase: API_BASE,
        authUrl: AUTH_URL,
        credentials: CREDENTIALS,
        fetch: fetchImpl,
        now: () => 0,
      })

      expect((await client.fetchStates(BOX)).status).toBe('error')
      expect((await client.fetchStates(BOX)).status).toBe('found')
      expect(calls.filter((call) => call.url === AUTH_URL)).toHaveLength(2)
    })
  })

  describe('snapshot decoding', () => {
    it('skips malformed vectors instead of failing the whole snapshot', async () => {
      const { fetchImpl } = fakeFetch([
        statesResponse([LIVE_VECTOR, 'nonsense', [], ['abcdef']]),
      ])
      const client = createOpenSkyClient({
        apiBase: API_BASE,
        authUrl: AUTH_URL,
        fetch: fetchImpl,
      })

      const result = await client.fetchStates(BOX)

      expect(result.status).toBe('found')
      if (result.status !== 'found') return
      expect(result.data.aircraft.map((a) => a.hex)).toEqual([
        '470bc9',
        'abcdef',
      ])
      expect(result.data.time).toBe(1789290616)
    })

    it('keeps aircraft that have no position fix', async () => {
      const noPosition = ['abcdef', 'TEST123 ', 'Country', null, null]
      const { fetchImpl } = fakeFetch([statesResponse([noPosition])])
      const client = createOpenSkyClient({
        apiBase: API_BASE,
        authUrl: AUTH_URL,
        fetch: fetchImpl,
      })

      const result = await client.fetchStates(BOX)

      expect(result.status).toBe('found')
      if (result.status !== 'found') return
      expect(result.data.aircraft).toHaveLength(1)
      expect(result.data.aircraft[0].lat).toBeUndefined()
    })

    it('treats a null states list as an empty box, not an error', async () => {
      const { fetchImpl } = fakeFetch([statesResponse(null)])
      const client = createOpenSkyClient({
        apiBase: API_BASE,
        authUrl: AUTH_URL,
        fetch: fetchImpl,
      })

      const result = await client.fetchStates(BOX)

      expect(result.status).toBe('found')
      if (result.status !== 'found') return
      expect(result.data.aircraft).toEqual([])
    })

    it('reports the remaining credit budget when the header is present', async () => {
      const { fetchImpl } = fakeFetch([
        statesResponse([], { 'X-Rate-Limit-Remaining': '3997' }),
      ])
      const client = createOpenSkyClient({
        apiBase: API_BASE,
        authUrl: AUTH_URL,
        fetch: fetchImpl,
      })

      const result = await client.fetchStates(BOX)

      expect(result.status).toBe('found')
      if (result.status !== 'found') return
      expect(result.data.creditsRemaining).toBe(3997)
    })

    it('leaves the credit budget undefined when the header is absent', async () => {
      const { fetchImpl } = fakeFetch([statesResponse([])])
      const client = createOpenSkyClient({
        apiBase: API_BASE,
        authUrl: AUTH_URL,
        fetch: fetchImpl,
      })

      const result = await client.fetchStates(BOX)

      expect(result.status).toBe('found')
      if (result.status !== 'found') return
      expect(result.data.creditsRemaining).toBeUndefined()
    })
  })

  describe('failure classification', () => {
    it.each([
      [401, 'auth'],
      [403, 'auth'],
      [429, 'rate-limited'],
      [500, 'server'],
      [503, 'server'],
      [400, 'malformed'],
    ])('maps status %i to the %s reason', async (status, reason) => {
      const { fetchImpl } = fakeFetch([jsonResponse({}, { status })])
      const client = createOpenSkyClient({
        apiBase: API_BASE,
        authUrl: AUTH_URL,
        fetch: fetchImpl,
      })

      expect(await client.fetchStates(BOX)).toEqual({
        status: 'error',
        reason,
      })
    })

    it('maps 404 to missing rather than an error', async () => {
      const { fetchImpl } = fakeFetch([jsonResponse({}, { status: 404 })])
      const client = createOpenSkyClient({
        apiBase: API_BASE,
        authUrl: AUTH_URL,
        fetch: fetchImpl,
      })

      expect(await client.fetchStates(BOX)).toEqual({ status: 'missing' })
    })

    it('maps a thrown fetch to a network error', async () => {
      const { fetchImpl } = fakeFetch([new TypeError('Failed to fetch')])
      const client = createOpenSkyClient({
        apiBase: API_BASE,
        authUrl: AUTH_URL,
        fetch: fetchImpl,
      })

      expect(await client.fetchStates(BOX)).toEqual({
        status: 'error',
        reason: 'network',
      })
    })

    it('maps an unparsable body to a malformed error', async () => {
      const broken = new Response('<html>nope</html>', { status: 200 })
      const { fetchImpl } = fakeFetch([broken])
      const client = createOpenSkyClient({
        apiBase: API_BASE,
        authUrl: AUTH_URL,
        fetch: fetchImpl,
      })

      expect(await client.fetchStates(BOX)).toEqual({
        status: 'error',
        reason: 'malformed',
      })
    })

    it('never throws into the caller', async () => {
      const { fetchImpl } = fakeFetch([new Error('boom')])
      const client = createOpenSkyClient({
        apiBase: API_BASE,
        authUrl: AUTH_URL,
        fetch: fetchImpl,
      })

      const spy = vi.fn()
      await client.fetchStates(BOX).then(spy)

      expect(spy).toHaveBeenCalledOnce()
    })
  })
})
