import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Connect, type Plugin } from 'vite'
// Extension included deliberately: Vite's native config loader resolves
// config imports itself and warns without one. Every module reachable from
// here, meaning all of src/server, follows the same rule.
import { createProxyRouter } from './src/server/router.ts'

/**
 * Mounts the real proxy routes on the dev and preview servers.
 *
 * The proxy is required in every environment, not just production: the browser
 * cannot reach OpenSky at all. This runs the same router the Vercel functions
 * run, so local behavior cannot drift from what ships.
 */
function proxyPlugin(mode: string): Plugin {
  // The empty prefix loads unprefixed variables too. The OpenSky credentials are
  // deliberately not VITE_ prefixed, so they never reach the client bundle.
  const env = { ...process.env, ...loadEnv(mode, process.cwd(), '') }
  const router = createProxyRouter(env, (url, init) => fetch(url, init))

  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    const host = req.headers.host ?? 'localhost'
    const url = new URL(req.url ?? '/', `http://${host}`)
    const pending = router.handle(new Request(url, { method: req.method }))

    if (pending === undefined) {
      next()
      return
    }

    pending
      .then(async (response) => {
        res.statusCode = response.status
        response.headers.forEach((value, key) => res.setHeader(key, value))
        res.end(Buffer.from(await response.arrayBuffer()))
      })
      .catch(next)
  }

  return {
    name: 'flightscanner-proxy',
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), proxyPlugin(mode)],
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    // The dev-only mock feed lives outside src and is plain Node ESM, but its
    // projection maths is exactly the kind of silent-wrong-answer logic the
    // test gate exists for.
    include: ['src/**/*.test.{ts,tsx}', 'mock/**/*.test.mjs'],
    // An empty run must fail. "No tests ran" must never read as "passed".
    passWithNoTests: false,
    // config.ts validates at module load, so importing it under test needs a
    // valid environment. Every variable is pinned here, not just the required
    // ones: Vite also loads the developer's local .env in test mode, and a test
    // must not depend on whatever centre or zoom that file happens to hold.
    // The parser itself is exercised with explicit fixtures, not these values.
    env: {
      VITE_DEFAULT_CENTER: '0,0',
      VITE_DEFAULT_ZOOM: '6',
    },
  },
}))
