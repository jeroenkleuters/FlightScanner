import type { ReactNode } from 'react'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Aircraft } from '../types/aircraft'
import type { AircraftStore } from '../store/aircraftStore'

interface SourceProps {
  id?: string
  type?: string
  data?: unknown
  promoteId?: string
  children?: ReactNode
}

interface LayerProps {
  id?: string
  type?: string
  layout?: Record<string, unknown>
  paint?: Record<string, unknown>
}

const lastSourceProps: { current: SourceProps | null } = { current: null }
const lastLayerProps: { current: LayerProps | null } = { current: null }

// Asynchronous, like the real maplibre-gl v6 GeoJSONSource.setData.
const setData = vi.fn<(data: unknown) => Promise<void>>(() => Promise.resolve())
/** Handlers take the synthetic map event each test hands them. */
type MapHandler = (event?: unknown) => void
const listeners = new Map<string, Set<MapHandler>>()
const canvas = { style: { cursor: '' } }
const featureState = new Map<string, Record<string, unknown>>()
const queryHits: { current: unknown[] } = { current: [] }
const mapRef = {
  getSource: vi.fn(() => ({ type: 'geojson', setData })),
  getCanvas: () => canvas,
  queryRenderedFeatures: vi.fn(() => queryHits.current),
  setFeatureState: vi.fn(
    (target: { id: string }, state: Record<string, unknown>) => {
      featureState.set(target.id, state)
    },
  ),
  removeFeatureState: vi.fn((target: { id: string }) => {
    featureState.delete(target.id)
  }),
  on: vi.fn((...args: unknown[]) => {
    const key =
      args.length === 3
        ? `${args[0] as string}:${args[1] as string}`
        : (args[0] as string)
    const handler = args[args.length - 1] as MapHandler
    const set = listeners.get(key) ?? new Set()
    set.add(handler)
    listeners.set(key, set)
  }),
  off: vi.fn((...args: unknown[]) => {
    const key =
      args.length === 3
        ? `${args[0] as string}:${args[1] as string}`
        : (args[0] as string)
    listeners.get(key)?.delete(args[args.length - 1] as MapHandler)
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
  Popup: (props: { children?: ReactNode }) => (
    <div data-testid="tooltip">{props.children}</div>
  ),
}))

const registerAircraftIcon = vi.fn(() => Promise.resolve())
vi.mock('./aircraftIcon', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./aircraftIcon')>()),
  registerAircraftIcon: () => registerAircraftIcon(),
}))

const { AircraftLayer } = await import('./AircraftLayer')
const { AIRCRAFT_LAYER_ID, AIRCRAFT_SOURCE_ID } =
  await import('./aircraftStyle')

/** Fires every handler registered for an event, scoped to a layer or not. */
function fire(key: string, event?: unknown): void {
  act(() => {
    for (const handler of listeners.get(key) ?? []) {
      handler(event)
    }
  })
}

