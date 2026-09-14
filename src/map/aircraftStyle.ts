/**
 * Palette, source, layer, and every style expression for the fleet, as plain
 * data.
 *
 * Kept out of the component so the style contract is unit tested without WebGL
 * or a rendered map. jsdom cannot draw the layer; it can assert what the layer
 * was asked to draw.
 *
 * Every expression is built from `AIRCRAFT_PALETTE`, so the legend and the map
 * cannot drift apart: there is one list of stops and both read it.
 */

import type { SymbolLayerSpecification } from 'react-map-gl/maplibre'
import type { AircraftFeatureCollection } from '../store/aircraftGeoJSON'
import { AIRCRAFT_ICON_ID } from './aircraftIcon'

export const AIRCRAFT_SOURCE_ID = 'aircraft'
export const AIRCRAFT_LAYER_ID = 'aircraft-symbols'

/** Callsigns appear from this zoom up. Below it the map is too dense to label. */
export const LABEL_MIN_ZOOM = 8

/**
 * The one palette. Features 9 and 15 extend this rather than inventing values.
 *
 * Altitude is a magnitude, so the ramp is **one hue stepped by lightness**, not
 * a warm-to-cool rainbow: a rainbow encodes a scale nobody can order by eye.
 * The steps are CARTO-blue 600/450/350/150, chosen for the dark map surface
 * rather than flipped from a light-mode ramp, and validated as an ordinal ramp
 * against both #1a1a19 and the basemap's own near-black: lightness monotone,
 * every adjacent gap clear, single hue (3 degree spread).
 *
 * `noAltitude` is deliberately greyscale and a full step darker than the ramp's
 * middle. An earlier mid-grey sat at almost exactly the lightness of the
 * 25,000 ft step - normal-vision delta E 14.7, under the floor of 15, meaning
 * full-colour readers could not reliably tell "no altitude" from "cruising".
 * This value clears every ramp step by at least 17.4.
 *
 * The ground step sits at 2.38:1 against the basemap, under the 3:1 mark used
 * for flat fills. That is within the ordinal ramp's allowance for the step
 * nearest the surface, and the legend carries the figures in text, so altitude
 * is never colour alone.
 */
export const AIRCRAFT_PALETTE = {
  /** Ascending by altitude. The map interpolates between these; the legend lists them. */
  altitudeStops: [
    { feet: 0, color: '#184f95', label: 'Ground' },
    { feet: 10_000, color: '#2a78d6', label: '10,000 ft' },
    { feet: 25_000, color: '#5598e7', label: '25,000 ft' },
    { feet: 40_000, color: '#b7d3f6', label: '40,000 ft +' },
  ],
  noAltitude: { color: '#6f6f68', label: 'No altitude' },
  /**
   * Selection is interface state, not a data encoding, so it sits outside the
   * ramp entirely: amber against a blue ramp is the classic colour-vision-safe
   * pair, and it clears every ramp step and the neutral by at least delta E
   * 18.3 under simulated CVD.
   */
  selected: { color: '#ffb043' },
  /**
   * Unselected aircraft while something is selected. Dimmed, never hidden:
   * at 0.3 over the dark basemap the rest of the fleet all but vanished, which
   * loses the context that makes the selected one worth looking at. The amber
   * highlight already does most of the work of separating them.
   */
  dimmedOpacity: 0.45,
  dimmedStaleOpacity: 0.3,
  /** The trail belongs to the selected aircraft, so it shares its colour. */
  trail: { color: '#ffb043', width: 2 },
  /** A frozen contact must look different from a live one at a glance. */
  staleOpacity: 0.45,
  liveOpacity: 1,
  label: { color: '#e6e6e6', haloColor: '#0b0d10' },
} as const

/**
 * What the source holds until the first snapshot lands. A fresh object per call
 * rather than a shared constant: MapLibre keeps a reference to whatever it is
 * given, and a shared mutable literal is the kind of thing a later feature
 * mutates by accident.
 */
export function emptyFeatureCollection(): AircraftFeatureCollection {
  return { type: 'FeatureCollection', features: [] }
}

type SymbolPaint = NonNullable<SymbolLayerSpecification['paint']>
type SymbolLayout = NonNullable<SymbolLayerSpecification['layout']>

/**
 * Altitude to colour.
 *
 * `alt_baro` is in **feet**: `src/api/opensky.ts` converts OpenSky's metres on
 * the way in, so these stops mean what they say.
 *
 * `has` rather than a null check, because `toGeoJSON` omits absent optionals
 * entirely. `interpolate` clamps at both ends, so the negative altitudes that
 * really do appear in the fixture take the ground colour instead of
 * extrapolating off the bottom of the ramp.
 *
 * The cast is the one place the stop list meets MapLibre's expression types:
 * they describe `interpolate` as a fixed-arity tuple, which a list spread out
 * of the palette cannot satisfy structurally. Single-sourcing the stops is
 * worth more than tuple-checking an array shape the tests assert anyway.
 */
/**
 * True for the one aircraft MapLibre has been told is selected.
 *
 * Feature state rather than a GeoJSON property on purpose: `toGeoJSON` is a
 * pure projection over the store and must not learn about selection, which
 * would couple the store to the UI and force a full `setData` on every click.
 * `boolean` with a default keeps it false for every feature never marked.
 */
