/**
 * The shared proxy router instance for the Vercel entrypoints.
 *
 * Named with a leading underscore so Vercel treats it as a library file rather
 * than a route. Module scope means a warm instance reuses its OpenSky token.
 */

import { createProxyRouter } from '../src/server/router.ts'

export const router = createProxyRouter(
  process.env,
  // Wrapped rather than passed by reference: an unbound global fetch throws an
  // illegal invocation in some runtimes.
  (url, init) => fetch(url, init),
)

export function notFound(): Response {
  return new Response(JSON.stringify({ error: 'not-found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}
