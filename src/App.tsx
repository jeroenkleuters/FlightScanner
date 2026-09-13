import { usePolling } from './api/usePolling'
import type { PollStatus } from './api/pollSchedule'
import { FlightMap } from './map/FlightMap'

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
  const { status, aircraftCount, creditsRemaining } = usePolling()

  return (
    <div className="app-shell">
      <FlightMap />
      {/* Provisional. Feature 10 replaces this with the real status bar. */}
      <p className="poll-readout" aria-live="polite">
        <span>{STATUS_TEXT[status]}</span>
        <span>{figure(aircraftCount)} aircraft</span>
        <span>{figure(creditsRemaining)} credits</span>
      </p>
    </div>
  )
}

export default App
