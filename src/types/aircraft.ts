/**
 * The one aircraft shape the whole app agrees on, keyed by `hex` everywhere.
 *
 * Every field except `hex` and the two client-recorded ones is optional. A
 * source can omit anything, so guard every read.
 */
export interface Aircraft {
  /** ICAO 24 bit identifier, lowercase. The identity key. */
  hex: string
  /** Callsign, already trimmed of the padding sources send it with. */
  flight?: string
  lat?: number
  lon?: number
  /** Barometric altitude in feet. */
  alt_baro?: number
  /** Ground speed in knots. */
  gs?: number
  /** Heading in degrees. */
  track?: number
  squawk?: string
  /** Vertical speed in feet per minute. */
  baro_rate?: number
  on_ground?: boolean
  /** Range from the receiver in nautical miles. No OpenSky equivalent. */
  distance_nm?: number
  /**
   * When the source last heard from the aircraft, epoch seconds. Distinct from
   * `lastSeen`: polling returns vectors that were already minutes old, and a
   * map that cannot tell those apart looks healthy while showing stale traffic.
   */
  lastContact?: number
  /** Client-recorded receipt time in epoch milliseconds, never from the payload. */
  lastSeen: number
  /** Derived by the store, not by the transport. */
  stale: boolean
}
