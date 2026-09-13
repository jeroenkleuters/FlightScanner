import type { ReactNode } from 'react'
import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Aircraft } from '../types/aircraft'
import type { AircraftStore } from '../store/aircraftStore'

interface SourceProps {
  id?: string
  type?: string
  data?: unknown
  children?: ReactNode
}

interface LayerProps {
  id?: string
  type?: string
  layout?: Record<string, unknown>
}

const lastSourceProps: { current: SourceProps | null } = { current: null }
const lastLayerProps: { current: LayerProps | null } = { current: null }

// Asynchronous, like the real maplibre-gl v6 GeoJSONSource.setData.
const setData = vi.fn<(data: unknown) => Promise<void>>(() => Promise.resolve())
const listeners = new Map<string, Set<() => void>>()
const mapRef = {
  getSource: vi.fn(() => ({ type: 'geojson', setData })),
  on: vi.fn((event: string, handler: () => void) => {
    const set = listeners.get(event) ?? new Set()
    set.add(handler)
    listeners.set(event, set)
  }),
  off: vi.fn((event: string, handler: () => void) => {
    listeners.get(event)?.delete(handler)
  }),
}
const currentMap: { current: typeof mapRef | undefined } = { current: mapRef }

// jsdom has no WebGL, so the real map cannot mount. These stubs record what
// FlightMap's children ask the map to do, the same way FlightMap.test.tsx does.
vi.mock('react-map-gl/maplibre', () => ({
  useMap: () => ({ current: currentMap.current }),
  Source: (props: SourceProps) => {
    lastSourceProps.current = props
    return <div data-testid="source">{props.children}</div>
  },
  Layer: (props: LayerProps) => {
    lastLayerProps.current = props
    return <div data-testid="layer" />
  },
}))

const registerAircraftIcon = vi.fn(() => Promise.resolve())
vi.mock('./aircraftIcon', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./aircraftIcon')>()),
  registerAircraftIcon: () => registerAircraftIcon(),
}))

const { AircraftLayer } = await import('./AircraftLayer')
const { AIRCRAFT_LAYER_ID, AIRCRAFT_SOURCE_ID } =
  await import('./aircraftStyle')

/** Frames are captured rather than run, so the throttle can be stepped. */
let frames: Array<() => void> = []

function flushFrames(): void {
  const pending = frames
  frames = []
  act(() => {
    for (const frame of pending) frame()
  })
}

/**
 * Runs out the throttle's 250 ms window and then the frame it schedules. The
 * first update of a mount lands on a frame directly; every later one waits for
 * the window first.
 */
function flushWindow(): void {
  act(() => {
    vi.advanceTimersByTime(250)
  })
  flushFrames()
}

function aircraft(hex: string, lon: number, lat: number): Aircraft {
  return { hex, lon, lat, lastSeen: 0, stale: false }
}

function fakeStore(fleet: Aircraft[]): {
  store: AircraftStore
  notify: () => void
  unsubscribe: ReturnType<typeof vi.fn>
} {
  const unsubscribe = vi.fn()
  let listener: (() => void) | undefined
  const store = {
    applySnapshot: vi.fn(),
    subscribe: (next: () => void) => {
      listener = next
      return unsubscribe
    },
    get: vi.fn(),
    values: () => fleet.values(),
    get size() {
      return fleet.length
    },
  } as unknown as AircraftStore

  return { store, notify: () => listener?.(), unsubscribe }
}

