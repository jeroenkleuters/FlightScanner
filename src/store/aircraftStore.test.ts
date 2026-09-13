import { describe, expect, it, vi } from 'vitest'
import type { StatesSnapshot } from '../api/opensky'
import type { Aircraft } from '../types/aircraft'
import {
  createAircraftStore,
  DROP_AFTER_MS,
  STALE_AFTER_SECONDS,
} from './aircraftStore'

/** A decoded aircraft as the transport would hand it over. */
function aircraft(hex: string, overrides: Partial<Aircraft> = {}): Aircraft {
  return {
    hex,
    lastSeen: 0,
    stale: false,
    ...overrides,
  }
}

function snapshot(
  aircraftList: Aircraft[],
  time = 1_700_000_000,
): StatesSnapshot {
  return { time, aircraft: aircraftList }
}

/** A clock the test moves by hand, in milliseconds. */
function clock(start = 1_000_000) {
  let current = start
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms
    },
  }
}

describe('aircraft store reconciliation', () => {
  it('inserts every aircraft from the first snapshot', () => {
    const store = createAircraftStore()

    store.applySnapshot(snapshot([aircraft('abc123'), aircraft('def456')]))

    expect(store.size).toBe(2)
    expect(store.get('abc123')?.hex).toBe('abc123')
    expect(store.get('def456')?.hex).toBe('def456')
  })

  it('updates a shared hex in place rather than duplicating it', () => {
    const store = createAircraftStore()

    store.applySnapshot(snapshot([aircraft('abc123', { lat: 52, lon: 4 })]))
    store.applySnapshot(snapshot([aircraft('abc123', { lat: 53, lon: 5 })]))

    expect(store.size).toBe(1)
    expect(store.get('abc123')?.lat).toBe(53)
    expect(store.get('abc123')?.lon).toBe(5)
  })

  it('holds the union of aircraft still current across snapshots', () => {
    const store = createAircraftStore()

    store.applySnapshot(snapshot([aircraft('abc123')]))
    store.applySnapshot(snapshot([aircraft('abc123'), aircraft('def456')]))

    expect([...store.values()].map((entry) => entry.hex).sort()).toEqual([
      'abc123',
      'def456',
    ])
  })

  it('takes the last entry when one snapshot repeats a hex', () => {
    const store = createAircraftStore()

    store.applySnapshot(
      snapshot([
        aircraft('abc123', { alt_baro: 1000 }),
        aircraft('abc123', { alt_baro: 2000 }),
      ]),
    )

    expect(store.size).toBe(1)
    expect(store.get('abc123')?.alt_baro).toBe(2000)
  })

  it('stamps lastSeen from its own clock, not the payload', () => {
    const time = clock(5_000_000)
    const store = createAircraftStore({ now: time.now })

    store.applySnapshot(snapshot([aircraft('abc123', { lastSeen: 42 })]))

    expect(store.get('abc123')?.lastSeen).toBe(5_000_000)
  })

  it('never reads the ambient clock', () => {
    const spy = vi.spyOn(Date, 'now')
    const time = clock()
    const store = createAircraftStore({ now: time.now })

    store.applySnapshot(snapshot([aircraft('abc123')]))

    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('aircraft store removal', () => {
  it('drops an aircraft 30 s after the last snapshot that held it', () => {
    const time = clock()
    const store = createAircraftStore({ now: time.now })

    store.applySnapshot(snapshot([aircraft('abc123'), aircraft('def456')]))
    time.advance(DROP_AFTER_MS)
    store.applySnapshot(snapshot([aircraft('def456')]))

    expect(store.get('abc123')).toBeUndefined()
    expect(store.get('def456')).toBeDefined()
  })

  it('keeps an aircraft absent for less than 30 s', () => {
    const time = clock()
    const store = createAircraftStore({ now: time.now })

    store.applySnapshot(snapshot([aircraft('abc123')]))
    time.advance(DROP_AFTER_MS - 1)
    store.applySnapshot(snapshot([]))

    expect(store.get('abc123')).toBeDefined()
  })

  it('treats an empty snapshot as a valid empty box, not an error', () => {
    const time = clock()
    const store = createAircraftStore({ now: time.now })

    store.applySnapshot(snapshot([aircraft('abc123')]))
    expect(() => store.applySnapshot(snapshot([]))).not.toThrow()
    expect(store.size).toBe(1)

    time.advance(DROP_AFTER_MS)
    store.applySnapshot(snapshot([]))
    expect(store.size).toBe(0)
  })

  it('removes nothing while no snapshot arrives, however much time passes', () => {
    const time = clock()
    const store = createAircraftStore({ now: time.now })

    store.applySnapshot(snapshot([aircraft('abc123')]))
    time.advance(DROP_AFTER_MS * 10)

    // An outage delivers no snapshot, so the fleet must survive it intact.
    expect(store.size).toBe(1)
    expect(store.get('abc123')).toBeDefined()
  })

  it('keeps an aircraft alive for as long as it keeps appearing', () => {
    const time = clock()
    const store = createAircraftStore({ now: time.now })

    for (let poll = 0; poll < 5; poll += 1) {
      store.applySnapshot(snapshot([aircraft('abc123')]))
      time.advance(DROP_AFTER_MS)
    }
    store.applySnapshot(snapshot([aircraft('abc123')]))

    expect(store.get('abc123')).toBeDefined()
  })
})

describe('aircraft store staleness', () => {
  const TIME = 1_700_000_000

  it('flags an aircraft whose fix is older than the threshold', () => {
    const store = createAircraftStore()

    store.applySnapshot(
      snapshot(
        [aircraft('abc123', { lastContact: TIME - STALE_AFTER_SECONDS - 1 })],
        TIME,
      ),
    )

    expect(store.get('abc123')?.stale).toBe(true)
  })

  it('leaves an aircraft inside the threshold fresh', () => {
    const store = createAircraftStore()

    store.applySnapshot(
      snapshot(
        [aircraft('abc123', { lastContact: TIME - STALE_AFTER_SECONDS })],
        TIME,
      ),
    )

    expect(store.get('abc123')?.stale).toBe(false)
  })

  it('never flags an aircraft that reports no lastContact', () => {
    const store = createAircraftStore()

    store.applySnapshot(snapshot([aircraft('abc123')], TIME))

    expect(store.get('abc123')?.stale).toBe(false)
  })

  it('treats a fix dated ahead of the snapshot as fresh, not stale', () => {
    const store = createAircraftStore()

    store.applySnapshot(
      snapshot([aircraft('abc123', { lastContact: TIME + 600 })], TIME),
    )

    expect(store.get('abc123')?.stale).toBe(false)
  })

  it('overwrites whatever staleness the transport decoded', () => {
    const store = createAircraftStore()

    store.applySnapshot(
      snapshot([aircraft('abc123', { lastContact: TIME, stale: true })], TIME),
    )

    expect(store.get('abc123')?.stale).toBe(false)
  })

  it('recomputes staleness for an aircraft the newest snapshot omits', () => {
    const time = clock()
    const store = createAircraftStore({ now: time.now })

    store.applySnapshot(
      snapshot([aircraft('abc123', { lastContact: TIME })], TIME),
    )
    expect(store.get('abc123')?.stale).toBe(false)

    // It is still inside the drop window, but its fix has aged past the
    // threshold while it went unmentioned.
    time.advance(DROP_AFTER_MS - 1)
    store.applySnapshot(snapshot([], TIME + STALE_AFTER_SECONDS + 1))

    expect(store.get('abc123')?.stale).toBe(true)
  })

  it('can flag an aircraft that is present in every single snapshot', () => {
    const time = clock()
    const store = createAircraftStore({ now: time.now })

    // Heard from OpenSky on every poll, but always reporting an old fix.
    for (let poll = 0; poll < 3; poll += 1) {
      const at = TIME + poll * 30
      store.applySnapshot(
        snapshot([aircraft('abc123', { lastContact: at - 300 })], at),
      )
      time.advance(30_000)
    }

    expect(store.get('abc123')).toBeDefined()
    expect(store.get('abc123')?.stale).toBe(true)
  })

  it('clears the flag again once a fresh fix arrives', () => {
    const time = clock()
    const store = createAircraftStore({ now: time.now })

    store.applySnapshot(
      snapshot([aircraft('abc123', { lastContact: TIME - 600 })], TIME),
    )
    expect(store.get('abc123')?.stale).toBe(true)

    time.advance(30_000)
    store.applySnapshot(
      snapshot([aircraft('abc123', { lastContact: TIME + 30 })], TIME + 30),
    )

    expect(store.get('abc123')?.stale).toBe(false)
  })
})

describe('aircraft store subscription', () => {
  it('notifies once per snapshot regardless of aircraft count', () => {
    const store = createAircraftStore()
    const listener = vi.fn()
    store.subscribe(listener)

    store.applySnapshot(
      snapshot(
        Array.from({ length: 50 }, (_, index) => aircraft(`hex${index}`)),
      ),
    )

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('notifies only after the fleet has settled', () => {
    const time = clock()
    const store = createAircraftStore({ now: time.now })
    let sizeWhenNotified = -1
    store.subscribe(() => {
      sizeWhenNotified = store.size
    })

    store.applySnapshot(snapshot([aircraft('abc123'), aircraft('def456')]))
    time.advance(DROP_AFTER_MS)
    store.applySnapshot(snapshot([aircraft('def456')]))

    // The dropped aircraft is already gone by the time anyone reads the store.
    expect(sizeWhenNotified).toBe(1)
  })

  it('stops calling a listener once it unsubscribes', () => {
    const store = createAircraftStore()
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    store.applySnapshot(snapshot([]))
    unsubscribe()
    store.applySnapshot(snapshot([]))

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('runs the remaining listeners when one throws', () => {
    const store = createAircraftStore()
    const failed = vi.spyOn(console, 'error').mockImplementation(() => {})
    const after = vi.fn()

    store.subscribe(() => {
      throw new Error('subscriber blew up')
    })
    store.subscribe(after)

    expect(() =>
      store.applySnapshot(snapshot([aircraft('abc123')])),
    ).not.toThrow()
    expect(after).toHaveBeenCalledTimes(1)
    expect(store.get('abc123')).toBeDefined()

    failed.mockRestore()
  })

  it('does not skip a listener when an earlier one unsubscribes mid-notify', () => {
    const store = createAircraftStore()
    const second = vi.fn()

    const unsubscribeFirst = store.subscribe(() => unsubscribeFirst())
    store.subscribe(second)

    store.applySnapshot(snapshot([]))

    expect(second).toHaveBeenCalledTimes(1)
  })
})
