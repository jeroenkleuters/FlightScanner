import type { AppConfig } from '../config'

type ViewConfig = Pick<AppConfig, 'defaultCenter' | 'defaultZoom'>

export interface InitialViewState {
  longitude: number
  latitude: number
  zoom: number
}

/**
 * Config uses `{ lat, lon }`; MapLibre uses `longitude` and `latitude`. This is
 * the one place the two meet, so the axis order cannot silently swap elsewhere.
 *
 * It lives outside FlightMap.tsx because that file exports a component and
 * react-refresh requires component files to export only components.
 */
export function toInitialViewState(view: ViewConfig): InitialViewState {
  return {
    longitude: view.defaultCenter.lon,
    latitude: view.defaultCenter.lat,
    zoom: view.defaultZoom,
  }
}
