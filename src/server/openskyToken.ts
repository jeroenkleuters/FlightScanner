/**
 * OpenSky OAuth2 client-credentials token exchange. Server side only.
 *
 * Ported unchanged in behavior from the browser client, which could not keep a
 * secret. Nothing here may appear in a response body or a log line.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface OpenSkyCredentials {
  clientId: string
  clientSecret: string
}

export interface TokenProvider {
  /** Undefined means anonymous access, which OpenSky serves at a lower quota. */
  getToken(): Promise<string | undefined>
  /** Drops a token the upstream has started rejecting. */
  invalidate(): void
}

export interface TokenProviderOptions {
  authUrl: string
  credentials?: OpenSkyCredentials
  fetch: FetchLike
  now?: () => number
}

/** Refreshed this long before expiry so a poll never races the boundary. */
const TOKEN_REFRESH_MARGIN_MS = 60_000

interface CachedToken {
  value: string
  expiresAtMs: number
}

function optionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function createTokenProvider({
  authUrl,
  credentials,
  fetch: fetchImpl,
  now = Date.now,
}: TokenProviderOptions): TokenProvider {
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

    const accessToken = optionalText(
      (payload as Record<string, unknown>).access_token,
    )
    if (accessToken === undefined) {
      throw new Error('token response carried no access_token')
    }

    const lifetimeSeconds =
      optionalNumber((payload as Record<string, unknown>).expires_in) ?? 0

    return {
      value: accessToken,
      expiresAtMs: now() + lifetimeSeconds * 1000 - TOKEN_REFRESH_MARGIN_MS,
    }
  }

  return {
    async getToken() {
      if (!credentials) return undefined
      if (cached && now() < cached.expiresAtMs) return cached.value

      // Concurrent requests must not each spend a token exchange.
      inFlight ??= requestToken().finally(() => {
        inFlight = undefined
      })

      cached = await inFlight
      return cached?.value
    },
    invalidate() {
      cached = undefined
    },
  }
}
