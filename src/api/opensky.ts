/**
 * OpenSky Network REST transport.
 *
 * Transport only: it fetches, decodes, and classifies failures. It holds no
 * domain state, derives no staleness, and never touches the map.
 *
 * Endpoints and quotas confirmed against the live API on 2026-09-13: a bounded
 * `states/all` query costs one credit, anonymous callers get 400 a day per IP,
 * and an authenticated token lives 1800 s.
 */

import type { Aircraft } from '../types/aircraft'

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface OpenSkyCredentials {
  clientId: string
  clientSecret: string
}

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
  | 'auth'
  | 'rate-limited'
  | 'network'
  | 'server'
  | 'malformed'

export type OpenSkyResult<T> =
  | { status: 'found'; data: T }
  | { status: 'missing' }
  | { status: 'error'; reason: OpenSkyErrorReason }

/** Refreshed this long before expiry so a poll never races the boundary. */
const TOKEN_REFRESH_MARGIN_MS = 60_000

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

function reasonForStatus(status: number): OpenSkyErrorReason {
  if (status === 401 || status === 403) return 'auth'
  if (status === 429) return 'rate-limited'
  if (status >= 500) return 'server'
  return 'malformed'
}

interface CachedToken {
  value: string
  expiresAtMs: number
}

export interface OpenSkyClientOptions {
  apiBase: string
  authUrl: string
  /** Absent means anonymous access, which OpenSky serves at a lower quota. */
  credentials?: OpenSkyCredentials
  fetch: FetchLike
  now?: () => number
}

export interface OpenSkyClient {
  fetchStates(box: BoundingBox): Promise<OpenSkyResult<StatesSnapshot>>
  /** True once credentials have produced a token, for status reporting. */
  isAuthenticated(): boolean
}

export function createOpenSkyClient({
  apiBase,
  authUrl,
  credentials,
  fetch: fetchImpl,
  now = Date.now,
}: OpenSkyClientOptions): OpenSkyClient {
  let cached: CachedToken | undefined
  let inFlight: Promise<CachedToken | undefined> | undefined

  async function requestToken(): Promise<CachedToken | undefined> {
    if (!credentials) return undefined

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
    })

    const response = await fetchImpl(authUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })

    if (!response.ok) {
      throw new Error(`token request failed with status ${response.status}`)
    }

    const payload: unknown = await response.json()
    if (typeof payload !== 'object' || payload === null) {
      throw new Error('token response was not an object')
    }

    const record = payload as Record<string, unknown>
    const accessToken = optionalText(record.access_token)
    if (accessToken === undefined) {
      throw new Error('token response carried no access_token')
    }

    const lifetimeSeconds = optionalNumber(record.expires_in) ?? 0

    return {
      value: accessToken,
      expiresAtMs: now() + lifetimeSeconds * 1000 - TOKEN_REFRESH_MARGIN_MS,
    }
  }

  async function getToken(): Promise<string | undefined> {
    if (!credentials) return undefined
    if (cached && now() < cached.expiresAtMs) return cached.value

    // Concurrent polls must not each spend a token request.
    inFlight ??= requestToken().finally(() => {
      inFlight = undefined
    })

    cached = await inFlight
    return cached?.value
  }

  async function fetchStates(
    box: BoundingBox,
  ): Promise<OpenSkyResult<StatesSnapshot>> {
    let token: string | undefined
    try {
      token = await getToken()
    } catch {
      return { status: 'error', reason: 'auth' }
    }

    const query = new URLSearchParams({
      lamin: String(box.lamin),
      lomin: String(box.lomin),
      lamax: String(box.lamax),
      lomax: String(box.lomax),
    })

    let response: Response
    try {
      response = await fetchImpl(`${apiBase}/states/all?${query.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      })
    } catch {
      return { status: 'error', reason: 'network' }
    }

    if (response.status === 404) return { status: 'missing' }

    if (!response.ok) {
      // A rejected token is worth discarding so the next poll requests a fresh one.
      if (response.status === 401 || response.status === 403) cached = undefined
      return { status: 'error', reason: reasonForStatus(response.status) }
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

  return {
    fetchStates,
    isAuthenticated: () => cached !== undefined,
  }
}
