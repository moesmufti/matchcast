import type { Match, MatchPhase, PredictionState } from '../domain/types'

const REGULATION_PHASES: MatchPhase[] = ['pre-match', 'first-half', 'half-time', 'second-half']

/**
 * What the middle outcome means at this stage of the match. Non-knockout
 * matches can just end level, so it's a plain draw. In the knockout, a level
 * scoreline at 90' sends the tie to extra time, and a level scoreline at 120'
 * sends it to penalties — so the label tracks whichever decider is next.
 */
function drawLabel(match: Match): string {
  if (!match.knockout) return 'Draw'
  return REGULATION_PHASES.includes(match.phase) ? 'Extra time' : 'Penalties'
}

interface ProbabilityBarsProps {
  match: Match
  prediction: PredictionState
  homeName: string
  awayName: string
}

/**
 * The Win Meter — a single segmented broadcast strip. The three outcome
 * segments share one track, so summing to 100% is visible by construction.
 */
export function ProbabilityBars({ match, prediction, homeName, awayName }: ProbabilityBarsProps) {
  const { home, draw, away } = prediction.probabilities
  const label = drawLabel(match)

  return (
    <div className="winmeter" aria-label="Win probability">
      <div className="winmeter__readout">
        <div className="winmeter__outcome winmeter__outcome--home">
          <span className="winmeter__value">{home}%</span>
          <span className="winmeter__label">{homeName} win</span>
        </div>
        <div className="winmeter__outcome winmeter__outcome--draw">
          <span className="winmeter__value">{draw}%</span>
          <span className="winmeter__label">{label}</span>
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
          aria-label={label}
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
