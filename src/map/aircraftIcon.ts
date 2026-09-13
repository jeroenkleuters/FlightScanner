/**
 * The plane icon, and its registration with a map.
 *
 * Registered **SDF**. MapLibre honours `icon-color` only for SDF images, and
 * feature 8's altitude colour ramp drives exactly that. A non-SDF icon would
 * have to be redrawn and re-registered there.
 *
 * Split from `AircraftLayer.tsx` so the registration rules - skip when already
 * present, load once, tolerate a style change - are unit testable without WebGL
 * or a real image decode.
 */

import iconUrl from '../assets/aircraft.svg'

export const AIRCRAFT_ICON_ID = 'aircraft-icon'

/** What `addImage` accepts from us. Narrowed to what this module produces. */
export type AircraftIconImage = HTMLImageElement | ImageBitmap

/**
 * The slice of the map this module touches. Declared structurally so a test can
 * pass a plain object instead of standing up MapLibre.
 */
export interface AircraftIconTarget {
  hasImage: (id: string) => boolean
  addImage: (
    id: string,
    image: AircraftIconImage,
    options?: { sdf?: boolean },
  ) => void
}

/**
 * Decodes the SVG into something `addImage` accepts. `addImage` does not take a
 * URL, so the file has to become an image first.
 */
export function loadAircraftImage(
  url: string = iconUrl,
): Promise<AircraftIconImage> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () =>
      reject(new Error(`Could not load the aircraft icon from ${url}`))
    image.src = url
  })
}

/**
 * Adds the icon unless the map already has it.
 *
 * Guarded twice on purpose. The first guard makes a re-registration after a
 * style change free; the second covers the await, because a second style event
 * can land while the image is still decoding and `addImage` throws on a
 * duplicate id.
 */
export async function registerAircraftIcon(
  map: AircraftIconTarget,
  load: () => Promise<AircraftIconImage> = () => loadAircraftImage(),
): Promise<void> {
  if (map.hasImage(AIRCRAFT_ICON_ID)) return

  const image = await load()
  if (map.hasImage(AIRCRAFT_ICON_ID)) return

  map.addImage(AIRCRAFT_ICON_ID, image, { sdf: true })
}
