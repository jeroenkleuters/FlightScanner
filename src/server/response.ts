/**
 * Proxy response helpers.
 *
 * Every route is same-origin by design. No handler sets
 * `Access-Control-Allow-Origin`: a wildcard would let any site on the internet
 * spend this account's daily OpenSky credit budget.
 */

export type ProxyErrorCode =
  | 'invalid-request'
  | 'method-not-allowed'
  | 'rate-limited'
  | 'proxy-misconfigured'
  | 'credentials-rejected'
  | 'upstream-unavailable'
  | 'upstream-malformed'

export function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...init.headers,
    },
  })
}

/**
 * The only shape an error ever takes. Upstream body text and header values
 * never travel back to the client, so nothing upstream can leak through here.
 */
export function errorResponse(code: ProxyErrorCode, status: number): Response {
  return jsonResponse({ error: code }, { status })
}
