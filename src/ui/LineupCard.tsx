import type { Match, TeamId, TeamLineup } from '../domain/types'

const WIDTH = 340
const HEIGHT = 520
const HALFWAY_Y = HEIGHT / 2
const FIELD_MARGIN = 10
const FIELD_LEFT = FIELD_MARGIN
const FIELD_RIGHT = WIDTH - FIELD_MARGIN
const GOAL_LINE_MARGIN = 26
const LAST_LINE_MARGIN = 34
const LINE_X_MARGIN = 32

interface LineupCardProps {
  teams: Match['teams']
  lineups: NonNullable<Match['lineups']>
}

interface PositionedPlayer {
  number: number
  name: string
  x: number
  y: number
}

/** "4-3-3" -> [4, 3, 3]. Falls back to a single empty line if unparsable. */
function parseFormationLines(formation: string): number[] {
  const segments = formation
    .split('-')
    .map((part) => Number.parseInt(part, 10))
    .filter((n) => Number.isFinite(n) && n > 0)
  return segments.length > 0 ? segments : [10]
}

/** Evenly spread `count` players across the pitch width, centered for count === 1. */
function xPositions(count: number): number[] {
  if (count <= 1) return [WIDTH / 2]
  const usable = FIELD_RIGHT - FIELD_LEFT - 2 * LINE_X_MARGIN
  const start = FIELD_LEFT + LINE_X_MARGIN
  return Array.from({ length: count }, (_, i) => start + (i * usable) / (count - 1))
}

/**
 * Lay a team's XI out on the pitch. `side` picks the half: the home team
 * defends the bottom goal line and attacks upward; the away team is
 * mirrored, defending the top goal line.
 */
function layoutTeam(lineup: TeamLineup, side: 'home' | 'away'): PositionedPlayer[] {
  const lines = [1, ...parseFormationLines(lineup.formation)]
  const totalLines = lines.length

  const goalY = side === 'home' ? HEIGHT - GOAL_LINE_MARGIN : GOAL_LINE_MARGIN
  const farY = side === 'home' ? HALFWAY_Y + LAST_LINE_MARGIN : HALFWAY_Y - LAST_LINE_MARGIN

  const positioned: PositionedPlayer[] = []
  let cursor = 0
  lines.forEach((count, lineIndex) => {
    const t = totalLines === 1 ? 0 : lineIndex / (totalLines - 1)
    const y = goalY + (farY - goalY) * t
    const xs = xPositions(count)
    for (let i = 0; i < count; i++) {
      const player = lineup.players[cursor]
      cursor++
      if (!player) continue
      positioned.push({ number: player.number, name: player.name, x: xs[i], y })
    }
  })
  return positioned
}

function TeamLabel({
  teamId,
  flag,
  shortName,
  formation,
}: {
  teamId: TeamId
  flag: string
  shortName: string
  formation: string
}) {
  return (
    <span className={`lineups__label lineups__label--${teamId}`}>
      <span className="lineups__label-swatch" aria-hidden="true" />
      {flag} {shortName} · {formation}
    </span>
  )
}

export function LineupCard({ teams, lineups }: LineupCardProps) {
  const homePlayers = layoutTeam(lineups.home, 'home')
  const awayPlayers = layoutTeam(lineups.away, 'away')

  return (
    <div className="lineups">
      <h2 className="card-eyebrow">Line-ups</h2>
      <div className="lineups__legend">
        <TeamLabel
          teamId="away"
          flag={teams.away.flag}
          shortName={teams.away.shortName}
          formation={lineups.away.formation}
        />
        <TeamLabel
          teamId="home"
          flag={teams.home.flag}
          shortName={teams.home.shortName}
          formation={lineups.home.formation}
        />
      </div>
      <div className="lineups__pitch-wrap">
        <svg
          className="lineups__pitch"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label={`Starting line-ups: ${teams.home.name} in a ${lineups.home.formation}, ${teams.away.name} in a ${lineups.away.formation}`}
        >
          <title>Starting line-ups</title>
          <rect className="lineups__field" x={0} y={0} width={WIDTH} height={HEIGHT} rx={8} />
          <g className="lineups__markings">
            <rect
              x={FIELD_LEFT}
              y={FIELD_MARGIN}
              width={FIELD_RIGHT - FIELD_LEFT}
              height={HEIGHT - 2 * FIELD_MARGIN}
              fill="none"
            />
            <line x1={FIELD_LEFT} y1={HALFWAY_Y} x2={FIELD_RIGHT} y2={HALFWAY_Y} />
            <circle cx={WIDTH / 2} cy={HALFWAY_Y} r={45} fill="none" />
            <circle className="lineups__spot" cx={WIDTH / 2} cy={HALFWAY_Y} r={2} />
            {/* Bottom (home) penalty area */}
            <rect x={82} y={HEIGHT - 80} width={176} height={70} fill="none" />
            <rect x={130} y={HEIGHT - 34} width={80} height={24} fill="none" />
            <circle className="lineups__spot" cx={WIDTH / 2} cy={HEIGHT - 66} r={2} />
            <path d={`M ${140} ${HEIGHT - 80} A 45 45 0 0 1 ${200} ${HEIGHT - 80}`} fill="none" />
            {/* Top (away) penalty area */}
            <rect x={82} y={10} width={176} height={70} fill="none" />
            <rect x={130} y={10} width={80} height={24} fill="none" />
            <circle className="lineups__spot" cx={WIDTH / 2} cy={66} r={2} />
            <path d={`M ${140} ${80} A 45 45 0 0 0 ${200} ${80}`} fill="none" />
            {/* Corner arcs */}
            <path
              d={`M ${FIELD_LEFT} ${FIELD_MARGIN + 8} A 8 8 0 0 0 ${FIELD_LEFT + 8} ${FIELD_MARGIN}`}
              fill="none"
            />
            <path
              d={`M ${FIELD_RIGHT - 8} ${FIELD_MARGIN} A 8 8 0 0 0 ${FIELD_RIGHT} ${FIELD_MARGIN + 8}`}
              fill="none"
            />
            <path
              d={`M ${FIELD_LEFT} ${HEIGHT - FIELD_MARGIN - 8} A 8 8 0 0 1 ${FIELD_LEFT + 8} ${HEIGHT - FIELD_MARGIN}`}
              fill="none"
            />
            <path
              d={`M ${FIELD_RIGHT - 8} ${HEIGHT - FIELD_MARGIN} A 8 8 0 0 1 ${FIELD_RIGHT} ${HEIGHT - FIELD_MARGIN - 8}`}
              fill="none"
            />
          </g>
          <g className="lineups__team lineups__team--away">
            {awayPlayers.map((p) => (
              <g key={`away-${p.number}`} transform={`translate(${p.x}, ${p.y})`}>
                <circle className="lineups__jersey lineups__jersey--away" r={11} />
                <text className="lineups__number" y={4}>
                  {p.number}
                </text>
                <text className="lineups__name" y={22}>
                  {p.name}
                </text>
              </g>
            ))}
          </g>
          <g className="lineups__team lineups__team--home">
            {homePlayers.map((p) => (
              <g key={`home-${p.number}`} transform={`translate(${p.x}, ${p.y})`}>
                <circle className="lineups__jersey lineups__jersey--home" r={11} />
                <text className="lineups__number" y={4}>
                  {p.number}
                </text>
                <text className="lineups__name" y={22}>
                  {p.name}
                </text>
              </g>
            ))}
          </g>
        </svg>
      </div>
    </div>
  )
}
