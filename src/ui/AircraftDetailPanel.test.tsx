import { act, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AircraftStore } from '../store/aircraftStore'
import type { Aircraft } from '../types/aircraft'
import { AircraftDetailPanel } from './AircraftDetailPanel'

function fakeStore(initial: Aircraft | undefined) {
  let held = initial
  let listener: (() => void) | undefined
  const store = {
    applySnapshot: vi.fn(),
    subscribe: (next: () => void) => {
      listener = next
      return vi.fn()
    },
    get: () => held,
    values: () => [held].filter(Boolean).values() as never,
    get size() {
      return held ? 1 : 0
    },
  } as unknown as AircraftStore

  return {
    store,
    /** Replaces what the store holds and notifies, as a poll would. */
    push(next: Aircraft | undefined) {
      held = next
      act(() => listener?.())
    },
  }
}

const full: Aircraft = {
  hex: 'abc123',
  flight: 'KLM1944',
  lat: 52.3,
  lon: 4.9,
  alt_baro: 31000,
  gs: 430,
  track: 125,
  squawk: '1000',
  baro_rate: -640,
  on_ground: false,
  lastSeen: 1_000_000,
  stale: false,
}

const bare: Aircraft = { hex: 'def456', lastSeen: 1_000_000, stale: false }

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1_000_000)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('AircraftDetailPanel', () => {
  it('renders nothing when there is no selection', () => {
    const { container } = render(
      <AircraftDetailPanel
        store={fakeStore(full).store}
        hex={null}
        onClose={vi.fn()}
      />,
    )

    expect(container.firstChild).toBeNull()
  })

  it('shows every telemetry field for a fully reporting aircraft', () => {
    render(
      <AircraftDetailPanel
        store={fakeStore(full).store}
        hex="abc123"
        onClose={vi.fn()}
      />,
    )

    const panel = screen.getByRole('region', { name: 'Aircraft detail' })
    expect(within(panel).getByText('KLM1944')).toBeTruthy()
    expect(within(panel).getByText('abc123')).toBeTruthy()
    expect(within(panel).getByText('31000 ft')).toBeTruthy()
    expect(within(panel).getByText('430 kt')).toBeTruthy()
    expect(within(panel).getByText('125 °')).toBeTruthy()
    expect(within(panel).getByText('-640 ft/min')).toBeTruthy()
    expect(within(panel).getByText('1000')).toBeTruthy()
    expect(within(panel).getByText('No')).toBeTruthy()
  })

  it('dashes every absent field rather than inventing a zero', () => {
    render(
      <AircraftDetailPanel
        store={fakeStore(bare).store}
        hex="def456"
        onClose={vi.fn()}
      />,
    )

    // A missing squawk must never read as squawk 0.
    const panel = screen.getByRole('region', { name: 'Aircraft detail' })
    expect(within(panel).getAllByText('—').length).toBeGreaterThanOrEqual(6)
    expect(within(panel).queryByText('0')).toBeNull()
  })

  it('prints a real zero as zero', () => {
    // alt_baro 0 is an aircraft on the ground, not a missing reading.
    const grounded: Aircraft = {
      ...bare,
      alt_baro: 0,
      gs: 0,
      on_ground: true,
    }
    render(
      <AircraftDetailPanel
        store={fakeStore(grounded).store}
        hex="def456"
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('0 ft')).toBeTruthy()
    expect(screen.getByText('0 kt')).toBeTruthy()
    expect(screen.getByText('Yes')).toBeTruthy()
  })

  it('reserves the identity slot for features 13 and 14', () => {
    render(
      <AircraftDetailPanel
        store={fakeStore(full).store}
        hex="abc123"
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByTestId('identity-slot')).toBeTruthy()
  })

  it('closes through a visible control, not only Esc', () => {
    const onClose = vi.fn()
    render(
      <AircraftDetailPanel
        store={fakeStore(full).store}
        hex="abc123"
        onClose={onClose}
      />,
    )

    screen.getByRole('button', { name: 'Close aircraft detail' }).click()

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  describe('the three lifecycle states', () => {
    it('is quiet while the contact is live', () => {
      render(
        <AircraftDetailPanel
          store={fakeStore(full).store}
          hex="abc123"
          onClose={vi.fn()}
        />,
      )

      expect(screen.queryByRole('status')).toBeNull()
    })

    it('says so when the store flags the contact stale', () => {
      const fake = fakeStore(full)
      render(
        <AircraftDetailPanel
          store={fake.store}
          hex="abc123"
          onClose={vi.fn()}
        />,
      )

      fake.push({ ...full, stale: true })

      expect(screen.getByRole('status').textContent).toContain('Stale contact')
      // Still showing telemetry, just marked: the numbers are real, only old.
      expect(screen.getByText('31000 ft')).toBeTruthy()
    })

    it('says signal lost when the store drops the aircraft', () => {
      const fake = fakeStore(full)
      render(
        <AircraftDetailPanel
          store={fake.store}
          hex="abc123"
          onClose={vi.fn()}
        />,
      )

      fake.push(undefined)

      expect(screen.getByRole('status').textContent).toContain('Signal lost')
      // The frozen-confident-numbers failure this feature could most easily ship.
      expect(screen.queryByText('31000 ft')).toBeNull()
    })

    it('does not clear the selection on its own when contact is lost', () => {
      const onClose = vi.fn()
      const fake = fakeStore(full)
      render(
        <AircraftDetailPanel
          store={fake.store}
          hex="abc123"
          onClose={onClose}
        />,
      )

      fake.push(undefined)

      expect(onClose).not.toHaveBeenCalled()
      expect(
        screen.getByRole('region', { name: 'Aircraft detail' }),
      ).toBeTruthy()
    })
  })

  it('ticks the last-seen age between polls', () => {
    render(
      <AircraftDetailPanel
        store={fakeStore(full).store}
        hex="abc123"
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('0 s ago')).toBeTruthy()

    act(() => {
      vi.advanceTimersByTime(5000)
    })

    // A 30 s gap between polls must not look like a frozen panel.
    expect(screen.getByText('5 s ago')).toBeTruthy()
  })
})
