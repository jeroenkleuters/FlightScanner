/**
 * The projection the map layer consumes: fleet in, one GeoJSON
 * `FeatureCollection` out.
 *
 * Deliberately a pure function over an iterable rather than a store method, so
 * feature 7 can test its layer against a literal array and so nothing here
 * needs a store to exist.
 *
 * Aircraft without a position are omitted from the output but stay in the
 * store. They still count, and a later snapshot may give them a fix.
 */

import type { Aircraft } from '../types/aircraft'

/** The properties the symbol layer reads. Absent optionals are omitted. */
export interface AircraftFeatureProperties {
  hex: string
  flight?: string
  alt_baro?: number
  gs?: number
  track?: number
  stale: boolean
}

export interface AircraftFeature {
  type: 'Feature'
  geometry: { type: 'Point'; coordinates: [number, number] }
  properties: AircraftFeatureProperties
}

export interface AircraftFeatureCollection {
  type: 'FeatureCollection'
  features: AircraftFeature[]
}

/** Skips a key entirely when the value is absent; `undefined` does not survive
 * JSON serialization, and a present-but-undefined property reads differently to
 * a MapLibre expression than a missing one. */
function withOptional<T>(
  properties: AircraftFeatureProperties,
  key: keyof AircraftFeatureProperties,
  value: T | undefined,
): void {
  if (value !== undefined) {
    Object.assign(properties, { [key]: value })
  }
}

export function toGeoJSON(
  aircraft: Iterable<Aircraft>,
): AircraftFeatureCollection {
  const features: AircraftFeature[] = []

  for (const entry of aircraft) {
    if (entry.lat === undefined || entry.lon === undefined) continue

    const properties: AircraftFeatureProperties = {
      hex: entry.hex,
      stale: entry.stale,
    }
    withOptional(properties, 'flight', entry.flight)
    withOptional(properties, 'alt_baro', entry.alt_baro)
    withOptional(properties, 'gs', entry.gs)
    withOptional(properties, 'track', entry.track)

    features.push({
      type: 'Feature',
      // GeoJSON is longitude first. OpenSky sends lon at index 5 and lat at 6,
      // so this order has already been got wrong once upstream.
      geometry: { type: 'Point', coordinates: [entry.lon, entry.lat] },
      properties,
    })
  }

  return { type: 'FeatureCollection', features }
}
