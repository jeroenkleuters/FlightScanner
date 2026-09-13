import { describe, expect, it, vi, type Mock } from 'vitest'
import type { FetchLike, TokenProvider } from './openskyToken.ts'
import { handleStatesRequest } from './statesHandler.ts'

const API_BASE = 'https://opensky.example.com/api'
const SECRET = 'super-secret-client-secret-value'
const BOX_QUERY = 'lamin=50.5&lomin=3&lamax=53.8&lomax=7.3'

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

interface FakeTokenProvider extends TokenProvider {
  invalidate: Mock<() => void>
}

function fakeTokenProvider(token?: string | Error): FakeTokenProvider {
  return {
    getToken: () =>
      token instanceof Error ? Promise.reject(token) : Promise.resolve(token),
    invalidate: vi.fn<() => void>(),
  }
}

function request(query = BOX_QUERY, method = 'GET'): Request {
  return new Request(`https://app.example.com/api/opensky/states?${query}`, {
    method,
  })
}

async function errorCode(response: Response): Promise<string> {
  const body: unknown = await response.json()
  return (body as { error?: string }).error ?? ''
}

describe('handleStatesRequest', () => {
  describe('request validation', () => {
    it.each(['POST', 'PUT', 'DELETE', 'HEAD'])(
      'rejects %s with method-not-allowed',
      async (method) => {
        const { fetchImpl, calls } = fakeFetch([])
        const response = await handleStatesRequest(request(BOX_QUERY, method), {
          apiBase: API_BASE,
          tokenProvider: fakeTokenProvider(),
          fetch: fetchImpl,
        })

        expect(response.status).toBe(405)
        expect(await errorCode(response)).toBe('method-not-allowed')
        expect(calls).toHaveLength(0)
      },
    )

    it.each([
      ['no parameters at all', ''],
      ['a missing lomax', 'lamin=50&lomin=3&lamax=53'],
      ['a blank parameter', 'lamin=&lomin=3&lamax=53&lomax=7'],
      ['a non numeric parameter', 'lamin=north&lomin=3&lamax=53&lomax=7'],
      ['a latitude above 90', 'lamin=50&lomin=3&lamax=91&lomax=7'],
      ['a latitude below -90', 'lamin=-91&lomin=3&lamax=53&lomax=7'],
      ['a longitude above 180', 'lamin=50&lomin=3&lamax=53&lomax=181'],
      ['a longitude below -180', 'lamin=50&lomin=-181&lamax=53&lomax=7'],
      ['an inverted latitude range', 'lamin=53&lomin=3&lamax=50&lomax=7'],
      ['an inverted longitude range', 'lamin=50&lomin=7&lamax=53&lomax=3'],
      ['an infinite value', 'lamin=Infinity&lomin=3&lamax=53&lomax=7'],
    ])('rejects %s with invalid-request', async (_case, query) => {
      const { fetchImpl, calls } = fakeFetch([])
      const response = await handleStatesRequest(request(query), {
        apiBase: API_BASE,
        tokenProvider: fakeTokenProvider(),
        fetch: fetchImpl,
      })

      expect(response.status).toBe(400)
      expect(await errorCode(response)).toBe('invalid-request')
      // A rejected box must never reach OpenSky and never cost a credit.
      expect(calls).toHaveLength(0)
    })

    it('accepts the range boundaries', async () => {
      const { fetchImpl } = fakeFetch([statesResponse([])])
      const response = await handleStatesRequest(
        request('lamin=-90&lomin=-180&lamax=90&lomax=180'),
        {
          apiBase: API_BASE,
          tokenProvider: fakeTokenProvider(),
          fetch: fetchImpl,
        },
      )

      expect(response.status).toBe(200)
    })
  })

  describe('upstream request', () => {
    it('forwards exactly the four box parameters and nothing else', async () => {
      const { fetchImpl, calls } = fakeFetch([statesResponse([])])
      await handleStatesRequest(
        request(`${BOX_QUERY}&extended=1&icao24=abcdef`),
        {
          apiBase: API_BASE,
          tokenProvider: fakeTokenProvider(),
          fetch: fetchImpl,
        },
      )

      expect(calls[0].url).toBe(
        `${API_BASE}/states/all?lamin=50.5&lomin=3&lamax=53.8&lomax=7.3`,
      )
    })

    it('adds the bearer token when the provider has one', async () => {
      const { fetchImpl, calls } = fakeFetch([statesResponse([])])
      await handleStatesRequest(request(), {
        apiBase: API_BASE,
        tokenProvider: fakeTokenProvider('token-one'),
        fetch: fetchImpl,
      })

      expect(calls[0].init?.headers).toEqual({
        Authorization: 'Bearer token-one',
      })
    })

    it('sends no Authorization header when anonymous', async () => {
      const { fetchImpl, calls } = fakeFetch([statesResponse([])])
      await handleStatesRequest(request(), {
        apiBase: API_BASE,
        tokenProvider: fakeTokenProvider(),
        fetch: fetchImpl,
      })

      expect(calls[0].init?.headers).toBeUndefined()
    })
  })

  describe('success', () => {
    it('returns the snapshot with the vectors intact', async () => {
      const { fetchImpl } = fakeFetch([statesResponse([LIVE_VECTOR])])
      const response = await handleStatesRequest(request(), {
        apiBase: API_BASE,
        tokenProvider: fakeTokenProvider(),
        fetch: fetchImpl,
      })

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        time: 1789290616,
        states: [LIVE_VECTOR],
      })
    })

    it('passes a null states list through rather than turning it into []', async () => {
      const { fetchImpl } = fakeFetch([statesResponse(null)])
      const response = await handleStatesRequest(request(), {
        apiBase: API_BASE,
        tokenProvider: fakeTokenProvider(),
        fetch: fetchImpl,
      })

      expect(await response.json()).toEqual({ time: 1789290616, states: null })
    })

    it('drops unknown upstream fields', async () => {
      const { fetchImpl } = fakeFetch([
        jsonResponse({ time: 1, states: [], surprise: 'extra' }),
      ])
      const response = await handleStatesRequest(request(), {
        apiBase: API_BASE,
        tokenProvider: fakeTokenProvider(),
        fetch: fetchImpl,
      })

      expect(await response.json()).toEqual({ time: 1, states: [] })
    })

    it('forwards the remaining credit header', async () => {
      const { fetchImpl } = fakeFetch([
        statesResponse([], { 'X-Rate-Limit-Remaining': '3997' }),
      ])
      const response = await handleStatesRequest(request(), {
        apiBase: API_BASE,
        tokenProvider: fakeTokenProvider(),
        fetch: fetchImpl,
      })

      expect(response.headers.get('X-Rate-Limit-Remaining')).toBe('3997')
    })

    it('omits the credit header when upstream sent none', async () => {
      const { fetchImpl } = fakeFetch([statesResponse([])])
      const response = await handleStatesRequest(request(), {
        apiBase: API_BASE,
        tokenProvider: fakeTokenProvider(),
        fetch: fetchImpl,
      })

      expect(response.headers.get('X-Rate-Limit-Remaining')).toBeNull()
    })
  })

  describe('failure classification', () => {
    it.each([
      [401, 502, 'credentials-rejected'],
      [403, 502, 'credentials-rejected'],
      [429, 429, 'rate-limited'],
      [500, 502, 'upstream-unavailable'],
      [503, 502, 'upstream-unavailable'],
      [400, 502, 'upstream-malformed'],
      [404, 502, 'upstream-malformed'],
    ])('maps upstream %i to %i %s', async (upstreamStatus, status, code) => {
      const { fetchImpl } = fakeFetch([
        jsonResponse({}, { status: upstreamStatus }),
      ])
      const response = await handleStatesRequest(request(), {
        apiBase: API_BASE,
        tokenProvider: fakeTokenProvider('token-one'),
        fetch: fetchImpl,
      })

      expect(response.status).toBe(status)
      expect(await errorCode(response)).toBe(code)
    })

    it('invalidates the token when upstream rejects it', async () => {
      const { fetchImpl } = fakeFetch([jsonResponse({}, { status: 401 })])
      const tokenProvider = fakeTokenProvider('stale-token')

      await handleStatesRequest(request(), {
        apiBase: API_BASE,
        tokenProvider,
        fetch: fetchImpl,
      })

      expect(tokenProvider.invalidate).toHaveBeenCalledOnce()
    })

    it('leaves the token alone on an unrelated upstream failure', async () => {
      const { fetchImpl } = fakeFetch([jsonResponse({}, { status: 503 })])
      const tokenProvider = fakeTokenProvider('token-one')

      await handleStatesRequest(request(), {
        apiBase: API_BASE,
        tokenProvider,
        fetch: fetchImpl,
      })

      expect(tokenProvider.invalidate).not.toHaveBeenCalled()
    })

    it('reports credentials-rejected when the token exchange throws', async () => {
      const { fetchImpl, calls } = fakeFetch([])
      const response = await handleStatesRequest(request(), {
        apiBase: API_BASE,
        tokenProvider: fakeTokenProvider(new Error('token request failed')),
        fetch: fetchImpl,
      })

      expect(response.status).toBe(502)
      expect(await errorCode(response)).toBe('credentials-rejected')
      expect(calls).toHaveLength(0)
    })

    it('reports upstream-unavailable when the fetch throws', async () => {
      const { fetchImpl } = fakeFetch([new TypeError('Failed to fetch')])
      const response = await handleStatesRequest(request(), {
        apiBase: API_BASE,
        tokenProvider: fakeTokenProvider(),
        fetch: fetchImpl,
      })

      expect(response.status).toBe(502)
      expect(await errorCode(response)).toBe('upstream-unavailable')
    })

    it.each([
      [
        'an unparsable body',
        new Response('<html>nope</html>', { status: 200 }),
      ],
      ['a non object body', jsonResponse('nope')],
      ['a null body', jsonResponse(null)],
      ['a snapshot with no time', jsonResponse({ states: [] })],
      [
        'a snapshot with a non numeric time',
        jsonResponse({ time: 'now', states: [] }),
      ],
    ])('reports upstream-malformed for %s', async (_case, upstream) => {
      const { fetchImpl } = fakeFetch([upstream])
      const response = await handleStatesRequest(request(), {
        apiBase: API_BASE,
        tokenProvider: fakeTokenProvider(),
        fetch: fetchImpl,
      })

      expect(response.status).toBe(502)
      expect(await errorCode(response)).toBe('upstream-malformed')
    })
  })

  describe('response hygiene', () => {
    it('never sets a CORS header, on success or on failure', async () => {
      const cases = [statesResponse([]), jsonResponse({}, { status: 401 })]

      for (const upstream of cases) {
        const { fetchImpl } = fakeFetch([upstream])
        const response = await handleStatesRequest(request(), {
          apiBase: API_BASE,
          tokenProvider: fakeTokenProvider('token-one'),
          fetch: fetchImpl,
        })

        expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
      }
    })

    it('marks every response no-store', async () => {
      const cases: Array<Response | Error> = [
        statesResponse([]),
        jsonResponse({}, { status: 429 }),
      ]

      for (const upstream of cases) {
        const { fetchImpl } = fakeFetch([upstream])
        const response = await handleStatesRequest(request(), {
          apiBase: API_BASE,
          tokenProvider: fakeTokenProvider(),
          fetch: fetchImpl,
        })

        expect(response.headers.get('Cache-Control')).toBe('no-store')
        expect(response.headers.get('Content-Type')).toContain(
          'application/json',
        )
      }
    })

    it('leaks neither the credential nor the upstream body on a rejection', async () => {
      const { fetchImpl } = fakeFetch([
        jsonResponse(
          {
            error: 'invalid_token',
            client_secret: SECRET,
            hint: 'internal detail',
          },
          { status: 401, headers: { 'X-Upstream-Debug': SECRET } },
        ),
      ])
      const response = await handleStatesRequest(request(), {
        apiBase: API_BASE,
        tokenProvider: fakeTokenProvider('stale-token'),
        fetch: fetchImpl,
      })

      const text = await response.text()
      expect(text).toBe('{"error":"credentials-rejected"}')
      expect(text).not.toContain(SECRET)
      expect(text).not.toContain('internal detail')
      expect(response.headers.get('X-Upstream-Debug')).toBeNull()
    })
  })
})
