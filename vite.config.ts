import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    // An empty run must fail. "No tests ran" must never read as "passed".
    passWithNoTests: false,
    // config.ts validates at module load, so importing it under test needs a
    // valid environment. The parser itself is exercised with explicit fixtures.
    env: {
      VITE_SKYSPY_HTTP: 'http://localhost:8000',
      VITE_SKYSPY_WS: 'ws://localhost:8000',
    },
  },
})
