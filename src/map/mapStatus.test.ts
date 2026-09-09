import { describe, expect, it } from 'vitest'
import {
  INITIAL_MAP_STATUS,
  nextMapStatus,
  type MapStatus,
  type MapStatusEvent,
} from './mapStatus'

describe('nextMapStatus', () => {
  it('starts in loading', () => {
    expect(INITIAL_MAP_STATUS).toBe('loading')
  })

  it.each<[MapStatus, MapStatusEvent, MapStatus]>([
    ['loading', 'load', 'ready'],
    ['loading', 'error', 'failed'],
    ['ready', 'error', 'ready'],
    ['ready', 'load', 'ready'],
    ['failed', 'load', 'ready'],
    ['failed', 'error', 'failed'],
  ])('%s + %s -> %s', (current, event, expected) => {
    expect(nextMapStatus(current, event)).toBe(expected)
  })

  it('keeps a loaded map visible when a tile error arrives later', () => {
    const loaded = nextMapStatus(INITIAL_MAP_STATUS, 'load')
    expect(loaded).toBe('ready')
    expect(nextMapStatus(loaded, 'error')).toBe('ready')
  })
})