beforeEach(() => {
  vi.useFakeTimers()
  frames = []
  listeners.clear()
  setData.mockClear()
  setData.mockImplementation(() => Promise.resolve())
  registerAircraftIcon.mockClear()
  mapRef.on.mockClear()
  mapRef.off.mockClear()
  currentMap.current = mapRef
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
    frames.push(callback)
    return frames.length
  })
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => {
    frames[handle - 1] = () => {}
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('AircraftLayer', () => {
  it('renders one geojson source and one symbol layer', () => {
    render(<AircraftLayer store={fakeStore([]).store} />)

    expect(lastSourceProps.current?.id).toBe(AIRCRAFT_SOURCE_ID)
    expect(lastSourceProps.current?.type).toBe('geojson')
    expect(lastLayerProps.current?.id).toBe(AIRCRAFT_LAYER_ID)
    expect(lastLayerProps.current?.type).toBe('symbol')
  })

  it('starts the source empty and fills it through setData, not through props', () => {
    const { store } = fakeStore([aircraft('abc123', 4.9, 52.3)])
    render(<AircraftLayer store={store} />)

    expect(lastSourceProps.current?.data).toEqual({
      type: 'FeatureCollection',
      features: [],
    })

    flushFrames()

    expect(setData).toHaveBeenCalledTimes(1)
    const collection = setData.mock.calls[0][0] as {
      features: Array<{ properties: { hex: string } }>
    }
    expect(collection.features).toHaveLength(1)
    expect(collection.features[0].properties.hex).toBe('abc123')
  })

  it('redraws the fleet when the store notifies', () => {
    const { store, notify } = fakeStore([aircraft('abc123', 4.9, 52.3)])
    render(<AircraftLayer store={store} />)
    flushFrames()
    setData.mockClear()

    act(() => notify())
    flushWindow()

    expect(setData).toHaveBeenCalledTimes(1)
  })

  it('coalesces a burst of notifications into one setData', () => {
    const { store, notify } = fakeStore([aircraft('abc123', 4.9, 52.3)])
    render(<AircraftLayer store={store} />)
    flushFrames()
    setData.mockClear()

    act(() => {
      notify()
      notify()
      notify()
    })
    flushWindow()

    expect(setData).toHaveBeenCalledTimes(1)
  })

  it('redraws once the style settles, so a first paint is never left blank', () => {
    const { store } = fakeStore([aircraft('abc123', 4.9, 52.3)])
    render(<AircraftLayer store={store} />)
    flushFrames()
    setData.mockClear()

    act(() => {
      for (const handler of listeners.get('styledata') ?? []) handler()
    })
    flushWindow()

    expect(setData).toHaveBeenCalledTimes(1)
  })

  it('registers the icon on mount and again when the style drops it', () => {
    render(<AircraftLayer store={fakeStore([]).store} />)

    expect(registerAircraftIcon).toHaveBeenCalledTimes(1)

    act(() => {
      for (const handler of listeners.get('styleimagemissing') ?? []) handler()
    })

    expect(registerAircraftIcon).toHaveBeenCalledTimes(2)
  })

  it('unsubscribes, detaches listeners, and draws nothing more after unmount', () => {
    const { store, notify, unsubscribe } = fakeStore([
      aircraft('abc123', 4.9, 52.3),
    ])
    const view = render(<AircraftLayer store={store} />)
    flushFrames()
    setData.mockClear()

    act(() => notify())
    view.unmount()
    flushWindow()

    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(listeners.get('styledata')?.size ?? 0).toBe(0)
    expect(listeners.get('styleimagemissing')?.size ?? 0).toBe(0)
    expect(setData).not.toHaveBeenCalled()
  })

  it('reports a failed redraw instead of leaving it unexplained', async () => {
    // setData rejecting means the fleet did not draw, and that failure never
    // reaches the map's own error event, so nothing else would report it.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    setData.mockImplementation(() => Promise.reject(new Error('draw failed')))

    const { store } = fakeStore([aircraft('abc123', 4.9, 52.3)])
    render(<AircraftLayer store={store} />)
    flushFrames()
    await act(async () => {
      await Promise.resolve()
    })

    expect(consoleError).toHaveBeenCalledWith(
      'Aircraft layer could not update the fleet',
      expect.any(Error),
    )
  })

  it('waits for the map instead of throwing when there is none yet', () => {
    currentMap.current = undefined

    expect(() =>
      render(<AircraftLayer store={fakeStore([]).store} />),
    ).not.toThrow()
    expect(setData).not.toHaveBeenCalled()
  })
})
