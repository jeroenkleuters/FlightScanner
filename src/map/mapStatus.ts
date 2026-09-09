/**
 * Map lifecycle status, and the single place a map error is classified.
 *
 * The distinction that matters: an error before the style loads means there is
 * nothing to show, so the failure state replaces the map. An error after the
 * style loads is a tile or sprite hiccup on a working map, and must never blank
 * it.
 */
export type MapStatus = 'loading' | 'ready' | 'failed'

export type MapStatusEvent = 'load' | 'error'

export const INITIAL_MAP_STATUS: MapStatus = 'loading'

export function nextMapStatus(
  current: MapStatus,
  event: MapStatusEvent,
): MapStatus {
  if (event === 'load') return 'ready'
  return current === 'loading' ? 'failed' : current
}
