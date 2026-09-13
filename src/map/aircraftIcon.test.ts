import { describe, expect, it, vi } from 'vitest'
import {
  AIRCRAFT_ICON_ID,
  registerAircraftIcon,
  type AircraftIconImage,
  type AircraftIconTarget,
} from './aircraftIcon'

/** Stands in for the decoded SVG; nothing here inspects the pixels. */
const image = {} as AircraftIconImage

function fakeMap(has: () => boolean = () => false) {
  const addImage = vi.fn<AircraftIconTarget['addImage']>()
  const map: AircraftIconTarget = { hasImage: has, addImage }
  return { map, addImage }
}

describe('registerAircraftIcon', () => {
  it('registers the icon as SDF, so feature 8 can colour it', () => {
    const { map, addImage } = fakeMap()

    return registerAircraftIcon(map, () => Promise.resolve(image)).then(() => {
      expect(addImage).toHaveBeenCalledWith(AIRCRAFT_ICON_ID, image, {
        sdf: true,
      })
    })
  })

  it('does nothing when the map already has the icon', async () => {
    const { map, addImage } = fakeMap(() => true)
    const load = vi.fn(() => Promise.resolve(image))

    await registerAircraftIcon(map, load)

    expect(load).not.toHaveBeenCalled()
    expect(addImage).not.toHaveBeenCalled()
  })

  it('does not add a duplicate when the icon arrives during the decode', async () => {
    // A second style event registering the icon while the first call is still
    // awaiting its image. addImage throws on a duplicate id.
    let present = false
    const addImage = vi.fn<AircraftIconTarget['addImage']>()
    const map: AircraftIconTarget = { hasImage: () => present, addImage }

    await registerAircraftIcon(map, () => {
      present = true
      return Promise.resolve(image)
    })

    expect(addImage).not.toHaveBeenCalled()
  })

  it('propagates a failed image load rather than registering nothing silently', async () => {
    const { map } = fakeMap()

    await expect(
      registerAircraftIcon(map, () =>
        Promise.reject(new Error('decode failed')),
      ),
    ).rejects.toThrow('decode failed')
  })
})
