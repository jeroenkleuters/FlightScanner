/**
 * Source, layer, and layout for the fleet, as plain data.
 *
 * Kept out of the component so the style contract is unit tested without WebGL
 * or a rendered map. jsdom cannot draw the layer; it can assert what the layer
 * was asked to draw.
 */

import type { SymbolLayerSpecification } from 'react-map-gl/maplibre'
import type { AircraftFeatureCollection } from '../store/aircraftGeoJSON'
import { AIRCRAFT_ICON_ID } from './aircraftIcon'

export const AIRCRAFT_SOURCE_ID = 'aircraft'
export const AIRCRAFT_LAYER_ID = 'aircraft-symbols'

/**
 * What the source holds until the first snapshot lands. A fresh object per call
 * rather than a shared constant: MapLibre keeps a reference to whatever it is
 * given, and a shared mutable literal is the kind of thing a later feature
 * mutates by accident.
 */
export function emptyFeatureCollection(): AircraftFeatureCollection {
  return { type: 'FeatureCollection', features: [] }
}

export const aircraftLayout = {
  'icon-image': AIRCRAFT_ICON_ID,
  // `toGeoJSON` omits absent optionals rather than writing undefined, so a
  // heading-less aircraft has no `track` key at all. `coalesce` turns that into
  // 0 rotation; `['get', 'track']` alone would yield null and rotate nothing
  // predictably. Missing heading must never drop the aircraft.
  'icon-rotate': ['coalesce', ['get', 'track'], 0],
  // Rotation is relative to the map, not the viewport: a heading of 90 must
  // point east on the ground, not east on the screen.
  'icon-rotation-alignment': 'map',
  // Aircraft cluster hard over an airport. Collision detection would hide most
  // of them, which reads as missing traffic rather than dense traffic.
  'icon-allow-overlap': true,
  'icon-ignore-placement': true,
} as const satisfies SymbolLayerSpecification['layout']

/**
 * An SDF image has no colour of its own: MapLibre paints it with `icon-color`,
 * which defaults to black. Black aircraft over the Dark Matter basemap are
 * invisible, so the fleet needs a legible default before it needs a palette.
 *
 * Feature 8 replaces this flat colour with the altitude ramp. Until then this
 * is what makes the layer readable at all, which is why it is not deferred with
 * the rest of the styling.
 */
export const aircraftPaint = {
  'icon-color': '#e6e6e6',
} as const satisfies SymbolLayerSpecification['paint']
