import type { MatchEvent, ProbabilitySnapshot, TeamId } from '../domain/types'
import { ET_FIRST_END, ET_SECOND_END, REGULATION_MINUTES } from '../domain/clock'

const WIDTH = 600
const HEIGHT = 230
const MARGIN_TOP = 10
const MARGIN_BOTTOM = 24
const MARGIN_LEFT = 30
const PLOT_HEIGHT = HEIGHT - MARGIN_TOP - MARGIN_BOTTOM
const PLOT_WIDTH = WIDTH - MARGIN_LEFT
const FULL_MATCH = REGULATION_MINUTES
const REGULATION_TICKS = [15, 30, 45, 60, 75, 90]
const EXTRA_TIME_TICKS = [15, 30, 45, 60, 75, 90, ET_FIRST_END, ET_SECOND_END]

type SeriesKey = 'home' | 'draw' | 'away'

function yFor(value: number): number {
  return MARGIN_TOP + PLOT_HEIGHT - (value / 100) * PLOT_HEIGHT
}

/**
 * X position for a minute. `domainMax` is normally 90 but stretches past it
 * once stoppage time pushes the effective minute beyond 90, so added time
 * keeps drawing left-to-right instead of piling up on the right edge.
 */
function xFor(minute: number, domainMax: number): number {
  return MARGIN_LEFT + (Math.min(minute, domainMax) / domainMax) * PLOT_WIDTH
}

/**
 * X position for each snapshot: minutes map onto the 0–domainMax timeline;
 * multiple snapshots within the same minute fan out fractionally so vertical
 * jumps (goals, cards) stay visible as sharp steps rather than overdrawing.
 */
function xPositions(history: ProbabilitySnapshot[], domainMax: number): number[] {
  const positions: number[] = []
  for (let i = 0; i < history.length; i++) {
    const minute = history[i].minute
    let sameMinuteIndex = 0
    let sameMinuteCount = 1
    for (let j = 0; j < history.length; j++) {
      if (history[j].minute === minute) {
        if (j < i) sameMinuteIndex++
        if (j !== i) sameMinuteCount++
      }
    }
    positions.push(xFor(minute + sameMinuteIndex / Math.max(1, sameMinuteCount), domainMax))
  }
  return positions
}

function buildLine(history: ProbabilitySnapshot[], xs: number[], key: SeriesKey): string {
  if (history.length === 0) return ''
  if (history.length === 1) {
    const y = yFor(history[0][key])
    return `M${MARGIN_LEFT},${y} L${WIDTH},${y}`
  }
  return history.map((point, i) => `${i === 0 ? 'M' : 'L'}${xs[i]},${yFor(point[key])}`).join(' ')
}

function buildArea(history: ProbabilitySnapshot[], xs: number[], key: SeriesKey): string {
  if (history.length === 0) return ''
  const line = buildLine(history, xs, key)
  const baseline = yFor(0)
  const endX = history.length === 1 ? WIDTH : (xs[xs.length - 1] ?? WIDTH)
  return `${line} L${endX},${baseline} L${MARGIN_LEFT},${baseline} Z`
}

interface ProbabilityChartProps {
  history: ProbabilitySnapshot[]
  events: MatchEvent[]
}

interface GoalMarker {
  minute: number
  team: TeamId
}

export function ProbabilityChart({ history, events }: ProbabilityChartProps) {
  const lastMinute = history.length > 0 ? history[history.length - 1].minute : 0
  // Extra time only ever starts after the 'extra-time-start' event fires, so
  // gate the extended domain/ticks on that rather than on lastMinute alone —
  // second-half stoppage alone can already push lastMinute past 90, and a
  // regulation-only match must keep rendering exactly as it does today.
  const hasEnteredExtraTime = events.some((e) => e.type === 'extra-time-start')
  const domainMax = hasEnteredExtraTime
    ? Math.max(ET_SECOND_END, lastMinute)
    : Math.max(FULL_MATCH, lastMinute)
  const ticks = hasEnteredExtraTime ? EXTRA_TIME_TICKS : REGULATION_TICKS
  const xs = xPositions(history, domainMax)
  const homeLine = buildLine(history, xs, 'home')
  const drawLine = buildLine(history, xs, 'draw')
  const awayLine = buildLine(history, xs, 'away')
  const homeArea = buildArea(history, xs, 'home')

  const goals: GoalMarker[] = events
    .filter((e) => e.type === 'goal' && e.team)
    .map((e) => ({ minute: e.minute, team: e.team as TeamId }))

  return (
    <div className="chart">
      <h2 className="card-eyebrow">Probability timeline</h2>
      <div className="chart__frame">
        <svg
          className="chart__svg"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Win probability over ${hasEnteredExtraTime ? 'the match, including extra time,' : 'the 90 minutes'} for France, draw and England, with goals marked`}
        >
          <title>Win probability timeline</title>
          {[0, 25, 50, 75, 100].map((line) => (
            <g key={line}>
              <line
                className="chart__gridline"
                x1={MARGIN_LEFT}
                x2={WIDTH}
                y1={yFor(line)}
                y2={yFor(line)}
              />
              <text className="chart__axis-label" x={MARGIN_LEFT - 8} y={yFor(line) + 3}>
                {line}
              </text>
            </g>
          ))}
          {ticks.map((minute) => (
            <g key={minute}>
              <line
                className={`chart__minute-line${minute === 45 ? ' chart__minute-line--ht' : ''}`}
                x1={xFor(minute, domainMax)}
                x2={xFor(minute, domainMax)}
                y1={MARGIN_TOP}
                y2={yFor(0)}
              />
              <text
                className="chart__axis-label chart__axis-label--x"
                x={xFor(minute, domainMax)}
                y={HEIGHT - 8}
              >
                {minute === 45
                  ? 'HT'
                  : hasEnteredExtraTime && minute === 90
                    ? 'FT'
                    : hasEnteredExtraTime && minute === ET_FIRST_END
                      ? 'ET'
                      : `${minute}'`}
              </text>
            </g>
          ))}
          {homeArea && <path className="chart__area" d={homeArea} />}
          {drawLine && <path className="chart__line chart__line--draw" d={drawLine} />}
          {awayLine && <path className="chart__line chart__line--away" d={awayLine} />}
          {homeLine && <path className="chart__line chart__line--home" d={homeLine} />}
          {goals.map((goal, i) => (
            <g key={`${goal.minute}-${goal.team}-${i}`}>
              <line
                className={`chart__goal-line chart__goal-line--${goal.team}`}
                x1={xFor(goal.minute, domainMax)}
                x2={xFor(goal.minute, domainMax)}
                y1={MARGIN_TOP}
                y2={yFor(0)}
              />
              <circle
                className={`chart__goal-dot chart__goal-dot--${goal.team}`}
                cx={xFor(goal.minute, domainMax)}
                cy={MARGIN_TOP + 6}
                r={4}
              />
            </g>
          ))}
          {lastMinute > 0 && lastMinute < domainMax && (
            <line
              className="chart__now-line"
              x1={xFor(lastMinute, domainMax)}
              x2={xFor(lastMinute, domainMax)}
              y1={MARGIN_TOP}
              y2={yFor(0)}
            />
          )}
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
        <span className="chart__legend-item">
          <span className="chart__swatch chart__swatch--goal" aria-hidden="true" />
          Goal
        </span>
      </div>
    </div>
  )
}
