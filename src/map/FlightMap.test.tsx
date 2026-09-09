import type { ReactNode } from 'react'
import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface MockMapProps {
  children?: ReactNode
  mapStyle?: string
  initialViewState?: { longitude: number; latitude: number; zoom: number }
  onLoad?: () => void
  onError?: (event: { error: Error }) => void
}

// jsdom has no WebGL, so the real MapLibre map cannot mount. These stubs record
// the props FlightMap passes and expose its event handlers.
const lastMapProps: { current: MockMapProps | null } = { current: null }

vi.mock('react-map-gl/maplibre', () => ({
  Map: (props: MockMapProps) => {
    lastMapProps.current = props
    return <div data-testid="map">{props.children}</div>
  },
  NavigationControl: ({ position }: { position?: string }) => (
    <div data-testid="navigation-control" data-position={position} />
  ),
}))

import { toInitialViewState } from './viewState'

const { FlightMap } = await import('./FlightMap')

describe('toInitialViewState', () => {
  it('maps lat and lon onto the right axes', () => {
    expect(
      toInitialViewState({
        defaultCenter: { lat: 52.3676, lon: 4.9041 },
        defaultZoom: 7,
      }),
    ).toEqual({ longitude: 4.9041, latitude: 52.3676, zoom: 7 })
  })

  it('does not swap latitude and longitude', () => {
    const result = toInitialViewState({
      defaultCenter: { lat: 1, lon: 2 },
      defaultZoom: 0,
    })

    expect(result.latitude).toBe(1)
    expect(result.longitude).toBe(2)
  })
})

describe('FlightMap', () => {
  beforeEach(() => {
    lastMapProps.current = null
    vi.restoreAllMocks()
  })

  it('renders the map with the configured style and view state', () => {
    render(<FlightMap />)

    expect(screen.getByTestId('map')).toBeTruthy()
    expect(lastMapProps.current?.mapStyle).toBeTruthy()
    expect(lastMapProps.current?.initialViewState).toEqual({
      longitude: 0,
      latitude: 0,
      zoom: 6,
    })
  })

  it('places the navigation control bottom-right', () => {
    render(<FlightMap />)

    expect(
      screen.getByTestId('navigation-control').getAttribute('data-position'),
    ).toBe('bottom-right')
  })

  it('renders children inside the map so layers can attach', () => {
    render(
      <FlightMap>
        <div data-testid="child-layer" />
      </FlightMap>,
    )

    expect(
      screen.getByTestId('map').contains(screen.getByTestId('child-layer')),
    ).toBe(true)
  })

  it('shows the failure alert and no map when the style fails to load', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<FlightMap />)

    act(() => {
      lastMapProps.current?.onError?.({ error: new Error('style 404') })
    })

    expect(screen.getByRole('alert').textContent).toContain(
      'Could not load the map basemap',
    )
    expect(screen.queryByTestId('map')).toBeNull()
  })

  it('keeps the map visible when an error arrives after load', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<FlightMap />)

    act(() => {
      lastMapProps.current?.onLoad?.()
      lastMapProps.current?.onError?.({ error: new Error('tile 503') })
    })

    expect(screen.getByTestId('map')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
