import { describe, expect, it } from 'vitest'
import capturedSnapshot from '../../docs/fixtures/opensky-states-nl.json'
import { decodeStateVector } from './opensky'

/**
 * Guards the decoder against the real API rather than against hand-written
 * vectors, which is where invented shapes hide.
 */
const snapshot: unknown = capturedSnapshot

function vectors(): unknown[] {
  expect(snapshot).toBeTypeOf('object')
  const states = (snapshot as { states?: unknown }).states
  expect(Array.isArray(states)).toBe(true)
  return states as unknown[]
}

describe('the captured OpenSky snapshot', () => {
  it('decodes every vector without a single skip', () => {
    const decoded = vectors().map((vector) => decodeStateVector(vector, 0))

    expect(decoded.length).toBeGreaterThan(50)
    expect(decoded.filter((aircraft) => aircraft === null)).toEqual([])
  })

  it('yields unique lowercase hex identities', () => {
    const hexes = vectors()
      .map((vector) => decodeStateVector(vector, 0)?.hex)
      .filter((hex): hex is string => hex !== undefined)

    expect(new Set(hexes).size).toBe(hexes.length)
    for (const hex of hexes) {
      expect(hex).toMatch(/^[0-9a-f]{6}$/)
    }
  })

  it('produces plausible positions and altitudes for airborne aircraft', () => {
    const airborne = vectors()
      .map((vector) => decodeStateVector(vector, 0))
      .filter((aircraft) => aircraft?.on_ground === false)

    expect(airborne.length).toBeGreaterThan(0)

    for (const aircraft of airborne) {
      if (aircraft?.lat !== undefined) {
        expect(aircraft.lat).toBeGreaterThanOrEqual(-90)
        expect(aircraft.lat).toBeLessThanOrEqual(90)
      }
      if (aircraft?.alt_baro !== undefined) {
        expect(aircraft.alt_baro).toBeLessThan(60_000)
      }
      if (aircraft?.track !== undefined) {
        expect(aircraft.track).toBeGreaterThanOrEqual(0)
        expect(aircraft.track).toBeLessThanOrEqual(360)
      }
    }
  })

  it('contains real absent fields, so the guards are actually exercised', () => {
    const decoded = vectors()
      .map((vector) => decodeStateVector(vector, 0))
      .filter((aircraft) => aircraft !== null)

    const missingSomething = decoded.filter(
      (aircraft) =>
        aircraft.squawk === undefined ||
        aircraft.baro_rate === undefined ||
        aircraft.flight === undefined ||
        aircraft.lat === undefined,
    )

    expect(missingSomething.length).toBeGreaterThan(0)
  })
})
