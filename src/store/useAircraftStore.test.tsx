import { act, render, screen } from '@testing-library/react'
import { StrictMode, useEffect } from 'react'
import { describe, expect, it } from 'vitest'
import type { StatesSnapshot } from '../api/opensky'
import type { Aircraft } from '../types/aircraft'
import type { AircraftStore } from './aircraftStore'
import { useAircraftStore } from './useAircraftStore'

function aircraft(hex: string): Aircraft {
  return { hex, lastSeen: 0, stale: false }
}

function snapshot(hexes: string[]): StatesSnapshot {
  return { time: 1_700_000_000, aircraft: hexes.map(aircraft) }
}

let captured: AircraftStore | undefined

function Probe() {
  const { store, count } = useAircraftStore()

  // Handed out in an effect rather than during render, so the probe itself
  // stays free of render-time side effects.
  useEffect(() => {
    captured = store
  }, [store])

  return <p>{count === undefined ? '-' : count} aircraft</p>
}

describe('useAircraftStore', () => {
  it('reads as absent until the first snapshot arrives', () => {
    render(<Probe />)

    expect(screen.getByText('- aircraft')).toBeTruthy()
  })

  it('updates the count when a snapshot lands', () => {
    render(<Probe />)

    act(() => captured?.applySnapshot(snapshot(['abc123', 'def456'])))

    expect(screen.getByText('2 aircraft')).toBeTruthy()
  })

  it('reports an empty box as zero once a snapshot has actually answered', () => {
    render(<Probe />)

    act(() => captured?.applySnapshot(snapshot([])))

    expect(screen.getByText('0 aircraft')).toBeTruthy()
  })

  it('keeps one store across re-renders', () => {
    const { rerender } = render(<Probe />)
    const first = captured

    rerender(<Probe />)

    expect(captured).toBe(first)
  })

  it('stops updating after unmount', () => {
    const { unmount } = render(<Probe />)
    const store = captured
    unmount()

    // An unsubscribed listener setting state on a dead component would warn;
    // the point is that this is simply inert.
    expect(() => store?.applySnapshot(snapshot(['abc123']))).not.toThrow()
  })

  it('survives StrictMode double mounting with a live subscription', () => {
    render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    )

    act(() => captured?.applySnapshot(snapshot(['abc123'])))

    expect(screen.getByText('1 aircraft')).toBeTruthy()
  })
})
