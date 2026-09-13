/**
 * `GET /api/opensky/states` - the reason this proxy exists.
 *
 * OpenSky answers every origin with
 * `Access-Control-Allow-Origin: https://opensky-network.org` and its token
 * endpoint sends no CORS header at all, so the browser cannot reach either one.
 * This handler is stateless: it validates, forwards, classifies, and reports the
 * remaining credit header. It enforces no budget and caches no snapshot.
 */

import type { FetchLike, TokenProvider } from './openskyToken.ts'
import { errorResponse, jsonResponse } from './response.ts'

export interface StatesHandlerDeps {
  /** OpenSky REST base, no trailing slash. */
  apiBase: string
  tokenProvider: TokenProvider
  fetch: FetchLike
}

const CREDIT_HEADER = 'X-Rate-Limit-Remaining'

interface BoundingBox {
  lamin: number
  lomin: number
  lamax: number
  lomax: number
}

function finiteParam(params: URLSearchParams, key: string): number | undefined {
  const raw = params.get(key)
  if (raw === null || raw.trim() === '') return undefined

  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

/**
 * Only these four parameters are read, and the forwarded query is rebuilt from
 * the parsed numbers rather than passed through, so the route cannot be used as
 * an open relay to arbitrary OpenSky endpoints or parameters.
 */
function parseBoundingBox(params: URLSearchParams): BoundingBox | undefined {
  const lamin = finiteParam(params, 'lamin')
  const lomin = finiteParam(params, 'lomin')
  const lamax = finiteParam(params, 'lamax')
  const lomax = finiteParam(params, 'lomax')

  if (
    lamin === undefined ||
    lomin === undefined ||
    lamax === undefined ||
    lomax === undefined
  ) {
    return undefined
  }

  if (lamin < -90 || lamin > 90 || lamax < -90 || lamax > 90) return undefined
  if (lomin < -180 || lomin > 180 || lomax < -180 || lomax > 180) {
    return undefined
  }
  if (lamin > lamax || lomin > lomax) return undefined

  return { lamin, lomin, lamax, lomax }
}

export async function handleStatesRequest(
  request: Request,
  { apiBase, tokenProvider, fetch: fetchImpl }: StatesHandlerDeps,
): Promise<Response> {
  if (request.method !== 'GET') {
    return errorResponse('method-not-allowed', 405)
  }

  const box = parseBoundingBox(new URL(request.url).searchParams)
  if (box === undefined) return errorResponse('invalid-request', 400)

  let token: string | undefined
  try {
    token = await tokenProvider.getToken()
  } catch {
    return errorResponse('credentials-rejected', 502)
  }

  const query = new URLSearchParams({
    lamin: String(box.lamin),
    lomin: String(box.lomin),
    lamax: String(box.lamax),
    lomax: String(box.lomax),
  })

  let upstream: Response
  try {
    upstream = await fetchImpl(`${apiBase}/states/all?${query.toString()}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
  } catch {
    return errorResponse('upstream-unavailable', 502)
  }

  if (!upstream.ok) {
    if (upstream.status === 401 || upstream.status === 403) {
      tokenProvider.invalidate()
      return errorResponse('credentials-rejected', 502)
    }
    if (upstream.status === 429) return errorResponse('rate-limited', 429)
    if (upstream.status >= 500)
      return errorResponse('upstream-unavailable', 502)
    // Any other 4xx means the request we built was wrong, which is our bug and
    // not worth retrying. The client maps this to a non-retrying malformed state.
    return errorResponse('upstream-malformed', 502)
  }

  let payload: unknown
  try {
    payload = await upstream.json()
  } catch {
    return errorResponse('upstream-malformed', 502)
  }

  if (typeof payload !== 'object' || payload === null) {
    return errorResponse('upstream-malformed', 502)
  }

  const { time, states } = payload as Record<string, unknown>
  if (typeof time !== 'number' || !Number.isFinite(time)) {
    return errorResponse('upstream-malformed', 502)
  }

  const credits = upstream.headers.get(CREDIT_HEADER)

  return jsonResponse(
    // `states` is null, not [], when the box holds no traffic. That is OpenSky's
    // shape and the client decoder already handles it. Unknown fields are dropped.
    { time, states: Array.isArray(states) ? states : null },
    { headers: credits === null ? {} : { [CREDIT_HEADER]: credits } },
  )
}
