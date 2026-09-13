/**
 * The single reader of `import.meta.env` in this project.
 *
 * Every other module imports `config` from here so validation happens once, in
 * one place, and so tests can exercise the parser with a plain object.
 *
 * Errors name the offending variable and never include its value. Every `VITE_`
 * variable is baked into the client bundle and readable by anyone who loads the
 * app, so nothing sensitive belongs here. The OpenSky credentials and upstream
 * URLs live on the proxy instead, read by `src/server/env.ts`.
 */

import type { BoundingBox } from './api/opensky'
import { DEFAULT_MAP_STYLE_URL } from './map/mapStyle'

// Re-exported so callers keep one import for configuration values. The constant
// itself lives with the map, next to the provider and attribution record.
export { DEFAULT_MAP_STYLE_URL }

/**
 * OpenSky bills a bounded states query at one credit and grants 4000 a day to
 * an authenticated client, so 30 s costs about 2880 and fits. Anything faster
 * exhausts the quota partway through the day, which is why this is a hard floor
 * rather than a default.
 */
export const MIN_POLL_INTERVAL_MS = 30_000
export const DEFAULT_POLL_INTERVAL_MS = 30_000

/**
 * Roughly the Netherlands with the Belgian and German border regions, matching
 * the committed fixture. The box is fixed for the session: the camera never
 * changes it, so a shared deployment spends one credit per interval in total
 * rather than one per viewer per pan.
 */
export const DEFAULT_BOUNDING_BOX: BoundingBox = {
  lamin: 50.5,
  lomin: 3.0,
  lamax: 53.8,
  lomax: 7.3,
}

/** The middle of a box, in the `{ lat, lon }` shape the camera uses. */
function centreOf(box: BoundingBox): LatLon {
  return {
    lat: (box.lamin + box.lamax) / 2,
    lon: (box.lomin + box.lomax) / 2,
  }
}

/**
 * The opening view, derived from the box rather than declared beside it.
 *
 * These were once an unrelated `{ lat: 0, lon: 0 }` and zoom 6, which put a
 * deployment with no `VITE_` overrides in the Gulf of Guinea, thousands of
 * kilometres from the only region the app ever queries: aircraft fetched and
 * drawn correctly, entirely off-screen. A local `.env` hid it, and `.env` is
 * gitignored, so nothing carried the correction to a deployment.
 *
 * Deriving the centre means moving the box moves the camera with it, and the
 * two cannot drift apart again. `VITE_DEFAULT_CENTER` and `VITE_DEFAULT_ZOOM`
 * still override both.
 */
export const DEFAULT_CENTER: LatLon = centreOf(DEFAULT_BOUNDING_BOX)

/** Frames the whole box with margin at ordinary window sizes. */
export const DEFAULT_ZOOM = 7

export interface LatLon {
  lat: number
  lon: number
}

export interface AppConfig {
  pollIntervalMs: number
  boundingBox: BoundingBox
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

/** `lamin,lomin,lamax,lomax`, the order the proxy and transport already use. */
function parseBoundingBox(key: string, value: string): BoundingBox {
  const parts = value.split(',')
  if (parts.length !== 4) {
    throw new ConfigError(
      key,
      'must be four comma separated numbers, "lamin,lomin,lamax,lomax"',
    )
  }

  const [lamin, lomin, lamax, lomax] = parts.map((part) =>
    part.trim() === '' ? Number.NaN : Number(part.trim()),
  )

  if (![lamin, lomin, lamax, lomax].every(Number.isFinite)) {
    throw new ConfigError(key, 'has a corner that is not a number')
  }
  if (lamin < -90 || lamin > 90 || lamax < -90 || lamax > 90) {
    throw new ConfigError(key, 'has a latitude outside -90..90')
  }
  if (lomin < -180 || lomin > 180 || lomax < -180 || lomax > 180) {
    throw new ConfigError(key, 'has a longitude outside -180..180')
  }
  if (lamin > lamax) {
    throw new ConfigError(key, 'has a southern edge north of its northern edge')
  }
  if (lomin > lomax) {
    throw new ConfigError(key, 'has a western edge east of its eastern edge')
  }

  return { lamin, lomin, lamax, lomax }
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

export function parseConfig(env: RawEnv): AppConfig {
  const rawPoll = optionalString(env, 'VITE_OPENSKY_POLL_MS')
  const pollIntervalMs =
    rawPoll === undefined
      ? DEFAULT_POLL_INTERVAL_MS
      : parsePollInterval('VITE_OPENSKY_POLL_MS', rawPoll)

  const rawBox = optionalString(env, 'VITE_OPENSKY_BBOX')
  const boundingBox =
    rawBox === undefined
      ? { ...DEFAULT_BOUNDING_BOX }
      : parseBoundingBox('VITE_OPENSKY_BBOX', rawBox)

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
    pollIntervalMs,
    boundingBox,
    mapStyleUrl,
    defaultCenter,
    defaultZoom,
  }
}

export const config: AppConfig = parseConfig(import.meta.env)
