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
    stoppageMinute: 0,
    announcedStoppage: { firstHalf: null, secondHalf: null },
    score: { home: 0, away: 0 },
    redCards: { home: 0, away: 0 },
    shots: {
      home: { total: 0, onTarget: 0 },
      away: { total: 0, onTarget: 0 },
    },
    momentum: { home: 0, away: 0 },
    events: [],
    lineups: {
      home: {
        formation: '4-3-3',
        players: [
          { number: 1, name: 'Maignan' },
          { number: 2, name: 'Koundé' },
          { number: 5, name: 'Saliba' },
          { number: 4, name: 'Upamecano' },
          { number: 22, name: 'T. Hernandez' },
          { number: 8, name: 'Tchouaméni' },
          { number: 7, name: 'Camavinga' },
          { number: 15, name: 'Griezmann' },
          { number: 11, name: 'Dembélé' },
          { number: 10, name: 'Mbappé' },
          { number: 17, name: 'Barcola' },
        ],
      },
      away: {
        formation: '4-2-3-1',
        players: [
          { number: 1, name: 'Pickford' },
          { number: 2, name: 'Walker' },
          { number: 5, name: 'Stones' },
          { number: 6, name: 'Guéhi' },
          { number: 12, name: 'Trippier' },
          { number: 4, name: 'Rice' },
          { number: 19, name: 'Mainoo' },
          { number: 7, name: 'Saka' },
          { number: 10, name: 'Bellingham' },
          { number: 20, name: 'Foden' },
          { number: 9, name: 'Kane' },
        ],
      },
    },
  }
}
