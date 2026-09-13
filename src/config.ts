/**
 * The single reader of `import.meta.env` in this project.
 *
 * Every other module imports `config` from here so validation happens once, in
 * one place, and so tests can exercise the parser with a plain object.
 *
 * Errors name the offending variable and never include its value. Every `VITE_`
 * variable is baked into the client bundle and readable by anyone who loads the
 * app, so `VITE_OPENSKY_CLIENT_SECRET` is only safe for local and
 * trusted-network use. A public deployment needs a backend proxy that holds the
 * credentials instead.
 */

import { DEFAULT_MAP_STYLE_URL } from './map/mapStyle'

// Re-exported so callers keep one import for configuration values. The constant
// itself lives with the map, next to the provider and attribution record.
export { DEFAULT_MAP_STYLE_URL }

export const DEFAULT_OPENSKY_API_BASE = 'https://opensky-network.org/api'
export const DEFAULT_OPENSKY_AUTH_URL =
  'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token'

/**
 * OpenSky bills a bounded states query at one credit and grants 4000 a day to
 * an authenticated client, so 30 s costs about 2880 and fits. Anything faster
 * exhausts the quota partway through the day, which is why this is a hard floor
 * rather than a default.
 */
export const MIN_POLL_INTERVAL_MS = 30_000
export const DEFAULT_POLL_INTERVAL_MS = 30_000

export const DEFAULT_CENTER = { lat: 0, lon: 0 } as const
export const DEFAULT_ZOOM = 6

export interface LatLon {
  lat: number
  lon: number
}

export interface AppConfig {
  /** OpenSky REST base, no trailing slash. */
  openSkyApiBase: string
  /** OpenSky OAuth2 token endpoint. */
  openSkyAuthUrl: string
  /** Absent means anonymous access, which OpenSky allows at a lower quota. */
  openSkyClientId: string | undefined
  /** Present only when `openSkyClientId` is. */
  openSkyClientSecret: string | undefined
  pollIntervalMs: number
  mapStyleUrl: string
  defaultCenter: LatLon
  defaultZoom: number
}

/** Environment shape this parser accepts. `import.meta.env` satisfies it. */
export type RawEnv = Record<string, unknown>

class ConfigError extends Error {
  constructor(variable: string, problem: string) {
    super(`Invalid configuration: ${variable} ${problem}`)
    this.name = 'ConfigError'
  }
}

/** Returns the trimmed value, or undefined when absent, empty, or whitespace. */
function optionalString(env: RawEnv, key: string): string | undefined {
  const raw = env[key]
  if (typeof raw !== 'string') return undefined

  const trimmed = raw.trim()
  return trimmed === '' ? undefined : trimmed
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '')
}

function parseUrl(key: string, value: string, protocols: string[]): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new ConfigError(key, 'must be an absolute URL')
  }

  if (!protocols.includes(url.protocol)) {
    const expected = protocols.map((p) => p.replace(':', '')).join(' or ')
    throw new ConfigError(key, `must use the ${expected} scheme`)
  }

  return trimTrailingSlashes(value.trim())
}

/** Applies the default when absent, and validates whatever is supplied. */
function parseUrlWithDefault(
  env: RawEnv,
  key: string,
  fallback: string,
  protocols: string[],
): string {
  const raw = optionalString(env, key)
  return raw === undefined ? fallback : parseUrl(key, raw, protocols)
}

function parseCenter(key: string, value: string): LatLon {
  const parts = value.split(',')
  if (parts.length !== 2) {
    throw new ConfigError(key, 'must be two comma separated numbers, "lat,lon"')
  }

  const lat = Number(parts[0].trim())
  const lon = Number(parts[1].trim())

  if (parts[0].trim() === '' || !Number.isFinite(lat)) {
    throw new ConfigError(key, 'has a latitude that is not a number')
  }
  if (parts[1].trim() === '' || !Number.isFinite(lon)) {
    throw new ConfigError(key, 'has a longitude that is not a number')
  }
  if (lat < -90 || lat > 90) {
    throw new ConfigError(key, 'has a latitude outside -90..90')
  }
  if (lon < -180 || lon > 180) {
    throw new ConfigError(key, 'has a longitude outside -180..180')
  }

  return { lat, lon }
}

