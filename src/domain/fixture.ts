import type { Match, PreMatchModel } from './types'

/** Pre-match priors for France vs England, third-place match. */
export const PRE_MATCH_MODEL: PreMatchModel = {
  homeWin: 51,
  draw: 25,
  awayWin: 24,
  xgHome: 1.75,
  xgAway: 1.25,
  projectedScore: { home: 2, away: 1 },
  btts: 64,
  over25: 61,
}

export function createInitialMatch(): Match {
  return {
    competition: 'FIFA World Cup',
    round: 'Third-place match',
    venue: 'Miami',
    kickoffIso: '2026-07-18T23:00:00+02:00',
    teams: {
      home: {
        id: 'home',
        name: 'France',
        shortName: 'FRA',
        flag: '🇫🇷',
        tagline: 'Pre-match favourite',
      },
      away: {
        id: 'away',
        name: 'England',
        shortName: 'ENG',
        flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
        tagline: 'Counter-attacking threat',
      },
    },
    phase: 'pre-match',
    minute: 0,
    score: { home: 0, away: 0 },
    redCards: { home: 0, away: 0 },
    momentum: { home: 0, away: 0 },
    events: [],
  }
}
