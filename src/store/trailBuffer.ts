/**
 * The recent track of the one selected aircraft.
 *
 * Deliberately outside the aircraft store and deliberately single-aircraft:
 * OpenSky returns no position history, so every point here is one this client
 * watched arrive. Buffering the whole fleet would multiply render cost and grow
 * without bound across a long session; buffering one costs nothing when nothing
 * is selected.
 *
 * Immutable: every operation returns a new buffer. The trail changes about
 * twice a minute, so this is cheap, and it makes the buffer safe to hold in
 * React state - unlike the fleet, which must never go through the reconciler.
 *
 * Pure. No React, no map, no store imports beyond the shared aircraft type.
 */

import type { Aircraft } from '../types/aircraft'

/**
 * Roughly an hour and a half of 30 s polls. Long enough to show where an
 * aircraft came from, short enough that the line stays cheap to draw.
 */
export const TRAIL_CAPACITY = 200

export interface TrailPoint {
  lon: number
  lat: number
}

export interface TrailBuffer {
  /** The aircraft these points belong to, or null when nothing is selected. */
  hex: string | null
  points: readonly TrailPoint[]
}

export function createTrailBuffer(): TrailBuffer {
  return { hex: null, points: [] }
}

/**
 * Points at a different aircraft, discarding whatever was there.
 *
 * Cleared, never merged: a line that jumps from one aircraft to another is a
 * confusing bug, not a longer trail. Re-selecting the same aircraft keeps the
 * buffer, so a stray re-render cannot wipe a trail that took minutes to build.
 */
export function trackAircraft(
  buffer: TrailBuffer,
  hex: string | null,
): TrailBuffer {
  if (buffer.hex === hex) return buffer
  return { hex, points: [] }
}

/**
 * Records where the tracked aircraft is now.
 *
 * Ignores anything that is not the tracked aircraft, anything without a fix -
 * `toGeoJSON` drops those from the map too - and any repeat of the position
 * already at the head, so a stale contact repeated across polls does not pile
 * up identical points.
 */
export function appendPosition(
  buffer: TrailBuffer,
  aircraft: Aircraft | undefined,
): TrailBuffer {
  if (!aircraft || buffer.hex === null || aircraft.hex !== buffer.hex) {
    return buffer
  }
  if (aircraft.lat === undefined || aircraft.lon === undefined) return buffer

  const latest = buffer.points[buffer.points.length - 1]
  if (latest && latest.lat === aircraft.lat && latest.lon === aircraft.lon) {
    return buffer
  }

  const points = [...buffer.points, { lon: aircraft.lon, lat: aircraft.lat }]
  // Oldest first, so the drop is from the front once the cap is reached.
  return {
    hex: buffer.hex,
    points:
      points.length > TRAIL_CAPACITY
        ? points.slice(points.length - TRAIL_CAPACITY)
        : points,
  }
}
