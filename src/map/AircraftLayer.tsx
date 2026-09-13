import type { GeoJSONSource } from 'maplibre-gl'
import { useEffect, useMemo } from 'react'
import { Layer, Source, useMap } from 'react-map-gl/maplibre'
import { toGeoJSON } from '../store/aircraftGeoJSON'
import type { AircraftStore } from '../store/aircraftStore'
import { registerAircraftIcon } from './aircraftIcon'
import {
  AIRCRAFT_LAYER_ID,
  AIRCRAFT_SOURCE_ID,
  aircraftLayout,
  aircraftPaint,
  emptyFeatureCollection,
} from './aircraftStyle'
import { createFrameScheduler, createThrottle } from './throttle'

/**
 * How long one `setData` window lasts. Polling is far slower than this, so it
 * only bites when something other than a poll drives an update.
 */
const UPDATE_INTERVAL_MS = 250

export interface AircraftLayerProps {
  store: AircraftStore
}

/**
 * The fleet, as one GeoJSON source and one symbol layer.
 *
 * The declarative half is the source and layer. The imperative half is the
 * data: fleet updates go straight to `setData` and never through React state.
 * Hundreds of aircraft replaced twice a minute is exactly the work the
 * reconciler is worst at, and redrawing is the map's job, not React's.
 */
export function AircraftLayer({ store }: AircraftLayerProps) {
  const { current: map } = useMap()

  // Created once. The source's real contents arrive through `setData` below;
  // this is only what it holds before the first snapshot.
  const initialData = useMemo(() => emptyFeatureCollection(), [])

  // The icon, registered before anything draws and again whenever the style
  // drops it. A style change wipes the image registry; the layer survives but
  // has nothing to draw with, which looks exactly like an empty sky.
  useEffect(() => {
    if (!map) return

    let cancelled = false
    const register = () => {
      if (cancelled) return
      void registerAircraftIcon(map)
    }

    register()
    // Fires precisely when a layer asks for an image the style does not have,
    // which is the moment after a style swap that matters here.
    map.on('styleimagemissing', register)

    return () => {
      cancelled = true
      map.off('styleimagemissing', register)
    }
  }, [map])

  // The data path: one store notification becomes at most one setData.
  useEffect(() => {
    if (!map) return

    const throttled = createThrottle<void>(
      () => {
        const source = map.getSource<GeoJSONSource>(AIRCRAFT_SOURCE_ID)
        // Absent for a moment on first paint and after a style change, while
        // react-map-gl adds the source. Dropping the update is safe because
        // `styledata` below schedules another one once it exists.
        if (source?.type === 'geojson') {
          // Asynchronous since maplibre-gl v6. A rejection means the fleet did
          // not draw, which is worth saying out loud: it does not reach the
          // map's own error event, so FlightMap would never report it.
          source.setData(toGeoJSON(store.values())).catch((error: unknown) => {
            console.error('Aircraft layer could not update the fleet', error)
          })
        }
      },
      { intervalMs: UPDATE_INTERVAL_MS, scheduler: createFrameScheduler() },
    )

    const update = () => throttled.call(undefined)

    // The store may already hold a snapshot when this mounts, and no further
    // notification is owed for one that already landed.
    update()
    // Redraws the fleet once the style settles. Without this a mount that beats
    // the source into existence shows nothing until the next poll, which on a
    // 30 s floor is a long blank map.
    map.on('styledata', update)
    const unsubscribe = store.subscribe(update)

    return () => {
      unsubscribe()
      map.off('styledata', update)
      throttled.cancel()
    }
  }, [map, store])

  return (
    <Source id={AIRCRAFT_SOURCE_ID} type="geojson" data={initialData}>
      <Layer
        id={AIRCRAFT_LAYER_ID}
        type="symbol"
        layout={aircraftLayout}
        paint={aircraftPaint}
      />
    </Source>
  )
}

export default AircraftLayer
