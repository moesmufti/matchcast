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
    // Third-place match: a winner is required — level after 90 means extra
    // time, still level means penalties.
    knockout: true,
    minute: 0,
    stoppageMinute: 0,
    announcedStoppage: {
      firstHalf: null,
      secondHalf: null,
      extraTimeFirst: null,
      extraTimeSecond: null,
    },
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
        // Predicted bench, same spirit as the predicted XI above — replaced
        // by real vendor data when the feed provides it.
        bench: [
          { number: 16, name: 'Chevalier' },
          { number: 3, name: 'Pavard' },
          { number: 18, name: 'Konaté' },
          { number: 21, name: 'L. Hernandez' },
          { number: 13, name: 'Zaïre-Emery' },
          { number: 14, name: 'Rabiot' },
          { number: 12, name: 'Olise' },
          { number: 20, name: 'Doué' },
          { number: 9, name: 'Thuram' },
          { number: 19, name: 'Kolo Muani' },
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
        bench: [
          { number: 13, name: 'Henderson' },
          { number: 3, name: 'Colwill' },
          { number: 15, name: 'Konsa' },
          { number: 18, name: 'Alexander-Arnold' },
          { number: 8, name: 'Wharton' },
          { number: 16, name: 'Rogers' },
          { number: 11, name: 'Rashford' },
          { number: 21, name: 'Gordon' },
          { number: 14, name: 'Palmer' },
          { number: 17, name: 'Watkins' },
        ],
      },
    },
  }
}
