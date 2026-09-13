import { AIRCRAFT_PALETTE } from '../map/aircraftStyle'

/**
 * The altitude key.
 *
 * Reads its colours from `AIRCRAFT_PALETTE`, never its own hex values, so the
 * key and the map cannot disagree about what a colour means.
 *
 * Every row carries a figure as well as a swatch. Altitude is encoded in colour
 * alone on the map itself, so the legend is what makes it readable for anyone
 * who cannot separate two steps of a blue ramp - and it is the relief the ramp's
 * dimmest step needs against a near-black basemap.
 *
 * `pointer-events: none` in the stylesheet: this floats over the map and must
 * never swallow a drag, or the click that feature 9 will add.
 */
export function Legend() {
  return (
    <section className="legend" aria-label="Altitude key">
      <h2 className="legend-title">Altitude</h2>
      <ul className="legend-rows">
        {AIRCRAFT_PALETTE.altitudeStops.map((stop) => (
          <li key={stop.feet} className="legend-row">
            <span
              className="legend-swatch"
              style={{ background: stop.color }}
              aria-hidden="true"
            />
            {stop.label}
          </li>
        ))}
        <li className="legend-row">
          <span
            className="legend-swatch"
            style={{ background: AIRCRAFT_PALETTE.noAltitude.color }}
            aria-hidden="true"
          />
          {AIRCRAFT_PALETTE.noAltitude.label}
        </li>
      </ul>
    </section>
  )
}

export default Legend
