import type { Match, MatchPhase } from '../domain/types'
import { formatMatchMinute } from '../domain/clock'

const PHASE_LABEL: Record<MatchPhase, string> = {
  'pre-match': 'Pre-match model',
  'first-half': 'First half',
  'half-time': 'Half-time',
  'second-half': 'Second half',
  'extra-time-break': 'Extra time — break',
  'extra-time-first': 'Extra time, first half',
  'extra-time-half-time': 'Extra time — half-time',
  'extra-time-second': 'Extra time, second half',
  penalties: 'Penalty shoot-out',
  'full-time': 'Full-time model',
}

/**
 * This fixture is fixed (18 July 2026, 23:00 Europe/Amsterdam), so the
 * timezone abbreviation is hardcoded to CEST rather than relying on ICU's
 * inconsistent `timeZoneName` output across environments.
 */
function formatKickoffLine(match: Match): string {
  const date = new Date(match.kickoffIso)
  const weekday = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    timeZone: 'Europe/Amsterdam',
  }).format(date)
  const day = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    timeZone: 'Europe/Amsterdam',
  }).format(date)
  const month = new Intl.DateTimeFormat('en-GB', {
    month: 'long',
    timeZone: 'Europe/Amsterdam',
  }).format(date)
  const year = new Intl.DateTimeFormat('en-GB', {
    year: 'numeric',
    timeZone: 'Europe/Amsterdam',
  }).format(date)
  const time = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Europe/Amsterdam',
  }).format(date)
  return `${weekday} ${day} ${month} ${year} · ${time} CEST · ${match.venue}`
}

/** Score line for screen readers — folds in the shoot-out tally and winner once a shootout exists. */
function buildScoreLabel(match: Match): string {
  const { home, away } = match.teams
  const base = `Score: ${home.name} ${match.score.home}, ${away.name} ${match.score.away}`
  if (!match.penalties) return base
  const pens = `Penalties: ${home.name} ${match.penalties.score.home}, ${away.name} ${match.penalties.score.away}`
  const winner = match.penalties.winner
    ? ` — ${match.teams[match.penalties.winner].name} win the shoot-out`
    : ''
  return `${base}. ${pens}${winner}`
}

interface MatchHeaderProps {
  match: Match
}

export function MatchHeader({ match }: MatchHeaderProps) {
  const { home, away } = match.teams
  // The match clock stops meaning anything once kicks start — the phase label
  // ("Penalty shoot-out") carries the state instead of a frozen "120'".
  const clockLabel = match.phase === 'penalties' ? 'FT' : formatMatchMinute(match)

  return (
    <section className="hero" aria-label="Match overview">
      <p className="hero__eyebrow">
        {match.competition} · {match.round}
      </p>
      <p className="hero__meta">{formatKickoffLine(match)}</p>
      <div className="hero__matchup">
        <div className="hero__team hero__team--home">
          <span className="hero__flag" aria-hidden="true">
            {home.flag}
          </span>
          <span className="hero__team-name">{home.name}</span>
          <span className="hero__team-tagline">{home.tagline}</span>
        </div>
        <div className="hero__center">
          <div className="hero__score" aria-label={buildScoreLabel(match)}>
            {match.score.home}–{match.score.away}
          </div>
          {match.penalties && (
            <div className="hero__pens" aria-hidden="true">
              Pens {match.penalties.score.home}–{match.penalties.score.away}
            </div>
          )}
          <div className="hero__bug">
            <span className="hero__clock">{clockLabel}</span>
            <span className="hero__phase">{PHASE_LABEL[match.phase]}</span>
          </div>
        </div>
        <div className="hero__team hero__team--away">
          <span className="hero__flag" aria-hidden="true">
            {away.flag}
          </span>
          <span className="hero__team-name">{away.name}</span>
          <span className="hero__team-tagline">{away.tagline}</span>
        </div>
      </div>
    </section>
  )
}
