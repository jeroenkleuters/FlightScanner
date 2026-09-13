/**
 * OpenSky snapshot client, talking to this app's own proxy.
 *
 * Transport only: it fetches, decodes, and classifies failures. It holds no
 * domain state, derives no staleness, and never touches the map.
 *
 * The browser cannot call OpenSky directly. `states/all` answers every origin
 * with `Access-Control-Allow-Origin: https://opensky-network.org` and the token
 * endpoint sends no CORS header at all, so everything goes through
 * `/api/opensky`. Credentials and the OAuth2 exchange live there, in
 * `src/server/`, and nothing in this module knows a secret exists.
 */

import type { Aircraft } from '../types/aircraft'

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** Same-origin path of the proxy this client speaks to. */
export const DEFAULT_PROXY_BASE = '/api/opensky'

export interface BoundingBox {
  lamin: number
  lomin: number
  lamax: number
  lomax: number
}

export interface StatesSnapshot {
  /** Server time of the snapshot, epoch seconds. */
  time: number
  aircraft: Aircraft[]
  /** From `X-Rate-Limit-Remaining`, absent when the header is missing. */
  creditsRemaining?: number
}

export type OpenSkyErrorReason =
  'auth' | 'rate-limited' | 'network' | 'server' | 'malformed'

export type OpenSkyResult<T> =
  | { status: 'found'; data: T }
  | { status: 'missing' }
  | { status: 'error'; reason: OpenSkyErrorReason }

/** Positions in an OpenSky state vector, which is an array and not an object. */
const ICAO24 = 0
const CALLSIGN = 1
const LAST_CONTACT = 4
const LONGITUDE = 5
const LATITUDE = 6
const BARO_ALTITUDE = 7
const ON_GROUND = 8
const VELOCITY = 9
const TRUE_TRACK = 10
const VERTICAL_RATE = 11
const SQUAWK = 14

const METRES_TO_FEET = 3.280839895
const MS_TO_FEET_PER_MINUTE = 196.8503937
const MS_TO_KNOTS = 1.943844492

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function scaled(value: unknown, factor: number): number | undefined {
  const raw = optionalNumber(value)
  return raw === undefined ? undefined : raw * factor
}

function optionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * Returns null for anything without a usable identity. A malformed vector is
 * skipped rather than failing the whole snapshot.
 */
export function decodeStateVector(
  raw: unknown,
  receivedAt: number,
): Aircraft | null {
  if (!Array.isArray(raw)) return null

  const hex = optionalText(raw[ICAO24])?.toLowerCase()
  if (hex === undefined) return null

  return {
    hex,
    flight: optionalText(raw[CALLSIGN]),
    lat: optionalNumber(raw[LATITUDE]),
    lon: optionalNumber(raw[LONGITUDE]),
    alt_baro: scaled(raw[BARO_ALTITUDE], METRES_TO_FEET),
    gs: scaled(raw[VELOCITY], MS_TO_KNOTS),
    track: optionalNumber(raw[TRUE_TRACK]),
    squawk: optionalText(raw[SQUAWK]),
    baro_rate: scaled(raw[VERTICAL_RATE], MS_TO_FEET_PER_MINUTE),
    on_ground: typeof raw[ON_GROUND] === 'boolean' ? raw[ON_GROUND] : undefined,
    lastContact: optionalNumber(raw[LAST_CONTACT]),
    lastSeen: receivedAt,
    stale: false,
  }
}

/**
 * The proxy's error codes, which are a stable contract. Anything unrecognised
 * is `malformed` rather than a guess, so a new code cannot silently read as a
 * retryable failure.
 */
const REASON_BY_PROXY_CODE: Record<string, OpenSkyErrorReason> = {
  'credentials-rejected': 'auth',
  'rate-limited': 'rate-limited',
  'upstream-unavailable': 'network',
}

async function reasonForFailure(
  response: Response,
): Promise<OpenSkyErrorReason> {
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    return 'malformed'
  }

  if (typeof payload !== 'object' || payload === null) return 'malformed'

  const code = (payload as Record<string, unknown>).error
  if (typeof code !== 'string') return 'malformed'

  return REASON_BY_PROXY_CODE[code] ?? 'malformed'
}

export interface OpenSkyClientOptions {
  fetch: FetchLike
  now?: () => number
  /** Override only for tests; the proxy is always same-origin in the app. */
  proxyBase?: string
}

export interface OpenSkyClient {
  fetchStates(box: BoundingBox): Promise<OpenSkyResult<StatesSnapshot>>
}

export function createOpenSkyClient({
  fetch: fetchImpl,
  now = Date.now,
  proxyBase = DEFAULT_PROXY_BASE,
}: OpenSkyClientOptions): OpenSkyClient {
  async function fetchStates(
    box: BoundingBox,
  ): Promise<OpenSkyResult<StatesSnapshot>> {
    const query = new URLSearchParams({
      lamin: String(box.lamin),
      lomin: String(box.lomin),
      lamax: String(box.lamax),
      lomax: String(box.lomax),
    })

    let response: Response
    try {
      response = await fetchImpl(`${proxyBase}/states?${query.toString()}`)
    } catch {
      // The proxy itself is unreachable, which is the same story to the user as
      // an unreachable upstream: retrying is worth it.
      return { status: 'error', reason: 'network' }
    }

    if (!response.ok) {
      return { status: 'error', reason: await reasonForFailure(response) }
    }

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      return { status: 'error', reason: 'malformed' }
    }

    if (typeof payload !== 'object' || payload === null) {
      return { status: 'error', reason: 'malformed' }
    }

    const { time, states } = payload as Record<string, unknown>
    const receivedAt = now()
    const aircraft: Aircraft[] = []

    // `states` is null, not an empty array, when the box holds no traffic.
    if (Array.isArray(states)) {
      for (const vector of states) {
        const decoded = decodeStateVector(vector, receivedAt)
        if (decoded) aircraft.push(decoded)
      }
    }

    const header = response.headers.get('X-Rate-Limit-Remaining')
    const remaining = header === null ? undefined : Number(header)

    return {
      status: 'found',
      data: {
        time: optionalNumber(time) ?? Math.floor(receivedAt / 1000),
        aircraft,
        creditsRemaining:
          remaining !== undefined && Number.isFinite(remaining)
            ? remaining
            : undefined,
      },
    }
  }

  return { fetchStates }
}
