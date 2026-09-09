import { useCallback, useState, type ReactNode } from 'react'
import { Map, NavigationControl } from 'react-map-gl/maplibre'
import { config } from '../config'
import { INITIAL_MAP_STATUS, nextMapStatus, type MapStatus } from './mapStatus'
import { toInitialViewState } from './viewState'

export interface FlightMapProps {
  /**
   * Sources and layers for later features mount here, as children of the map.
   * They reach the map instance through react-map-gl's own context.
   */
  children?: ReactNode
}

export function FlightMap({ children }: FlightMapProps) {
  const [status, setStatus] = useState<MapStatus>(INITIAL_MAP_STATUS)

  const handleLoad = useCallback(() => {
    setStatus((current) => nextMapStatus(current, 'load'))
  }, [])

  const handleError = useCallback((event: { error: Error }) => {
    // Logged once for diagnosis. nextMapStatus decides whether it is fatal: an
    // error before load means no basemap, an error after load is a tile or
    // sprite hiccup on a map that still works.
    console.error('MapLibre error', event.error)
    setStatus((current) => nextMapStatus(current, 'error'))
  }, [])

  if (status === 'failed') {
    return (
      <div className="map-error" role="alert">
        <p>
          Could not load the map basemap. Check <code>VITE_MAP_STYLE_URL</code>{' '}
          and your network connection, then reload the page.
        </p>
      </div>
    )
  }

  return (
    <Map
      initialViewState={toInitialViewState(config)}
      mapStyle={config.mapStyleUrl}
      style={{ width: '100%', height: '100%' }}
      onLoad={handleLoad}
      onError={handleError}
    >
      <NavigationControl position="bottom-right" />
      {children}
    </Map>
  )
}

export default FlightMap
