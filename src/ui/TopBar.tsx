import type { ConnectionStatus } from '../domain/types'
import { FIXTURES, isFixtureId, type FixtureId } from '../domain/fixture'

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connecting: 'Connecting',
  live: 'Live',
  paused: 'Paused',
  stale: 'Stale',
  disconnected: 'Disconnected',
  error: 'Error',
}

interface TopBarProps {
  status: ConnectionStatus
  fixtureId: FixtureId
  onFixtureChange: (fixtureId: FixtureId) => void
}

export function TopBar({ status, fixtureId, onFixtureChange }: TopBarProps) {
  return (
    <header className="topbar">
      <div className="topbar__brand">
        MATCHCAST <span className="topbar__slash">//</span> LIVE MODEL
      </div>
      <div className="topbar__right">
        <select
          className="topbar__fixture"
          aria-label="Match"
          value={fixtureId}
          onChange={(e) => {
            if (isFixtureId(e.target.value)) onFixtureChange(e.target.value)
          }}
        >
          {Object.values(FIXTURES).map((fixture) => (
            <option key={fixture.id} value={fixture.id}>
              {fixture.label}
            </option>
          ))}
        </select>
        <div className={`status-pill status-pill--${status}`}>
          <span className="status-pill__dot" aria-hidden="true" />
          <span className="status-pill__label">{STATUS_LABEL[status]}</span>
        </div>
      </div>
    </header>
  )
}
