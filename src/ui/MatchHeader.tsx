import type { Match, MatchPhase } from '../domain/types'
import { formatMatchMinute } from '../domain/clock'

const PHASE_LABEL: Record<MatchPhase, string> = {
  'pre-match': 'Pre-match model',
  'first-half': 'First half',
  'half-time': 'Half-time',
  'second-half': 'Second half',
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

interface MatchHeaderProps {
  match: Match
}

export function MatchHeader({ match }: MatchHeaderProps) {
  const { home, away } = match.teams

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
          <div
            className="hero__score"
            aria-label={`Score: ${home.name} ${match.score.home}, ${away.name} ${match.score.away}`}
          >
            {match.score.home}–{match.score.away}
          </div>
          <div className="hero__bug">
            <span className="hero__clock">{formatMatchMinute(match)}</span>
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