function parseZoom(key: string, value: string): number {
  const zoom = Number(value)
  if (!Number.isFinite(zoom)) {
    throw new ConfigError(key, 'must be a number')
  }
  if (zoom < 0 || zoom > 22) {
    throw new ConfigError(key, 'must be between 0 and 22')
  }
  return zoom
}

function parsePollInterval(key: string, value: string): number {
  const interval = Number(value)
  if (!Number.isFinite(interval)) {
    throw new ConfigError(key, 'must be a number of milliseconds')
  }
  if (interval < MIN_POLL_INTERVAL_MS) {
    throw new ConfigError(
      key,
      `must be at least ${MIN_POLL_INTERVAL_MS} ms to stay inside the OpenSky daily credit budget`,
    )
  }
  return interval
}

/**
 * Credentials are optional, but half a pair is always a mistake: it would
 * silently fall back to anonymous access at a tenth of the quota.
 */
function parseCredentials(env: RawEnv): {
  openSkyClientId: string | undefined
  openSkyClientSecret: string | undefined
} {
  const openSkyClientId = optionalString(env, 'VITE_OPENSKY_CLIENT_ID')
  const openSkyClientSecret = optionalString(env, 'VITE_OPENSKY_CLIENT_SECRET')

  if (openSkyClientId !== undefined && openSkyClientSecret === undefined) {
    throw new ConfigError(
      'VITE_OPENSKY_CLIENT_SECRET',
      'is required when VITE_OPENSKY_CLIENT_ID is set',
    )
  }
  if (openSkyClientSecret !== undefined && openSkyClientId === undefined) {
    throw new ConfigError(
      'VITE_OPENSKY_CLIENT_ID',
      'is required when VITE_OPENSKY_CLIENT_SECRET is set',
    )
  }

  return { openSkyClientId, openSkyClientSecret }
}

export function parseConfig(env: RawEnv): AppConfig {
  const openSkyApiBase = parseUrlWithDefault(
    env,
    'VITE_OPENSKY_API_BASE',
    DEFAULT_OPENSKY_API_BASE,
    ['http:', 'https:'],
  )

  const openSkyAuthUrl = parseUrlWithDefault(
    env,
    'VITE_OPENSKY_AUTH_URL',
    DEFAULT_OPENSKY_AUTH_URL,
    ['http:', 'https:'],
  )

  const rawPoll = optionalString(env, 'VITE_OPENSKY_POLL_MS')
  const pollIntervalMs =
    rawPoll === undefined
      ? DEFAULT_POLL_INTERVAL_MS
      : parsePollInterval('VITE_OPENSKY_POLL_MS', rawPoll)

  const mapStyleUrl = parseUrlWithDefault(
    env,
    'VITE_MAP_STYLE_URL',
    DEFAULT_MAP_STYLE_URL,
    ['https:'],
  )

  const rawCenter = optionalString(env, 'VITE_DEFAULT_CENTER')
  const defaultCenter =
    rawCenter === undefined
      ? { ...DEFAULT_CENTER }
      : parseCenter('VITE_DEFAULT_CENTER', rawCenter)

  const rawZoom = optionalString(env, 'VITE_DEFAULT_ZOOM')
  const defaultZoom =
    rawZoom === undefined
      ? DEFAULT_ZOOM
      : parseZoom('VITE_DEFAULT_ZOOM', rawZoom)

  return {
    openSkyApiBase,
    openSkyAuthUrl,
    ...parseCredentials(env),
    pollIntervalMs,
    mapStyleUrl,
    defaultCenter,
    defaultZoom,
  }
}

export const config: AppConfig = parseConfig(import.meta.env)
