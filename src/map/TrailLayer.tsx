import { useEffect, useState } from 'react'
import { Layer, Source } from 'react-map-gl/maplibre'
import type { AircraftStore } from '../store/aircraftStore'
import {
  appendPosition,
  createTrailBuffer,
  trackAircraft,
  type TrailBuffer,
} from '../store/trailBuffer'
import { AIRCRAFT_LAYER_ID, AIRCRAFT_PALETTE } from './aircraftStyle'

export const TRAIL_SOURCE_ID = 'aircraft-trail'
export const TRAIL_LAYER_ID = 'aircraft-trail-line'

export interface TrailLayerProps {
  store: AircraftStore
  selectedHex: string | null
}

/**
 * The recent track of the selected aircraft, as one line beneath the fleet.
 *
 * This one *does* live in React state, unlike the fleet. The trail is a handful
 * of points for a single aircraft changing about twice a minute, so the
 * reconciler is not the bottleneck the fleet's hundreds of features would make
 * it, and holding it in state keeps the buffer pure and trivially testable.
 *
 * The line is client-side history only: it starts empty at selection and grows
 * from that moment. It is not the flight's full track and must never be
 * presented as one.
 */
export function TrailLayer({ store, selectedHex }: TrailLayerProps) {
  const [buffer, setBuffer] = useState<TrailBuffer>(createTrailBuffer)

  // Derived during render, not synced in an effect. Retargeting clears the
  // points unless the selection is unchanged, and seeding from the position the
  // store already holds means the trail does not wait a whole poll for its
  // first point. Both operations are pure and return the same buffer when
  // nothing changed, so this settles in one render rather than cascading.
  const tracked = appendPosition(
    trackAircraft(buffer, selectedHex),
    selectedHex === null ? undefined : store.get(selectedHex),
  )
  if (tracked !== buffer) setBuffer(tracked)

  useEffect(() => {
    if (selectedHex === null) return

    return store.subscribe(() => {
      setBuffer((current) => appendPosition(current, store.get(selectedHex)))
    })
  }, [store, selectedHex])

  // A LineString needs two points. One point is a selection that has not moved
  // yet, and MapLibre would reject the geometry.
  if (tracked.points.length < 2) return null

  return (
    <Source
      id={TRAIL_SOURCE_ID}
      type="geojson"
      data={{
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: tracked.points.map((point) => [point.lon, point.lat]),
        },
      }}
    >
      <Layer
        id={TRAIL_LAYER_ID}
        type="line"
        // Explicitly beneath the fleet, so an icon is never hidden behind its
        // own trail. JSX order alone would not guarantee it after a style change.
        beforeId={AIRCRAFT_LAYER_ID}
        layout={{ 'line-cap': 'round', 'line-join': 'round' }}
        paint={{
          'line-color': AIRCRAFT_PALETTE.trail.color,
          'line-width': AIRCRAFT_PALETTE.trail.width,
          'line-opacity': 0.8,
        }}
      />
    </Source>
  )
}

export default TrailLayer
