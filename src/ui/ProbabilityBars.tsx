import type { PredictionState } from '../domain/types'

interface ProbabilityBarsProps {
  prediction: PredictionState
  homeName: string
  awayName: string
}

/**
 * The Win Meter — a single segmented broadcast strip. The three outcome
 * segments share one track, so summing to 100% is visible by construction.
 */
export function ProbabilityBars({ prediction, homeName, awayName }: ProbabilityBarsProps) {
  const { home, draw, away } = prediction.probabilities

  return (
    <div className="winmeter" aria-label="Win probability">
      <div className="winmeter__readout">
        <div className="winmeter__outcome winmeter__outcome--home">
          <span className="winmeter__value">{home}%</span>
          <span className="winmeter__label">{homeName} win</span>
        </div>
        <div className="winmeter__outcome winmeter__outcome--draw">
          <span className="winmeter__value">{draw}%</span>
          <span className="winmeter__label">Draw</span>
        </div>
        <div className="winmeter__outcome winmeter__outcome--away">
          <span className="winmeter__value">{away}%</span>
          <span className="winmeter__label">{awayName} win</span>
        </div>
      </div>
      <div className="winmeter__track">
        <div
          className="winmeter__segment winmeter__segment--home"
          style={{ width: `${home}%` }}
          role="progressbar"
          aria-valuenow={home}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${homeName} win`}
        />
        <div
          className="winmeter__segment winmeter__segment--draw"
          style={{ width: `${draw}%` }}
          role="progressbar"
          aria-valuenow={draw}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Draw"
        />
        <div
          className="winmeter__segment winmeter__segment--away"
          style={{ width: `${away}%` }}
          role="progressbar"
          aria-valuenow={away}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${awayName} win`}
        />
      </div>
    </div>
  )
}