const SELECTED: unknown = ['boolean', ['feature-state', 'selected'], false]

function altitudeColor(): SymbolPaint['icon-color'] {
  return [
    'case',
    ['has', 'alt_baro'],
    [
      'interpolate',
      ['linear'],
      ['get', 'alt_baro'],
      ...AIRCRAFT_PALETTE.altitudeStops.flatMap((stop) => [
        stop.feet,
        stop.color,
      ]),
    ],
    AIRCRAFT_PALETTE.noAltitude.color,
  ] as SymbolPaint['icon-color']
}

/** The altitude ramp for everyone, overridden only for the selected aircraft. */
function iconColor(): SymbolPaint['icon-color'] {
  return [
    'case',
    SELECTED,
    AIRCRAFT_PALETTE.selected.color,
    altitudeColor(),
  ] as SymbolPaint['icon-color']
}

/**
 * Opacity, and the one expression that depends on whether *anything* is
 * selected.
 *
 * Feature state answers "is this feature selected"; it cannot answer "does a
 * selection exist", which is what dimming the rest requires. So this is a
 * function of that single boolean, and the layer swaps the property when
 * selection appears or disappears - one `setPaintProperty`, not a re-render.
 *
 * The stale fade survives selection: a dimmed stale contact is dimmer still,
 * never promoted back to looking live.
 */
export function aircraftOpacity(
  hasSelection: boolean,
): SymbolPaint['icon-opacity'] {
  return [
    'case',
    SELECTED,
    AIRCRAFT_PALETTE.liveOpacity,
    ['get', 'stale'],
    hasSelection
      ? AIRCRAFT_PALETTE.dimmedStaleOpacity
      : AIRCRAFT_PALETTE.staleOpacity,
    hasSelection
      ? AIRCRAFT_PALETTE.dimmedOpacity
      : AIRCRAFT_PALETTE.liveOpacity,
  ] as SymbolPaint['icon-opacity']
}

/** Zoom to base icon size, before any selection factor. */
const ICON_SIZE_STOPS: ReadonlyArray<readonly [number, number]> = [
  [4, 0.22],
  [7, 0.35],
  [11, 0.5],
  [14, 0.6],
]

export const aircraftLayout: SymbolLayout = {
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
  // The source SVG is 64 px, which is far too large at low zoom. Scaled so an
  // aircraft is a readable mark rather than a blot across a province.
  // The zoom ramp. Two MapLibre rules constrain this, both enforced at runtime
  // and both fatal to the layer when broken: `zoom` must be the direct input of
  // a top-level `interpolate`, and **layout properties cannot read feature
  // state at all**. The second is why the selected aircraft is not enlarged
  // here - selection reads through colour and opacity, which are paint.
  'icon-size': [
    'interpolate',
    ['linear'],
    ['zoom'],
    ...ICON_SIZE_STOPS.flatMap(([zoom, size]) => [zoom, size]),
  ] as SymbolLayout['icon-size'],
  // Empty string below the threshold, so no label is laid out at all. Above it,
  // the trimmed callsign, or nothing when the aircraft never sent one.
  'text-field': [
    'step',
    ['zoom'],
    '',
    LABEL_MIN_ZOOM,
    ['coalesce', ['get', 'flight'], ''],
  ],
  // Already fetched by the basemap style, so labels need no extra glyph range.
  'text-font': ['Montserrat Medium', 'Open Sans Bold', 'Noto Sans Regular'],
  'text-size': ['interpolate', ['linear'], ['zoom'], 8, 10, 14, 12],
  // Clear of the icon, which is rotated and therefore unpredictable in shape.
  'text-anchor': 'top',
  'text-offset': [0, 1.4],
  // The contract that lets labels collide-hide while icons never do. Without
  // it a label losing its placement takes the whole symbol, icon included.
  'text-optional': true,
}

/**
 * The paint for a given selection state.
 *
 * A function rather than a constant because dimming the unselected fleet needs
 * to know a selection exists, and react-map-gl owns the layer's style: it
 * deliberately withholds `setPaintProperty` from its map ref, so the honest way
 * to change paint is to hand it a different object and let the diff apply it.
 */
export function aircraftPaintFor(hasSelection: boolean): SymbolPaint {
  return {
    'icon-color': iconColor(),
    'icon-opacity': aircraftOpacity(hasSelection),
    'text-color': AIRCRAFT_PALETTE.label.color,
    'text-halo-color': AIRCRAFT_PALETTE.label.haloColor,
    'text-halo-width': 1.2,
    'text-opacity': aircraftOpacity(hasSelection),
  }
}

/** The no-selection baseline, kept as a constant for callers that need one. */
export const aircraftPaint: SymbolPaint = {
  'icon-color': iconColor(),
  'icon-opacity': aircraftOpacity(false),
  'text-color': AIRCRAFT_PALETTE.label.color,
  'text-halo-color': AIRCRAFT_PALETTE.label.haloColor,
  'text-halo-width': 1.2,
  'text-opacity': aircraftOpacity(false),
}
