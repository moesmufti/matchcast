import type { Match, MatchEvent, TeamId } from '../domain/types'

interface MatchStatsCardProps {
  match: Match
}

function countEvents(events: MatchEvent[], type: MatchEvent['type']): Record<TeamId, number> {
  const counts: Record<TeamId, number> = { home: 0, away: 0 }
  for (const event of events) {
    if (event.type === type && event.team) counts[event.team] += 1
  }
  return counts
}

/** One home-vs-away tally with a split bar showing the home share. */
function StatRow({
  label,
  home,
  away,
  suffix = '',
}: {
  label: string
  home: number
  away: number
  suffix?: string
}) {
  const total = home + away
  return (
    <div className="stats__row">
      <span className="stats__value">
        {home}
        {suffix}
      </span>
      <div className="stats__mid">
        <span className="stats__label">{label}</span>
        <div className="stats__bar" aria-hidden="true">
          {total > 0 ? (
            <div className="stats__bar-home" style={{ width: `${(home / total) * 100}%` }} />
          ) : null}
        </div>
      </div>
      <span className="stats__value">
        {away}
        {suffix}
      </span>
    </div>
  )
}

/**
 * Live match statistics tallied from the current snapshot: shots (when the
 * data source provides counts), cards, substitutions, plus half-time score,
 * officials and the all-time head-to-head record when known. Renders nothing
 * until at least one stat has something to say.
 */
export function MatchStatsCard({ match }: MatchStatsCardProps) {
  const { home, away } = match.teams
  const yellows = countEvents(match.events, 'yellow-card')
  const subs = countEvents(match.events, 'substitution')
  const reds = match.redCards
  const hasShots = match.shots.home.total + match.shots.away.total > 0
  const hasTallies =
    hasShots ||
    match.possession !== undefined ||
    yellows.home + yellows.away + reds.home + reds.away + subs.home + subs.away > 0
  // The vendor's aggregates can be internally inconsistent (meetings in its
  // database without a recorded result), which would render as nonsense like
  // "6 played, 0 wins, 0 wins, 2 draws". Only a record that adds up is shown.
  const h2h =
    match.headToHead &&
    match.headToHead.played > 0 &&
    match.headToHead.wins.home + match.headToHead.wins.away + match.headToHead.draws ===
      match.headToHead.played
      ? match.headToHead
      : undefined

  const meta = [
    match.halfTimeScore && `HT ${match.halfTimeScore.home}–${match.halfTimeScore.away}`,
    match.referee && `Referee ${match.referee}`,
    match.attendance !== undefined && `Attendance ${match.attendance.toLocaleString('en-GB')}`,
  ].filter((entry): entry is string => Boolean(entry))

  if (!hasTallies && !h2h && meta.length === 0) return null

  return (
    <section className="stats" aria-label="Match statistics">
      <h2 className="card-eyebrow">Match stats</h2>
      {hasTallies && (
        <div className="stats__rows">
          <div className="stats__teams" aria-hidden="true">
            <span className="stats__team stats__team--home">{home.shortName}</span>
            <span className="stats__team stats__team--away">{away.shortName}</span>
          </div>
          {match.possession && (
            <StatRow
              label="Possession"
              home={match.possession.home}
              away={match.possession.away}
              suffix="%"
            />
          )}
          {hasShots && (
            <>
              <StatRow label="Shots" home={match.shots.home.total} away={match.shots.away.total} />
              <StatRow
                label="On target"
                home={match.shots.home.onTarget}
                away={match.shots.away.onTarget}
              />
            </>
          )}
          <StatRow label="Yellow cards" home={yellows.home} away={yellows.away} />
          <StatRow label="Red cards" home={reds.home} away={reds.away} />
          <StatRow label="Substitutions used" home={subs.home} away={subs.away} />
        </div>
      )}
      {h2h && (
        <div className="stats__h2h">
          <div className="stats__h2h-top">
            <span className="stats__team stats__team--home">
              {home.shortName} {h2h.wins.home}
            </span>
            <span className="stats__h2h-title">Head-to-head · {h2h.played} played</span>
            <span className="stats__team stats__team--away">
              {h2h.wins.away} {away.shortName}
            </span>
          </div>
          <div
            className="stats__h2h-bar"
            role="img"
            aria-label={`All-time: ${home.name} ${h2h.wins.home} wins, ${h2h.draws} draws, ${away.name} ${h2h.wins.away} wins`}
          >
            <div
              className="stats__h2h-seg stats__h2h-seg--home"
              style={{ width: `${(h2h.wins.home / h2h.played) * 100}%` }}
            />
            <div
              className="stats__h2h-seg stats__h2h-seg--draw"
              style={{ width: `${(h2h.draws / h2h.played) * 100}%` }}
            />
            <div
              className="stats__h2h-seg stats__h2h-seg--away"
              style={{ width: `${(h2h.wins.away / h2h.played) * 100}%` }}
            />
          </div>
          <div className="stats__h2h-sub">
            {h2h.draws} draws · {h2h.totalGoals} goals in the fixture
          </div>
        </div>
      )}
      {meta.length > 0 && <div className="stats__meta">{meta.join(' · ')}</div>}
    </section>
  )
}
