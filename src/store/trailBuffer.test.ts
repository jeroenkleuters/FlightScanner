import { describe, expect, it } from 'vitest'
import type { Aircraft } from '../types/aircraft'
import {
  TRAIL_CAPACITY,
  appendPosition,
  createTrailBuffer,
  trackAircraft,
} from './trailBuffer'

function aircraft(
  hex: string,
  lon: number | undefined,
  lat: number | undefined,
): Aircraft {
  return { hex, lon, lat, lastSeen: 0, stale: false }
}

describe('trackAircraft', () => {
  it('starts empty and pointed at nothing', () => {
    expect(createTrailBuffer()).toEqual({ hex: null, points: [] })
  })

  it('clears the points when the selection changes', () => {
    let buffer = trackAircraft(createTrailBuffer(), 'aaa111')
    buffer = appendPosition(buffer, aircraft('aaa111', 4, 52))

    const switched = trackAircraft(buffer, 'bbb222')

    // Merging would draw a line leaping between two aircraft.
    expect(switched).toEqual({ hex: 'bbb222', points: [] })
  })

  it('keeps the trail when the same aircraft is re-selected', () => {
    let buffer = trackAircraft(createTrailBuffer(), 'aaa111')
    buffer = appendPosition(buffer, aircraft('aaa111', 4, 52))

    // A re-render must not wipe a trail that took minutes to build.
    expect(trackAircraft(buffer, 'aaa111')).toBe(buffer)
  })

  it('clears everything on deselect', () => {
    let buffer = trackAircraft(createTrailBuffer(), 'aaa111')
    buffer = appendPosition(buffer, aircraft('aaa111', 4, 52))

    expect(trackAircraft(buffer, null)).toEqual({ hex: null, points: [] })
  })
})

describe('appendPosition', () => {
  const tracking = () => trackAircraft(createTrailBuffer(), 'aaa111')

  it('records the tracked aircraft, longitude first', () => {
    const buffer = appendPosition(tracking(), aircraft('aaa111', 4.9, 52.3))

    expect(buffer.points).toEqual([{ lon: 4.9, lat: 52.3 }])
  })

  it('grows as the aircraft moves', () => {
    let buffer = appendPosition(tracking(), aircraft('aaa111', 4.9, 52.3))
    buffer = appendPosition(buffer, aircraft('aaa111', 5.0, 52.4))

    expect(buffer.points).toHaveLength(2)
  })

  it('ignores a position that has not changed', () => {
    // A stale contact repeats across polls; it must not pile up points.
    let buffer = appendPosition(tracking(), aircraft('aaa111', 4.9, 52.3))
    buffer = appendPosition(buffer, aircraft('aaa111', 4.9, 52.3))

    expect(buffer.points).toHaveLength(1)
  })

  it('ignores an aircraft with no fix', () => {
    const buffer = appendPosition(
      tracking(),
      aircraft('aaa111', undefined, undefined),
    )

    expect(buffer.points).toEqual([])
  })

  it('ignores a different aircraft', () => {
    const buffer = appendPosition(tracking(), aircraft('bbb222', 4.9, 52.3))

    expect(buffer.points).toEqual([])
  })

  it('ignores everything while nothing is tracked', () => {
    const buffer = appendPosition(
      createTrailBuffer(),
      aircraft('aaa111', 4.9, 52.3),
    )

    expect(buffer.points).toEqual([])
  })

  it('discards the oldest point once the cap is reached', () => {
    let buffer = tracking()
    for (let i = 0; i < TRAIL_CAPACITY + 10; i += 1) {
      buffer = appendPosition(buffer, aircraft('aaa111', i / 100, 52))
    }

    expect(buffer.points).toHaveLength(TRAIL_CAPACITY)
    // The first ten are gone, and the newest is still at the end.
    expect(buffer.points[0]).toEqual({ lon: 10 / 100, lat: 52 })
    expect(buffer.points[buffer.points.length - 1]).toEqual({
      lon: (TRAIL_CAPACITY + 9) / 100,
      lat: 52,
    })
  })

  it('never mutates the buffer it was given', () => {
    const before = tracking()
    appendPosition(before, aircraft('aaa111', 4.9, 52.3))

    expect(before.points).toEqual([])
  })
})
