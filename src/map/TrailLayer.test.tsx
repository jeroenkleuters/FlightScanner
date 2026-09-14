import type { ReactNode } from 'react'
import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AircraftStore } from '../store/aircraftStore'
import type { Aircraft } from '../types/aircraft'

interface SourceProps {
  id?: string
  type?: string
  data?: unknown
  children?: ReactNode
}

interface LayerProps {
  id?: string
  type?: string
  beforeId?: string
  paint?: Record<string, unknown>
}

const lastSourceProps: { current: SourceProps | null } = { current: null }
const lastLayerProps: { current: LayerProps | null } = { current: null }

vi.mock('react-map-gl/maplibre', () => ({
  Source: (props: SourceProps) => {
    lastSourceProps.current = props
    return <div data-testid="trail-source">{props.children}</div>
  },
  Layer: (props: LayerProps) => {
    lastLayerProps.current = props
    return <div data-testid="trail-layer" />
  },
}))

const { TrailLayer, TRAIL_LAYER_ID } = await import('./TrailLayer')
const { AIRCRAFT_LAYER_ID } = await import('./aircraftStyle')

function aircraft(hex: string, lon: number, lat: number): Aircraft {
  return { hex, lon, lat, lastSeen: 0, stale: false }
}

function fakeStore(initial: Aircraft | undefined) {
  let held = initial
  let listener: (() => void) | undefined
  const store = {
    applySnapshot: vi.fn(),
    subscribe: (next: () => void) => {
      listener = next
      return vi.fn()
    },
    get: () => held,
    values: () => [].values() as never,
    size: 0,
  } as unknown as AircraftStore

  return {
    store,
    push(next: Aircraft | undefined) {
      held = next
      act(() => listener?.())
    },
  }
}

const coordinates = () =>
  (
    lastSourceProps.current?.data as {
      geometry: { coordinates: [number, number][] }
    }
  ).geometry.coordinates

beforeEach(() => {
  lastSourceProps.current = null
  lastLayerProps.current = null
})

describe('TrailLayer', () => {
  it('renders nothing when no aircraft is selected', () => {
    const { container } = render(
      <TrailLayer store={fakeStore(undefined).store} selectedHex={null} />,
    )

    expect(container.firstChild).toBeNull()
  })

  it('renders nothing from a single point, which is not a line yet', () => {
    const { container } = render(
      <TrailLayer
        store={fakeStore(aircraft('abc123', 4.9, 52.3)).store}
        selectedHex="abc123"
      />,
    )

    // MapLibre would reject a one-coordinate LineString.
    expect(container.firstChild).toBeNull()
  })

  it('draws the line once the aircraft has moved', () => {
    const fake = fakeStore(aircraft('abc123', 4.9, 52.3))
    render(<TrailLayer store={fake.store} selectedHex="abc123" />)

    fake.push(aircraft('abc123', 5.0, 52.4))

    expect(coordinates()).toEqual([
      [4.9, 52.3],
      [5.0, 52.4],
    ])
  })

  it('sits beneath the aircraft, so an icon is never hidden by its own trail', () => {
    const fake = fakeStore(aircraft('abc123', 4.9, 52.3))
    render(<TrailLayer store={fake.store} selectedHex="abc123" />)
    fake.push(aircraft('abc123', 5.0, 52.4))

    expect(lastLayerProps.current?.id).toBe(TRAIL_LAYER_ID)
    expect(lastLayerProps.current?.beforeId).toBe(AIRCRAFT_LAYER_ID)
    expect(lastLayerProps.current?.type).toBe('line')
  })

  it('starts from the position the store already holds, not the next poll', () => {
    // Waiting for a poll would leave the trail empty for up to 30 s.
    const fake = fakeStore(aircraft('abc123', 4.9, 52.3))
    render(<TrailLayer store={fake.store} selectedHex="abc123" />)

    fake.push(aircraft('abc123', 5.0, 52.4))

    expect(coordinates()).toHaveLength(2)
  })

  it('drops the old trail when the selection moves to another aircraft', () => {
    const fake = fakeStore(aircraft('abc123', 4.9, 52.3))
    const view = render(<TrailLayer store={fake.store} selectedHex="abc123" />)
    fake.push(aircraft('abc123', 5.0, 52.4))
    expect(coordinates()).toHaveLength(2)

    fake.push(aircraft('def456', 6.0, 53.0))
    view.rerender(<TrailLayer store={fake.store} selectedHex="def456" />)

    // A line leaping between two aircraft would be a bug, not a longer trail.
    expect(view.container.firstChild).toBeNull()
  })

  it('clears the trail on deselect', () => {
    const fake = fakeStore(aircraft('abc123', 4.9, 52.3))
    const view = render(<TrailLayer store={fake.store} selectedHex="abc123" />)
    fake.push(aircraft('abc123', 5.0, 52.4))

    view.rerender(<TrailLayer store={fake.store} selectedHex={null} />)

    expect(view.container.firstChild).toBeNull()
  })
})
