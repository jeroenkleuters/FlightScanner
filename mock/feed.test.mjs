// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
  ABSENCE_SECONDS,
  CYCLE_SECONDS,
  hashHex,
  isPresent,
  loadFixtureStates,
  projectStates,
  visibleStates,
} from './feed.mjs'

const NOW = 1_789_300_000

/**
 * A vector in OpenSky's wire order, overridden by index. Written out rather
 * than borrowed from the fixture so each case states exactly what it exercises.
 */
function vector(overrides = {}) {
  const base = [
    'abc123',
    'TEST123 ',
    'Netherlands',
    1789292595,
    1789292595,
    5.0, // lon
    52.0, // lat
    10000, // baro_alt
    false, // on_ground
    250, // velocity, m/s
    90, // true_track, degrees
    0, // vertical_rate, m/s
    null,
    10300, // geo_alt
    '1000',
    false,
    0,
  ]
  for (const [index, value] of Object.entries(overrides)) {
    base[Number(index)] = value
  }
  return base
}

const LONGITUDE = 5
const LATITUDE = 6
const BARO_ALTITUDE = 7
const GEO_ALTITUDE = 13
const TIME_POSITION = 3
const LAST_CONTACT = 4

describe('projectStates', () => {
  it('dead-reckons 250 m/s due east into the expected distance', () => {
    const [moved] = projectStates([vector()], 600, NOW)

    // 250 m/s for 600 s is 150 km. At 52 degrees north a degree of longitude is
    // about 68.7 km, so the aircraft gains roughly 2.18 degrees of longitude.
    const metresPerDegreeLon = 111_320 * Math.cos((52 * Math.PI) / 180)
    expect(moved[LONGITUDE] - 5.0).toBeCloseTo(150_000 / metresPerDegreeLon, 2)

    // A constant initial bearing is a great circle, not a rhumb line, so due
    // east at this latitude bends very slightly toward the equator. That is the
    // path a real aircraft flies, and it is why this is not asserted as zero.
    expect(moved[LATITUDE]).toBeLessThan(52.0)
    expect(52.0 - moved[LATITUDE]).toBeLessThan(0.03)
  })

  it('leaves a vector with no velocity exactly where it was', () => {
    const [moved] = projectStates([vector({ 9: null })], 600, NOW)

    expect(moved[LONGITUDE]).toBe(5.0)
    expect(moved[LATITUDE]).toBe(52.0)
  })

  it('leaves a vector with no track exactly where it was', () => {
    const [moved] = projectStates([vector({ 10: null })], 600, NOW)

    expect(moved[LONGITUDE]).toBe(5.0)
    expect(moved[LATITUDE]).toBe(52.0)
  })

  it('keeps a positionless vector positionless', () => {
    const [moved] = projectStates([vector({ 5: null, 6: null })], 600, NOW)

    expect(moved[LONGITUDE]).toBeNull()
    expect(moved[LATITUDE]).toBeNull()
  })

  it('climbs and descends at the vertical rate', () => {
    const [climbing] = projectStates([vector({ 11: 5 })], 60, NOW)
    expect(climbing[BARO_ALTITUDE]).toBeCloseTo(10_300, 6)
    expect(climbing[GEO_ALTITUDE]).toBeCloseTo(10_600, 6)

    const [descending] = projectStates([vector({ 11: -5 })], 60, NOW)
    expect(descending[BARO_ALTITUDE]).toBeCloseTo(9700, 6)
  })

  it('never drives an altitude below zero', () => {
    const [landed] = projectStates([vector({ 11: -20 })], 3600, NOW)

    expect(landed[BARO_ALTITUDE]).toBe(0)
    expect(landed[GEO_ALTITUDE]).toBe(0)
  })

  it('keeps a null altitude null', () => {
    const [moved] = projectStates([vector({ 7: null, 11: 5 })], 600, NOW)

    expect(moved[BARO_ALTITUDE]).toBeNull()
  })

  it('taxis an aircraft on the ground without changing its altitude', () => {
    const [taxiing] = projectStates(
      [vector({ 7: 0, 8: true, 9: 2, 11: 5 })],
      600,
      NOW,
    )

    expect(taxiing[BARO_ALTITUDE]).toBe(0)
    expect(taxiing[LONGITUDE]).toBeGreaterThan(5.0)
  })

  it('refreshes both contact times to the supplied now', () => {
    const [moved] = projectStates([vector()], 600, NOW)

    expect(moved[TIME_POSITION]).toBe(NOW)
    expect(moved[LAST_CONTACT]).toBe(NOW)
  })

  it('does not mutate the source vector', () => {
    const source = vector()
    projectStates([source], 600, NOW)

    expect(source[LONGITUDE]).toBe(5.0)
    expect(source[LAST_CONTACT]).toBe(1789292595)
  })

  it('is a pure function of elapsed time', () => {
    const first = projectStates(loadFixtureStates(), 420, NOW)
    const second = projectStates(loadFixtureStates(), 420, NOW)

    expect(first).toEqual(second)
  })
})

