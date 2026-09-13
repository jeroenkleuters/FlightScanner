/**
 * React binding for the fleet.
 *
 * Only the count crosses into React. The store itself stays a mutable `Map`
 * outside the render path, and feature 7 will subscribe to it directly rather
 * than reading aircraft through state.
 */

import { useEffect, useState } from 'react'
import { createAircraftStore, type AircraftStore } from './aircraftStore'

export interface UseAircraftStoreResult {
  store: AircraftStore
  /**
   * Aircraft currently held, which is the fleet and not the last snapshot.
   * Undefined until the first snapshot lands, because an empty box and a poll
   * that has not answered yet are different things and only one of them is
   * honestly "0 aircraft".
   */
  count?: number
}

export function useAircraftStore(): UseAircraftStoreResult {
  // One store per mount. The lazy initializer runs once, so a re-render never
  // builds a second one, and the store itself never changes identity.
  const [store] = useState<AircraftStore>(createAircraftStore)

  const [count, setCount] = useState<number | undefined>(undefined)

  useEffect(() => {
    // Subscribing is all this needs: the listener fires once per snapshot, so
    // the first call is also the signal that a snapshot has arrived at all.
    return store.subscribe(() => setCount(store.size))
  }, [store])

  return { store, count }
}
