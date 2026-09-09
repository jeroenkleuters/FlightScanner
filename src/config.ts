/**
 * The single reader of `import.meta.env` in this project.
 *
 * Every other module imports `config` from here so validation happens once, in
 * one place, and so tests can exercise the parser with a plain object.
 *
 * Errors name the offending variable and never include its value. Every `VITE_`
 * variable is baked into the client bundle and readable by anyone who loads the
 * app, so `VITE_SKYSPY_TOKEN` is only safe for local and trusted-network use. A
 * public deployment needs a backend proxy that holds the token instead.
 */

/** Keyless dark basemap. CARTO Dark Matter needs no account or API key. */
export const DEFAULT_MAP_STYLE_URL =
  'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

export const DEFAULT_CENTER = { lat: 0, lon: 0 } as const
export const DEFAULT_ZOOM = 6

export interface LatLon {
  lat: number
  lon: number
}

export interface AppConfig {
  /** SkySpy REST base, no trailing slash. */
  skySpyHttp: string
  /** SkySpy WebSocket base, no trailing slash. */
  skySpyWs: string
  /** Absent means SkySpy public mode. */
  skySpyToken: string | undefined
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

function requiredString(env: RawEnv, key: string): string {
  const value = optionalString(env, key)
  if (value === undefined) {
    throw new ConfigError(key, 'is required but was not set')
  }
  return value
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

export function parseConfig(env: RawEnv): AppConfig {
  const skySpyHttp = parseUrl(
    'VITE_SKYSPY_HTTP',
    requiredString(env, 'VITE_SKYSPY_HTTP'),
    ['http:', 'https:'],
  )

  const skySpyWs = parseUrl(
    'VITE_SKYSPY_WS',
    requiredString(env, 'VITE_SKYSPY_WS'),
    ['ws:', 'wss:'],
  )

  const rawMapStyle = optionalString(env, 'VITE_MAP_STYLE_URL')
  const mapStyleUrl =
    rawMapStyle === undefined
      ? DEFAULT_MAP_STYLE_URL
      : parseUrl('VITE_MAP_STYLE_URL', rawMapStyle, ['https:'])

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
    skySpyHttp,
    skySpyWs,
    skySpyToken: optionalString(env, 'VITE_SKYSPY_TOKEN'),
    mapStyleUrl,
    defaultCenter,
    defaultZoom,
  }
}

export const config: AppConfig = parseConfig(import.meta.env)
