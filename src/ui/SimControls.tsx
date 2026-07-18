import type { Match } from '../domain/types'
import type { SimulationControls } from '../providers/LiveMatchProvider'

interface SimControlsProps {
  match: Match
  controls: SimulationControls
}

export function SimControls({ match, controls }: SimControlsProps) {
  const isFullTime = match.phase === 'full-time'
  const isPreMatch = match.phase === 'pre-match'
  const running = controls.isRunning()
  const canInject = !isPreMatch && !isFullTime

  let toggleLabel: string
  let toggleDisabled = false
  let onToggle: () => void

  if (isFullTime) {
    toggleLabel = 'Full-time'
    toggleDisabled = true
    onToggle = () => {}
  } else if (running) {
    toggleLabel = 'Pause'
    onToggle = () => controls.pause()
  } else if (isPreMatch) {
    toggleLabel = 'Start live simulation'
    onToggle = () => controls.start()
  } else {
    toggleLabel = 'Resume'
    onToggle = () => controls.start()
  }

  return (
    <section className="sim-controls" aria-label="Simulation controls">
      <h2 className="sim-controls__title">Simulation controls</h2>
      <div className="sim-controls__row">
        <button
          type="button"
          className="btn btn--primary"
          onClick={onToggle}
          disabled={toggleDisabled}
        >
          {toggleLabel}
        </button>
        <button type="button" className="btn" onClick={() => controls.reset()}>
          Reset
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => controls.advanceClock(5)}
          disabled={!canInject}
          aria-label="Advance clock by 5 minutes"
        >
          +5 min
        </button>
      </div>
      <div className="sim-controls__row sim-controls__row--events">
        <button
          type="button"
          className="btn btn--goal"
          onClick={() => controls.injectGoal('home')}
          disabled={!canInject}
        >
          France goal
        </button>
        <button
          type="button"
          className="btn btn--goal"
          onClick={() => controls.injectGoal('away')}
          disabled={!canInject}
        >
          England goal
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => controls.injectChance('home')}
          disabled={!canInject}
        >
          France chance
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => controls.injectChance('away')}
          disabled={!canInject}
        >
          England chance
        </button>
        <button
          type="button"
          className="btn btn--danger"
          onClick={() => controls.injectRedCard('home')}
          disabled={!canInject}
          aria-label="France red card"
        >
          France red card
        </button>
        <button
          type="button"
          className="btn btn--danger"
          onClick={() => controls.injectRedCard('away')}
          disabled={!canInject}
          aria-label="England red card"
        >
          England red card
        </button>
      </div>
    </section>
  )
}
