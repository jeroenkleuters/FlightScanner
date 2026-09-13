/**
 * The pure core of the mock feed: a captured OpenSky snapshot projected forward
 * in time.
 *
 * Everything here is a function of elapsed time alone. Nothing accumulates, so
 * two calls at the same elapsed time return identical data and a reset
 * reproduces a run exactly. That is also why churn is a hash of the hex rather
 * than a random draw: a bug in the store must be reproducible.
 *
 * State vectors stay in OpenSky's positional wire order throughout. This module
 * converts no units and builds no objects; `src/api/opensky.ts` owns all of
 * that, and a mock that decoded first would stop exercising it.
 */

import { readFileSync } from 'node:fs'

/** Positions in an OpenSky state vector, which is an array and not an object. */
const ICAO24 = 0
const TIME_POSITION = 3
const LAST_CONTACT = 4
const LONGITUDE = 5
const LATITUDE = 6
const BARO_ALTITUDE = 7
const ON_GROUND = 8
const VELOCITY = 9
const TRUE_TRACK = 10
const VERTICAL_RATE = 11
const GEO_ALTITUDE = 13

/** IUGG mean Earth radius, metres. */
export const EARTH_RADIUS_M = 6371008.8

/**
 * Churn: every aircraft disappears for `ABSENCE_SECONDS` out of every
 * `CYCLE_SECONDS`, at an offset derived from its hex.
 *
 * The absence deliberately exceeds the store's 30 s removal rule, so at a 30 s
 * poll at least one snapshot omits the aircraft, the rule actually fires, and
 * the return is a genuine insert rather than an update. A shorter absence would
 * leave the reconciler untested, which is the whole reason this exists.
 */
export const CYCLE_SECONDS = 600
export const ABSENCE_SECONDS = 45

const FIXTURE_URL = new URL(
  '../docs/fixtures/opensky-states-nl.json',
  import.meta.url,
)

/**
 * Read rather than imported: `tsconfig.api.json` and `tsconfig.node.json` have
 * no `resolveJsonModule`, and this tree stays outside every tsconfig program.
 */
export function loadFixtureStates() {
  const payload = JSON.parse(readFileSync(FIXTURE_URL, 'utf8'))
  return Array.isArray(payload.states) ? payload.states : []
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

const toRadians = (degrees) => (degrees * Math.PI) / 180
const toDegrees = (radians) => (radians * 180) / Math.PI

/** Into -180..180, so a projection that crosses the antimeridian stays valid. */
function normalizeLongitude(lon) {
  return ((((lon + 180) % 360) + 360) % 360) - 180
}

/**
 * Spherical destination point: where something at `lat`/`lon` ends up after
 * travelling `distanceM` along a constant `bearingDegrees`.
 */
export function destinationPoint(lat, lon, bearingDegrees, distanceM) {
  const angular = distanceM / EARTH_RADIUS_M
  const bearing = toRadians(bearingDegrees)
  const lat1 = toRadians(lat)
  const lon1 = toRadians(lon)

  const sinLat2 =
    Math.sin(lat1) * Math.cos(angular) +
    Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing)
  const lat2 = Math.asin(sinLat2)
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * sinLat2,
    )

  return { lat: toDegrees(lat2), lon: normalizeLongitude(toDegrees(lon2)) }
}

/** FNV-1a, 32 bit. Chosen for being short, stable, and well spread. */
export function hashHex(icao24) {
  let hash = 2166136261
  for (let index = 0; index < icao24.length; index += 1) {
    hash ^= icao24.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/**
 * Whether an aircraft appears in the snapshot at this point in the cycle.
 * Roughly 7.5% of the fleet is absent at any moment.
 */
export function isPresent(icao24, elapsedSeconds) {
  const offset = hashHex(icao24) % CYCLE_SECONDS
  const phase =
    (((elapsedSeconds + offset) % CYCLE_SECONDS) + CYCLE_SECONDS) %
    CYCLE_SECONDS
  return phase >= ABSENCE_SECONDS
}

/**
 * Dead-reckons one vector forward. Anything the fixture left null stays null:
 * real captures are full of holes, and a mock that quietly filled them would
 * stop exercising the decoder's guarded reads.
 */
function projectVector(vector, elapsedSeconds, nowSeconds) {
  const next = vector.slice()

  const velocity = next[VELOCITY]
  const track = next[TRUE_TRACK]
  const lat = next[LATITUDE]
  const lon = next[LONGITUDE]

  if (
    isFiniteNumber(velocity) &&
    isFiniteNumber(track) &&
    isFiniteNumber(lat) &&
    isFiniteNumber(lon)
  ) {
    const moved = destinationPoint(lat, lon, track, velocity * elapsedSeconds)
    next[LATITUDE] = moved.lat
    next[LONGITUDE] = moved.lon
  }

  // An aircraft on the ground taxis but does not climb, however its last
  // vertical rate happened to read.
  if (next[ON_GROUND] !== true) {
    const rate = next[VERTICAL_RATE]
    if (isFiniteNumber(rate)) {
      const delta = rate * elapsedSeconds
      if (isFiniteNumber(next[BARO_ALTITUDE])) {
        next[BARO_ALTITUDE] = Math.max(0, next[BARO_ALTITUDE] + delta)
      }
      if (isFiniteNumber(next[GEO_ALTITUDE])) {
        next[GEO_ALTITUDE] = Math.max(0, next[GEO_ALTITUDE] + delta)
      }
    }
  }

  next[TIME_POSITION] = nowSeconds
  next[LAST_CONTACT] = nowSeconds

  return next
}

/**
 * Projects the whole snapshot. Churn is applied by the caller, not here, so a
 * test can look at movement and presence independently.
 */
export function projectStates(states, elapsedSeconds, nowSeconds) {
  return states.map((vector) =>
    projectVector(vector, elapsedSeconds, nowSeconds),
  )
}

/** The snapshot as it should appear at this moment: projected, then thinned. */
export function visibleStates(states, elapsedSeconds, nowSeconds) {
  return projectStates(states, elapsedSeconds, nowSeconds).filter((vector) =>
    isPresent(String(vector[ICAO24]), elapsedSeconds),
  )
}