describe('isPresent', () => {
  const hex = '4acb58'
  const offset = hashHex(hex) % CYCLE_SECONDS
  /** The elapsed time at which this aircraft's absence begins. */
  const absenceStart = (CYCLE_SECONDS - offset + CYCLE_SECONDS) % CYCLE_SECONDS

  it('drops the aircraft for exactly the absence window', () => {
    expect(isPresent(hex, absenceStart - 1)).toBe(true)
    expect(isPresent(hex, absenceStart)).toBe(false)
    expect(isPresent(hex, absenceStart + ABSENCE_SECONDS - 1)).toBe(false)
    expect(isPresent(hex, absenceStart + ABSENCE_SECONDS)).toBe(true)
  })

  it('repeats every cycle', () => {
    for (const cycle of [1, 2, 7]) {
      const shift = cycle * CYCLE_SECONDS
      expect(isPresent(hex, absenceStart + shift)).toBe(false)
      expect(isPresent(hex, absenceStart + ABSENCE_SECONDS + shift)).toBe(true)
    }
  })

  it('is absent for the documented share of each cycle', () => {
    let absent = 0
    for (let second = 0; second < CYCLE_SECONDS; second += 1) {
      if (!isPresent(hex, second)) absent += 1
    }

    expect(absent).toBe(ABSENCE_SECONDS)
  })

  it('staggers the fleet rather than dropping it all at once', () => {
    const states = loadFixtureStates()
    const absent = states.filter((state) => !isPresent(state[0], 0))

    expect(absent.length).toBeGreaterThan(0)
    expect(absent.length).toBeLessThan(states.length / 4)
  })
})

describe('visibleStates', () => {
  it('returns the projected fleet minus the aircraft currently absent', () => {
    const states = loadFixtureStates()
    const visible = visibleStates(states, 420, NOW)
    const expected = states.filter((state) => isPresent(state[0], 420))

    expect(visible.length).toBe(expected.length)
    expect(visible.length).toBeLessThan(states.length)
    expect(visible.every((state) => state[LAST_CONTACT] === NOW)).toBe(true)
  })

  it('brings an aircraft back under the same hex it left with', () => {
    const hex = '4acb58'
    const offset = hashHex(hex) % CYCLE_SECONDS
    const absenceStart =
      (CYCLE_SECONDS - offset + CYCLE_SECONDS) % CYCLE_SECONDS
    const states = loadFixtureStates()

    const during = visibleStates(states, absenceStart + 10, NOW).map(
      (s) => s[0],
    )
    const after = visibleStates(
      states,
      absenceStart + ABSENCE_SECONDS + 10,
      NOW,
    ).map((s) => s[0])

    expect(during).not.toContain(hex)
    expect(after).toContain(hex)
  })
})
