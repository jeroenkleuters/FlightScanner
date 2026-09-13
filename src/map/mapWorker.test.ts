import { beforeEach, describe, expect, it, vi } from 'vitest'

const setWorkerUrl = vi.fn()

vi.mock('maplibre-gl', () => ({ setWorkerUrl }))
vi.mock('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url', () => ({
  default: '/assets/maplibre-gl-worker-test.js',
}))

describe('mapWorker', () => {
  beforeEach(() => {
    setWorkerUrl.mockClear()
    vi.resetModules()
  })

  it('registers a worker URL exactly once on import', async () => {
    await import('./mapWorker')

    expect(setWorkerUrl).toHaveBeenCalledTimes(1)
  })

  it('registers the URL Vite emitted for the worker chunk, not an empty string', async () => {
    await import('./mapWorker')

    const [url] = setWorkerUrl.mock.calls[0] as [string]
    expect(typeof url).toBe('string')
    expect(url.length).toBeGreaterThan(0)
  })
})
