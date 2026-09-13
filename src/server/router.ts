/**
 * One dispatcher for both proxy routes, shared by the Vercel entrypoints and
 * the Vite dev and preview servers. Dev and production run the same code rather
 * than a dev-only rewrite that can drift from what ships.
 *
 * The token provider lives on the router instance, so a serverless instance
 * reuses its token across invocations. That is best effort: a recycled instance
 * or a cold start simply exchanges again.
 */

import { readServerEnv, ServerConfigError, type RawServerEnv } from './env.ts'
import { handleHealthRequest } from './healthHandler.ts'
import {
  createTokenProvider,
  type FetchLike,
  type TokenProvider,
} from './openskyToken.ts'
import { errorResponse } from './response.ts'
import { handleStatesRequest } from './statesHandler.ts'

export const STATES_PATH = '/api/opensky/states'
export const HEALTH_PATH = '/api/health'

export interface ProxyRouter {
  /** Undefined for a path this proxy does not own, so callers can fall through. */
  handle(request: Request): Promise<Response> | undefined
}

interface ReadyProxy {
  apiBase: string
  hasCredentials: boolean
  tokenProvider: TokenProvider
}

function prepare(
  rawEnv: RawServerEnv,
  fetchImpl: FetchLike,
): ReadyProxy | undefined {
  try {
    const env = readServerEnv(rawEnv)
    return {
      apiBase: env.apiBase,
      hasCredentials: env.credentials !== undefined,
      tokenProvider: createTokenProvider({
        authUrl: env.authUrl,
        credentials: env.credentials,
        fetch: fetchImpl,
      }),
    }
  } catch (error) {
    if (!(error instanceof ServerConfigError)) throw error
    return undefined
  }
}

export function createProxyRouter(
  rawEnv: RawServerEnv,
  fetchImpl: FetchLike,
): ProxyRouter {
  const ready = prepare(rawEnv, fetchImpl)

  return {
    handle(request) {
      const { pathname } = new URL(request.url)
      if (pathname !== STATES_PATH && pathname !== HEALTH_PATH) return undefined

      // A misconfigured proxy is reported, never quietly downgraded to anonymous.
      if (ready === undefined) {
        return Promise.resolve(errorResponse('proxy-misconfigured', 500))
      }

      if (pathname === HEALTH_PATH) {
        return Promise.resolve(
          handleHealthRequest(request, {
            hasCredentials: ready.hasCredentials,
          }),
        )
      }

      return handleStatesRequest(request, {
        apiBase: ready.apiBase,
        tokenProvider: ready.tokenProvider,
        fetch: fetchImpl,
      })
    },
  }
}
