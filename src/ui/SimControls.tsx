import type { Match } from '../domain/types'
import type { SimulationControls } from '../providers/LiveMatchProvider'

interface SimControlsProps {
  match: Match
  controls: SimulationControls
}

const SPEED_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: '1× real time' },
  { value: 15, label: '15×' },
  { value: 60, label: '60×' },
]

export function SimControls({ match, controls }: SimControlsProps) {
  const isFullTime = match.phase === 'full-time'
  const isPreMatch = match.phase === 'pre-match'
  const running = controls.isRunning()
  const canInject = !isPreMatch && !isFullTime
  const speed = controls.getSpeed()

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
      <h2 className="card-eyebrow">Simulation controls</h2>
      <div className="sim-controls__group">
        <span className="sim-controls__group-label">Match flow</span>
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
      </div>
      <div className="sim-controls__group">
        <span className="sim-controls__group-label">Speed</span>
        <div className="sim-controls__row">
          {SPEED_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className="btn"
              aria-pressed={speed === option.value}
              onClick={() => controls.setSpeed(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div className="sim-controls__teams">
        <div className="sim-controls__group sim-controls__group--home">
          <span className="sim-controls__group-label">France</span>
          <div className="sim-controls__row">
            <button
              type="button"
              className="btn btn--goal"
              onClick={() => controls.injectGoal('home')}
              disabled={!canInject}
            >
              Goal
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => controls.injectChance('home')}
              disabled={!canInject}
            >
              Chance
            </button>
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => controls.injectRedCard('home')}
              disabled={!canInject}
              aria-label="France red card"
            >
              Red card
            </button>
          </div>
        </div>
        <div className="sim-controls__group sim-controls__group--away">
          <span className="sim-controls__group-label">England</span>
          <div className="sim-controls__row">
            <button
              type="button"
              className="btn btn--goal"
              onClick={() => controls.injectGoal('away')}
              disabled={!canInject}
            >
              Goal
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => controls.injectChance('away')}
              disabled={!canInject}
            >
              Chance
            </button>
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => controls.injectRedCard('away')}
              disabled={!canInject}
              aria-label="England red card"
            >
              Red card
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
