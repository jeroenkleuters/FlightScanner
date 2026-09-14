import type {
  GeoJSONSource,
  MapGeoJSONFeature,
  MapMouseEvent,
} from 'maplibre-gl'
import { useEffect, useMemo, useState } from 'react'
import { Layer, Popup, Source, useMap } from 'react-map-gl/maplibre'
import { toGeoJSON } from '../store/aircraftGeoJSON'
import type { AircraftStore } from '../store/aircraftStore'
import { registerAircraftIcon } from './aircraftIcon'
import {
  AIRCRAFT_LAYER_ID,
  AIRCRAFT_SOURCE_ID,
  aircraftLayout,
  aircraftPaintFor,
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
  selectedHex: string | null
  onSelect: (hex: string | null) => void
}

interface HoveredAircraft {
  label: string
  lon: number
  lat: number
}

/** The identity and label an aircraft feature carries for interaction. */
function readFeature(feature: MapGeoJSONFeature | undefined): {
  hex: string
  label: string
} | null {
  // Typed `unknown` rather than trusted: feature properties are whatever the
  // source put there, and both of these are optional in `toGeoJSON`.
  const hex: unknown = feature?.properties?.hex
  if (typeof hex !== 'string') return null

  const flight: unknown = feature?.properties?.flight
  // An aircraft that never sent a callsign still needs a tooltip, and its hex
  // is the identity the panel and the store use anyway.
  return {
    hex,
    label: typeof flight === 'string' && flight !== '' ? flight : hex,
  }
}

/**
 * The fleet, as one GeoJSON source and one symbol layer.
 *
 * The declarative half is the source and layer. The imperative half is the
 * data: fleet updates go straight to `setData` and never through React state.
 * Hundreds of aircraft replaced twice a minute is exactly the work the
 * reconciler is worst at, and redrawing is the map's job, not React's.
 */
export function AircraftLayer({
  store,
  selectedHex,
  onSelect,
}: AircraftLayerProps) {
  const { current: map } = useMap()
  const [hovered, setHovered] = useState<HoveredAircraft | null>(null)

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

  // Selection, deselection and hover. Registered once against the layer id, so
  // FlightMap keeps its props and no interactiveLayerIds plumbing is needed.
  useEffect(() => {
    if (!map) return

    const select = (event: { features?: MapGeoJSONFeature[] }) => {
      const feature = readFeature(event.features?.[0])
      if (feature) onSelect(feature.hex)
    }

    // Unscoped, so it also fires for clicks on an aircraft. Asking the map what
    // is under the pointer avoids depending on handler ordering between the
    // layer-scoped handler above and this one.
    const clearOnEmptyMap = (event: MapMouseEvent) => {
      const hits = map.queryRenderedFeatures(event.point, {
        layers: [AIRCRAFT_LAYER_ID],
      })
      if (hits.length === 0) onSelect(null)
    }

    const hover = (event: {
      features?: MapGeoJSONFeature[]
      lngLat: { lng: number; lat: number }
    }) => {
      const feature = readFeature(event.features?.[0])
      if (!feature) return
      map.getCanvas().style.cursor = 'pointer'
      setHovered({
        label: feature.label,
        lon: event.lngLat.lng,
        lat: event.lngLat.lat,
      })
    }

    const endHover = () => {
      map.getCanvas().style.cursor = ''
      setHovered(null)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onSelect(null)
    }

    map.on('click', AIRCRAFT_LAYER_ID, select)
    map.on('click', clearOnEmptyMap)
    map.on('mousemove', AIRCRAFT_LAYER_ID, hover)
    map.on('mouseleave', AIRCRAFT_LAYER_ID, endHover)
    window.addEventListener('keydown', onKeyDown)

    return () => {
      map.off('click', AIRCRAFT_LAYER_ID, select)
      map.off('click', clearOnEmptyMap)
      map.off('mousemove', AIRCRAFT_LAYER_ID, hover)
      map.off('mouseleave', AIRCRAFT_LAYER_ID, endHover)
      window.removeEventListener('keydown', onKeyDown)
      // Leaving a pointer cursor behind would outlive the component.
      map.getCanvas().style.cursor = ''
    }
    // `onSelect` is stable from App: a useState setter and a useCallback. Even
    // if it were not, re-registering these handlers is cheap and correct.
  }, [map, onSelect])

  // Selection is carried in MapLibre feature state, so styling it costs one
  // state write rather than rebuilding the whole feature collection.
  useEffect(() => {
    if (!map || selectedHex === null) return

    const target = { source: AIRCRAFT_SOURCE_ID, id: selectedHex }
    map.setFeatureState(target, { selected: true })

    // Cleanup runs on every selection change, which is what clears the previous
    // aircraft rather than leaving two highlighted.
    return () => {
      map.removeFeatureState(target, 'selected')
    }
  }, [map, selectedHex])

  // Dimming the rest needs to know a selection exists, which feature state
  // cannot express: it answers only "is this feature selected". Recomputed only
  // when a selection appears or disappears, not on every change of which
  // aircraft is selected.
  const hasSelection = selectedHex !== null
  const paint = useMemo(() => aircraftPaintFor(hasSelection), [hasSelection])

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
    <>
      <Source
        id={AIRCRAFT_SOURCE_ID}
        type="geojson"
        data={initialData}
        // Gives every feature a stable id taken from its hex, which is what
        // makes setFeatureState addressable at all.
        promoteId="hex"
      >
        <Layer
          id={AIRCRAFT_LAYER_ID}
          type="symbol"
          layout={aircraftLayout}
          paint={paint}
        />
      </Source>
      {hovered && (
        <Popup
          longitude={hovered.lon}
          latitude={hovered.lat}
          closeButton={false}
          closeOnClick={false}
          // The pointer is already on the aircraft; the popup must not sit
          // under it and swallow the click that selects.
          offset={16}
          className="aircraft-tooltip"
        >
          {hovered.label}
        </Popup>
      )}
    </>
  )
}

export default AircraftLayer
