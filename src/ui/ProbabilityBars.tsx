import type { PredictionState } from '../domain/types'

interface ProbabilityBarsProps {
  prediction: PredictionState
  homeName: string
  awayName: string
}

interface BarConfig {
  key: string
  label: string
  value: number
  modifier: 'home' | 'draw' | 'away'
}

export function ProbabilityBars({ prediction, homeName, awayName }: ProbabilityBarsProps) {
  const bars: BarConfig[] = [
    {
      key: 'home',
      label: `${homeName} win`,
      value: prediction.probabilities.home,
      modifier: 'home',
    },
    { key: 'draw', label: 'Draw', value: prediction.probabilities.draw, modifier: 'draw' },
    {
      key: 'away',
      label: `${awayName} win`,
      value: prediction.probabilities.away,
      modifier: 'away',
    },
  ]

  return (
    <div className="prob-bars">
      {bars.map((bar) => (
        <div className="prob-card" key={bar.key}>
          <div className="prob-card__label">{bar.label}</div>
          <div className="prob-card__value">{bar.value}%</div>
          <div
            className="prob-card__track"
            role="progressbar"
            aria-valuenow={bar.value}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={bar.label}
          >
            <div
              className={`prob-card__fill prob-card__fill--${bar.modifier}`}
              style={{ width: `${bar.value}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}
