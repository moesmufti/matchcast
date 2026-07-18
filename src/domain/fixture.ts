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
    venue: 'Miami Stadium',
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
    // Actual announced teams for the fixture (press team news, 18 Jul 2026);
    // shirt numbers weren't published there, so 0 renders as a blank jersey.
    // Replaced wholesale by vendor data whenever the feed provides line-ups.
    lineups: {
      home: {
        formation: '4-2-3-1',
        players: [
          { number: 0, name: 'Maignan' },
          { number: 0, name: 'Gusto' },
          { number: 0, name: 'Konaté' },
          { number: 0, name: 'Lacroix' },
          { number: 0, name: 'T. Hernandez' },
          { number: 0, name: 'Zaïre-Emery' },
          { number: 0, name: 'Rabiot' },
          { number: 0, name: 'Olise' },
          { number: 0, name: 'Cherki' },
          { number: 0, name: 'Doué' },
          { number: 0, name: 'Mbappé' },
        ],
        bench: [
          { number: 0, name: 'Samba' },
          { number: 0, name: 'Risser' },
          { number: 0, name: 'Thuram' },
          { number: 0, name: 'Koundé' },
          { number: 0, name: 'Mateta' },
          { number: 0, name: 'Digne' },
          { number: 0, name: 'Upamecano' },
          { number: 0, name: 'Saliba' },
          { number: 0, name: 'Dembélé' },
          { number: 0, name: 'Kanté' },
          { number: 0, name: 'Barcola' },
          { number: 0, name: 'Koné' },
          { number: 0, name: 'Tchouaméni' },
          { number: 0, name: 'L. Hernandez' },
          { number: 0, name: 'Akliouche' },
        ],
      },
      away: {
        formation: '4-3-2-1',
        players: [
          { number: 0, name: 'D. Henderson' },
          { number: 0, name: 'Konsa' },
          { number: 0, name: 'Quansah' },
          { number: 0, name: 'Guéhi' },
          { number: 0, name: 'Spence' },
          { number: 0, name: 'Rice' },
          { number: 0, name: 'Rogers' },
          { number: 0, name: 'Eze' },
          { number: 0, name: 'Saka' },
          { number: 0, name: 'Rashford' },
          { number: 0, name: 'Toney' },
        ],
        bench: [
          { number: 0, name: 'Pickford' },
          { number: 0, name: 'Trafford' },
          { number: 0, name: "O'Reilly" },
          { number: 0, name: 'Stones' },
          { number: 0, name: 'Anderson' },
          { number: 0, name: 'Kane' },
          { number: 0, name: 'Bellingham' },
          { number: 0, name: 'Chalobah' },
          { number: 0, name: 'J. Henderson' },
          { number: 0, name: 'Burn' },
          { number: 0, name: 'Gordon' },
          { number: 0, name: 'Watkins' },
          { number: 0, name: 'Madueke' },
          { number: 0, name: 'James' },
        ],
      },
    },
  }
}