const featureOf = (hex: string, flight?: string) => ({
  properties: flight === undefined ? { hex } : { hex, flight },
})

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
  canvas.style.cursor = ''
  featureState.clear()
  queryHits.current = []
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
    render(
      <AircraftLayer
        store={fakeStore([]).store}
        selectedHex={null}
        onSelect={vi.fn()}
      />,
    )

    expect(lastSourceProps.current?.id).toBe(AIRCRAFT_SOURCE_ID)
    expect(lastSourceProps.current?.type).toBe('geojson')
    expect(lastLayerProps.current?.id).toBe(AIRCRAFT_LAYER_ID)
    expect(lastLayerProps.current?.type).toBe('symbol')
  })

  it('starts the source empty and fills it through setData, not through props', () => {
    const { store } = fakeStore([aircraft('abc123', 4.9, 52.3)])
    render(
      <AircraftLayer store={store} selectedHex={null} onSelect={vi.fn()} />,
    )

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
    render(
      <AircraftLayer store={store} selectedHex={null} onSelect={vi.fn()} />,
    )
    flushFrames()
    setData.mockClear()

    act(() => notify())
    flushWindow()

    expect(setData).toHaveBeenCalledTimes(1)
  })

  it('coalesces a burst of notifications into one setData', () => {
    const { store, notify } = fakeStore([aircraft('abc123', 4.9, 52.3)])
    render(
      <AircraftLayer store={store} selectedHex={null} onSelect={vi.fn()} />,
    )
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
    render(
      <AircraftLayer store={store} selectedHex={null} onSelect={vi.fn()} />,
    )
    flushFrames()
    setData.mockClear()

    act(() => {
      for (const handler of listeners.get('styledata') ?? []) handler()
    })
    flushWindow()

    expect(setData).toHaveBeenCalledTimes(1)
  })

  it('registers the icon on mount and again when the style drops it', () => {
    render(
      <AircraftLayer
        store={fakeStore([]).store}
        selectedHex={null}
        onSelect={vi.fn()}
      />,
    )

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
    const view = render(
      <AircraftLayer store={store} selectedHex={null} onSelect={vi.fn()} />,
    )
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
    render(
      <AircraftLayer store={store} selectedHex={null} onSelect={vi.fn()} />,
    )
    flushFrames()
    await act(async () => {
      await Promise.resolve()
    })

    expect(consoleError).toHaveBeenCalledWith(
      'Aircraft layer could not update the fleet',
      expect.any(Error),
    )
  })

  describe('selection', () => {
    const renderWith = (selectedHex: string | null, onSelect = vi.fn()) => {
      const view = render(
        <AircraftLayer
          store={fakeStore([]).store}
          selectedHex={selectedHex}
          onSelect={onSelect}
        />,
      )
      return { view, onSelect }
    }

    it('selects the aircraft that was clicked', () => {
      const { onSelect } = renderWith(null)

      fire(`click:${AIRCRAFT_LAYER_ID}`, { features: [featureOf('abc123')] })

      expect(onSelect).toHaveBeenCalledWith('abc123')
    })

    it('ignores a layer click carrying no usable feature', () => {
      const { onSelect } = renderWith(null)

      fire(`click:${AIRCRAFT_LAYER_ID}`, { features: [] })

      expect(onSelect).not.toHaveBeenCalled()
    })

    it('clears the selection when the click landed on empty map', () => {
      queryHits.current = []
      const { onSelect } = renderWith('abc123')

      fire('click', { point: { x: 10, y: 10 } })

      expect(onSelect).toHaveBeenCalledWith(null)
    })

    it('does not clear when the same click landed on an aircraft', () => {
      // Both handlers fire for a click on a feature; asking the map what is
      // under the pointer is what keeps them from fighting.
      queryHits.current = [featureOf('abc123')]
      const { onSelect } = renderWith(null)

      fire('click', { point: { x: 10, y: 10 } })

      expect(onSelect).not.toHaveBeenCalledWith(null)
    })

    it('clears the selection on Escape', () => {
      const { onSelect } = renderWith('abc123')

      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      })

      expect(onSelect).toHaveBeenCalledWith(null)
    })

    it('ignores other keys', () => {
      const { onSelect } = renderWith('abc123')

      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
      })

      expect(onSelect).not.toHaveBeenCalled()
    })

    it('marks the selected aircraft in feature state', () => {
      renderWith('abc123')

      expect(mapRef.setFeatureState).toHaveBeenCalledWith(
        { source: AIRCRAFT_SOURCE_ID, id: 'abc123' },
        { selected: true },
      )
      expect(featureState.get('abc123')).toEqual({ selected: true })
    })

    it('clears the previous aircraft when the selection moves', () => {
      const { view } = renderWith('abc123')

      view.rerender(
        <AircraftLayer
          store={fakeStore([]).store}
          selectedHex="def456"
          onSelect={vi.fn()}
        />,
      )

      // Two highlighted aircraft would be worse than none.
      expect(featureState.has('abc123')).toBe(false)
      expect(featureState.get('def456')).toEqual({ selected: true })
    })

    it('gives the source a promoted id, without which feature state is unaddressable', () => {
      renderWith(null)

      expect(lastSourceProps.current?.promoteId).toBe('hex')
    })

    it('dims the fleet only while something is selected', () => {
      renderWith(null)
      const unselected = lastLayerProps.current?.paint

      renderWith('abc123')
      const selected = lastLayerProps.current?.paint

      expect(selected).not.toEqual(unselected)
    })

    it('detaches every listener and resets the cursor on unmount', () => {
      const { view } = renderWith(null)
      fire(`mousemove:${AIRCRAFT_LAYER_ID}`, {
        features: [featureOf('abc123', 'KLM1944')],
        lngLat: { lng: 4.9, lat: 52.3 },
      })
      expect(canvas.style.cursor).toBe('pointer')

      view.unmount()

      expect(listeners.get(`click:${AIRCRAFT_LAYER_ID}`)?.size ?? 0).toBe(0)
      expect(listeners.get('click')?.size ?? 0).toBe(0)
      expect(listeners.get(`mousemove:${AIRCRAFT_LAYER_ID}`)?.size ?? 0).toBe(0)
      expect(listeners.get(`mouseleave:${AIRCRAFT_LAYER_ID}`)?.size ?? 0).toBe(
        0,
      )
      // A pointer cursor left behind would outlive the component.
      expect(canvas.style.cursor).toBe('')
    })
  })

  describe('hover tooltip', () => {
    const renderPlain = () =>
      render(
        <AircraftLayer
          store={fakeStore([]).store}
          selectedHex={null}
          onSelect={vi.fn()}
        />,
      )

    it('shows the callsign and a pointer cursor', () => {
      renderPlain()

      fire(`mousemove:${AIRCRAFT_LAYER_ID}`, {
        features: [featureOf('abc123', 'KLM1944')],
        lngLat: { lng: 4.9, lat: 52.3 },
      })

      expect(screen.getByTestId('tooltip').textContent).toBe('KLM1944')
      expect(canvas.style.cursor).toBe('pointer')
    })

    it('falls back to the hex when the aircraft sent no callsign', () => {
      renderPlain()

      fire(`mousemove:${AIRCRAFT_LAYER_ID}`, {
        features: [featureOf('abc123')],
        lngLat: { lng: 4.9, lat: 52.3 },
      })

      // An empty tooltip would read as a broken one.
      expect(screen.getByTestId('tooltip').textContent).toBe('abc123')
    })

    it('disappears and restores the cursor on mouseleave', () => {
      renderPlain()
      fire(`mousemove:${AIRCRAFT_LAYER_ID}`, {
        features: [featureOf('abc123', 'KLM1944')],
        lngLat: { lng: 4.9, lat: 52.3 },
      })

      fire(`mouseleave:${AIRCRAFT_LAYER_ID}`)

      expect(screen.queryByTestId('tooltip')).toBeNull()
      expect(canvas.style.cursor).toBe('')
    })
  })

  it('waits for the map instead of throwing when there is none yet', () => {
    currentMap.current = undefined

    expect(() =>
      render(
        <AircraftLayer
          store={fakeStore([]).store}
          selectedHex={null}
          onSelect={vi.fn()}
        />,
      ),
    ).not.toThrow()
    expect(setData).not.toHaveBeenCalled()
  })
})
