import type { ProbabilitySnapshot } from '../domain/types'

const WIDTH = 600
const HEIGHT = 220
const MARGIN_TOP = 12
const MARGIN_BOTTOM = 16
const PLOT_HEIGHT = HEIGHT - MARGIN_TOP - MARGIN_BOTTOM

type SeriesKey = 'home' | 'draw' | 'away'

function yFor(value: number): number {
  return MARGIN_TOP + PLOT_HEIGHT - (value / 100) * PLOT_HEIGHT
}

function xFor(index: number, count: number): number {
  if (count <= 1) return 0
  return (index / (count - 1)) * WIDTH
}

function buildLine(history: ProbabilitySnapshot[], key: SeriesKey): string {
  if (history.length === 0) return ''
  if (history.length === 1) {
    const y = yFor(history[0][key])
    return `M0,${y} L${WIDTH},${y}`
  }
  return history
    .map((point, i) => `${i === 0 ? 'M' : 'L'}${xFor(i, history.length)},${yFor(point[key])}`)
    .join(' ')
}

function buildArea(history: ProbabilitySnapshot[], key: SeriesKey): string {
  if (history.length === 0) return ''
  const line = buildLine(history, key)
  const baseline = yFor(0)
  return `${line} L${WIDTH},${baseline} L0,${baseline} Z`
}

interface ProbabilityChartProps {
  history: ProbabilitySnapshot[]
}

export function ProbabilityChart({ history }: ProbabilityChartProps) {
  const homeLine = buildLine(history, 'home')
  const drawLine = buildLine(history, 'draw')
  const awayLine = buildLine(history, 'away')
  const homeArea = buildArea(history, 'home')

  return (
    <div className="chart">
      <h2 className="chart__title">Probability history</h2>
      <div className="chart__frame">
        <svg
          className="chart__svg"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
          role="img"
          aria-label="Line chart of win probability history across the match for France, draw and England"
        >
          <title>Win probability history</title>
          {[25, 50, 75].map((line) => (
            <line
              key={line}
              className="chart__gridline"
              x1={0}
              x2={WIDTH}
              y1={yFor(line)}
              y2={yFor(line)}
            />
          ))}
          {homeArea && <path className="chart__area" d={homeArea} />}
          {drawLine && <path className="chart__line chart__line--draw" d={drawLine} />}
          {awayLine && <path className="chart__line chart__line--away" d={awayLine} />}
          {homeLine && <path className="chart__line chart__line--home" d={homeLine} />}
        </svg>
      </div>
      <div className="chart__legend">
        <span className="chart__legend-item">
          <span className="chart__swatch chart__swatch--home" aria-hidden="true" />
          France
        </span>
        <span className="chart__legend-item">
          <span className="chart__swatch chart__swatch--draw" aria-hidden="true" />
          Draw
        </span>
        <span className="chart__legend-item">
          <span className="chart__swatch chart__swatch--away" aria-hidden="true" />
          England
        </span>
      </div>
    </div>
  )
}
