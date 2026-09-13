/**
 * The only interpreter of the server environment.
 *
 * Mirrors what `src/config.ts` does for `import.meta.env`, with the same rule:
 * errors name the variable, never its value. None of these are `VITE_` prefixed
 * and none may ever become one, because every `VITE_` variable is compiled into
 * the client bundle.
 *
 * Takes a plain record rather than reading `process.env` itself, so it stays
 * testable and so `src/` needs no Node types. The entrypoints pass `process.env`.
 */

import type { OpenSkyCredentials } from './openskyToken.ts'

export const DEFAULT_OPENSKY_API_BASE = 'https://opensky-network.org/api'
export const DEFAULT_OPENSKY_AUTH_URL =
  'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token'

export interface ServerEnv {
  /** OpenSky REST base, no trailing slash. */
  apiBase: string
  authUrl: string
  /** Absent means anonymous access, which OpenSky serves at a tenth the quota. */
  credentials?: OpenSkyCredentials
}

export class ServerConfigError extends Error {
  constructor(variable: string, problem: string) {
    super(`Invalid proxy configuration: ${variable} ${problem}`)
    this.name = 'ServerConfigError'
  }
}

export type RawServerEnv = Record<string, string | undefined>

function optionalString(env: RawServerEnv, key: string): string | undefined {
  const raw = env[key]
  if (typeof raw !== 'string') return undefined

  const trimmed = raw.trim()
  return trimmed === '' ? undefined : trimmed
}

function urlWithDefault(
  env: RawServerEnv,
  key: string,
  fallback: string,
): string {
  const raw = optionalString(env, key)
  if (raw === undefined) return fallback

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new ServerConfigError(key, 'must be an absolute URL')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ServerConfigError(key, 'must use the http or https scheme')
  }

  return raw.replace(/\/+$/, '')
}

export function readServerEnv(env: RawServerEnv): ServerEnv {
  const clientId = optionalString(env, 'OPENSKY_CLIENT_ID')
  const clientSecret = optionalString(env, 'OPENSKY_CLIENT_SECRET')

  // Half a pair would silently fall back to the 400 credit anonymous quota.
  if (clientId !== undefined && clientSecret === undefined) {
    throw new ServerConfigError(
      'OPENSKY_CLIENT_SECRET',
      'is required when OPENSKY_CLIENT_ID is set',
    )
  }
  if (clientSecret !== undefined && clientId === undefined) {
    throw new ServerConfigError(
      'OPENSKY_CLIENT_ID',
      'is required when OPENSKY_CLIENT_SECRET is set',
    )
  }

  return {
    apiBase: urlWithDefault(env, 'OPENSKY_API_BASE', DEFAULT_OPENSKY_API_BASE),
    authUrl: urlWithDefault(env, 'OPENSKY_AUTH_URL', DEFAULT_OPENSKY_AUTH_URL),
    credentials:
      clientId !== undefined && clientSecret !== undefined
        ? { clientId, clientSecret }
        : undefined,
  }
}
