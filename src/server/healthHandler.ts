/**
 * `GET /api/health` - the proxy is the only thing with a health check, because
 * it is the only thing that can be down independently of the static bundle.
 *
 * Makes no upstream call, so it costs no credit, and reveals no URL or secret.
 */

import { errorResponse, jsonResponse } from './response.ts'

export interface HealthHandlerDeps {
  hasCredentials: boolean
}

export function handleHealthRequest(
  request: Request,
  { hasCredentials }: HealthHandlerDeps,
): Response {
  if (request.method !== 'GET') {
    return errorResponse('method-not-allowed', 405)
  }

  return jsonResponse({
    status: 'ok',
    credentials: hasCredentials ? 'configured' : 'anonymous',
  })
}
