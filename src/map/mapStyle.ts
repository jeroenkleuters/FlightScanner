/**
 * The default basemap style.
 *
 * Provider: CARTO, "Dark Matter" vector style. Keyless, so the app runs with no
 * account and no API key in `.env`.
 *
 * ATTRIBUTION IS MANDATORY. The style declares the required OpenStreetMap and
 * CARTO credit, and MapLibre renders it through the attribution control. That
 * control must stay enabled: never pass `attributionControl={false}`.
 *
 * CARTO's basemaps are free to use with attribution retained. Confirm the
 * provider's current terms before any public deployment; `/release` owns that
 * check. See docs/flight-map-plan.md section 8 risk 8.
 *
 * This module reads no environment. `src/config.ts` remains the only reader of
 * `import.meta.env` and imports this constant as its fallback.
 */
export const DEFAULT_MAP_STYLE_URL =
  'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
