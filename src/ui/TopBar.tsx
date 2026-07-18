import type { ConnectionStatus } from '../domain/types'

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
}

export function TopBar({ status }: TopBarProps) {
  return (
    <header className="topbar">
      <div className="topbar__brand">
        MATCHCAST <span className="topbar__slash">//</span> LIVE MODEL
      </div>
      <div className={`status-pill status-pill--${status}`}>
        <span className="status-pill__dot" aria-hidden="true" />
        <span className="status-pill__label">{STATUS_LABEL[status]}</span>
      </div>
    </header>
  )
}
