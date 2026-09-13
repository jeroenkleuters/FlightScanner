import { describe, expect, it, vi } from 'vitest'
import {
  createOpenSkyClient,
  decodeStateVector,
  DEFAULT_PROXY_BASE,
  type BoundingBox,
  type FetchLike,
} from './opensky'

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

function proxyError(code: string, status: number): Response {
  return jsonResponse({ error: code }, { status })
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
  describe('the proxy request', () => {
    it('asks the same-origin proxy for the bounding box', async () => {
      const { fetchImpl, calls } = fakeFetch([statesResponse([LIVE_VECTOR])])
      const client = createOpenSkyClient({ fetch: fetchImpl })

      const result = await client.fetchStates(BOX)

      expect(result.status).toBe('found')
      expect(calls).toHaveLength(1)
      expect(calls[0].url).toBe(
        `${DEFAULT_PROXY_BASE}/states?lamin=50.5&lomin=3&lamax=53.8&lomax=7.3`,
      )
    })

    it('sends no credential of any kind', async () => {
      const { fetchImpl, calls } = fakeFetch([statesResponse([])])
      const client = createOpenSkyClient({ fetch: fetchImpl })

      await client.fetchStates(BOX)

      expect(calls[0].init).toBeUndefined()
      // One request only: the token exchange belongs to the proxy now.
      expect(calls).toHaveLength(1)
    })

    it('honours an overridden proxy base', async () => {
      const { fetchImpl, calls } = fakeFetch([statesResponse([])])
      const client = createOpenSkyClient({
        fetch: fetchImpl,
        proxyBase: '/elsewhere',
      })

      await client.fetchStates(BOX)

      expect(calls[0].url).toContain('/elsewhere/states?')
    })
  })

  describe('snapshot decoding', () => {
    it('skips malformed vectors instead of failing the whole snapshot', async () => {
      const { fetchImpl } = fakeFetch([
        statesResponse([LIVE_VECTOR, 'nonsense', [], ['abcdef']]),
      ])
      const client = createOpenSkyClient({
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
      ['credentials-rejected', 502, 'auth'],
      ['rate-limited', 429, 'rate-limited'],
      ['upstream-unavailable', 502, 'network'],
      ['upstream-malformed', 502, 'malformed'],
      ['invalid-request', 400, 'malformed'],
      ['method-not-allowed', 405, 'malformed'],
      ['proxy-misconfigured', 500, 'malformed'],
    ])('maps the %s code to the %s reason', async (code, status, reason) => {
      const { fetchImpl } = fakeFetch([proxyError(code, status)])
      const client = createOpenSkyClient({ fetch: fetchImpl })

      expect(await client.fetchStates(BOX)).toEqual({
        status: 'error',
        reason,
      })
    })

    it('treats an unrecognised code as malformed rather than guessing', async () => {
      const { fetchImpl } = fakeFetch([proxyError('something-new', 502)])
      const client = createOpenSkyClient({ fetch: fetchImpl })

      expect(await client.fetchStates(BOX)).toEqual({
        status: 'error',
        reason: 'malformed',
      })
    })

    it.each([
      [
        'an error body that is not JSON',
        new Response('gateway timeout', { status: 502 }),
      ],
      ['an error body with no code', jsonResponse({}, { status: 502 })],
      ['a non object error body', jsonResponse('nope', { status: 502 })],
    ])('falls back to malformed for %s', async (_case, response) => {
      const { fetchImpl } = fakeFetch([response])
      const client = createOpenSkyClient({ fetch: fetchImpl })

      expect(await client.fetchStates(BOX)).toEqual({
        status: 'error',
        reason: 'malformed',
      })
    })

    it('maps a thrown fetch to a network error: the proxy is unreachable', async () => {
      const { fetchImpl } = fakeFetch([new TypeError('Failed to fetch')])
      const client = createOpenSkyClient({ fetch: fetchImpl })

      expect(await client.fetchStates(BOX)).toEqual({
        status: 'error',
        reason: 'network',
      })
    })

    it('maps an unparsable success body to a malformed error', async () => {
      const { fetchImpl } = fakeFetch([
        new Response('<html>nope</html>', { status: 200 }),
      ])
      const client = createOpenSkyClient({ fetch: fetchImpl })

      expect(await client.fetchStates(BOX)).toEqual({
        status: 'error',
        reason: 'malformed',
      })
    })

    it('never throws into the caller', async () => {
      const { fetchImpl } = fakeFetch([new Error('boom')])
      const client = createOpenSkyClient({ fetch: fetchImpl })

      const spy = vi.fn()
      await client.fetchStates(BOX).then(spy)

      expect(spy).toHaveBeenCalledOnce()
    })
  })
})
