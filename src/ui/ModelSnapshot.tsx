import type { Match, PredictionState } from '../domain/types'

interface ModelSnapshotProps {
  match: Match
  prediction: PredictionState
}

export function ModelSnapshot({ match, prediction }: ModelSnapshotProps) {
  const { home, away } = match.teams
  const leanLabel =
    prediction.nextGoalLean === 'even' ? 'Even' : match.teams[prediction.nextGoalLean].name

  return (
    <div className="snapshot">
      <h2 className="snapshot__title">Model snapshot</h2>
      <dl className="snapshot__rows">
        <div className="snapshot__row">
          <dt>Projected score</dt>
          <dd>
            {home.name} {prediction.projectedScore.home}–{prediction.projectedScore.away}{' '}
            {away.name}
          </dd>
        </div>
        <div className="snapshot__row">
          <dt>Expected goals</dt>
          <dd>
            {prediction.expectedGoals.home.toFixed(2)} · {prediction.expectedGoals.away.toFixed(2)}
          </dd>
        </div>
        <div className="snapshot__row">
          <dt>Both teams to score</dt>
          <dd>{prediction.btts}%</dd>
        </div>
        <div className="snapshot__row">
          <dt>Over 2.5 goals</dt>
          <dd>{prediction.over25}%</dd>
        </div>
        <div className="snapshot__row">
          <dt>Next goal lean</dt>
          <dd>{leanLabel}</dd>
        </div>
      </dl>
      <div className="snapshot__confidence">
        <span className="snapshot__confidence-label">Live confidence</span>
        <span className="snapshot__confidence-value">{prediction.confidence.toFixed(1)} / 10</span>
      </div>
    </div>
  )
}
