import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // An empty run must fail. "No tests ran" must never read as "passed".
    passWithNoTests: false,
    // config.ts validates at module load, so importing it under test needs a
    // valid environment. Every variable is pinned here, not just the required
    // ones: Vite also loads the developer's local .env in test mode, and a test
    // must not depend on whatever centre or zoom that file happens to hold.
    // The parser itself is exercised with explicit fixtures, not these values.
    env: {
      VITE_SKYSPY_HTTP: 'http://localhost:8000',
      VITE_SKYSPY_WS: 'ws://localhost:8000',
      VITE_SKYSPY_TOKEN: '',
      VITE_DEFAULT_CENTER: '0,0',
      VITE_DEFAULT_ZOOM: '6',
    },
  },
})
