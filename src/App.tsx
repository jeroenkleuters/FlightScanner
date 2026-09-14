import { useCallback, useState } from 'react'
import { usePolling } from './api/usePolling'
import type { PollStatus } from './api/pollSchedule'
import { AircraftLayer } from './map/AircraftLayer'
import { FlightMap } from './map/FlightMap'
import { TrailLayer } from './map/TrailLayer'
import { useAircraftStore } from './store/useAircraftStore'
import { AircraftDetailPanel } from './ui/AircraftDetailPanel'
import { Legend } from './ui/Legend'

const STATUS_TEXT: Record<PollStatus, string> = {
  idle: 'Starting',
  polling: 'Polling',
  ok: 'Live',
  unreachable: 'Proxy unreachable, retrying',
  'budget-exhausted': 'Daily credit budget spent',
  'auth-failed': 'Credentials rejected',
}

/** Absent figures read as a dash, never as zero. */
function figure(value: number | undefined): string {
  return value === undefined ? '-' : String(value)
}

function App() {
  const { store, count } = useAircraftStore()
  // Selection is the one piece of map state React owns. It changes on a click,
  // not twice a minute for hundreds of aircraft, so the reconciler is the right
  // place for it - unlike positions, which never go through React.
  const [selectedHex, setSelectedHex] = useState<string | null>(null)
  const clearSelection = useCallback(() => setSelectedHex(null), [])

  const { status, creditsRemaining } = usePolling({
    onSnapshot: store.applySnapshot,
  })

  return (
    <div className="app-shell">
      <FlightMap>
        <TrailLayer store={store} selectedHex={selectedHex} />
        <AircraftLayer
          store={store}
          selectedHex={selectedHex}
          onSelect={setSelectedHex}
        />
      </FlightMap>
      <AircraftDetailPanel
        store={store}
        hex={selectedHex}
        onClose={clearSelection}
      />
      <Legend />
      {/* Provisional. Feature 10 replaces this with the real status bar. */}
      <p className="poll-readout" aria-live="polite">
        <span>{STATUS_TEXT[status]}</span>
        {/* The fleet, not the size of the last snapshot: aircraft persist
            across polls and leave 30 s after they stop appearing. */}
        <span>{figure(count)} aircraft</span>
        <span>{figure(creditsRemaining)} credits</span>
      </p>
    </div>
  )
}

export default App
