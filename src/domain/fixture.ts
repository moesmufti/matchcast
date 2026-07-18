import type { Match, PreMatchModel } from './types'

export type FixtureId = 'third-place' | 'final'

/** Everything the app needs to drive one selectable fixture. */
export interface FixtureConfig {
  id: FixtureId
  /** Dropdown label in the top bar. */
  label: string
  /** football-data.org discovery stage for the worker proxy. */
  vendorStage: 'THIRD_PLACE' | 'FINAL'
  preMatchModel: PreMatchModel
  createInitialMatch: () => Match
}

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

/** Pre-match priors for Spain vs Argentina, the final. */
export const FINAL_PRE_MATCH_MODEL: PreMatchModel = {
  homeWin: 39,
  draw: 27,
  awayWin: 34,
  xgHome: 1.35,
  xgAway: 1.2,
  projectedScore: { home: 1, away: 1 },
  btts: 52,
  over25: 47,
}

export function createInitialFinalMatch(): Match {
  return {
    competition: 'FIFA World Cup',
    round: 'Final',
    venue: 'MetLife Stadium',
    kickoffIso: '2026-07-19T21:00:00+02:00',
    teams: {
      home: {
        id: 'home',
        name: 'Spain',
        shortName: 'ESP',
        flag: '🇪🇸',
        tagline: 'European champions',
      },
      away: {
        id: 'away',
        name: 'Argentina',
        shortName: 'ARG',
        flag: '🇦🇷',
        tagline: 'Defending champions',
      },
    },
    phase: 'pre-match',
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
    // Editorial predicted XIs until the real teams are announced — the
    // `predicted` flag titles the card accordingly, and vendor line-ups
    // replace these wholesale when the feed provides them.
    lineups: {
      home: {
        predicted: true,
        formation: '4-3-3',
        players: [
          { number: 0, name: 'Unai Simón' },
          { number: 0, name: 'Carvajal' },
          { number: 0, name: 'Le Normand' },
          { number: 0, name: 'Cubarsí' },
          { number: 0, name: 'Cucurella' },
          { number: 0, name: 'Rodri' },
          { number: 0, name: 'Pedri' },
          { number: 0, name: 'Fabián Ruiz' },
          { number: 0, name: 'Yamal' },
          { number: 0, name: 'Oyarzabal' },
          { number: 0, name: 'N. Williams' },
        ],
      },
      away: {
        predicted: true,
        formation: '4-3-3',
        players: [
          { number: 0, name: 'E. Martínez' },
          { number: 0, name: 'Molina' },
          { number: 0, name: 'Romero' },
          { number: 0, name: 'L. Martínez' },
          { number: 0, name: 'Tagliafico' },
          { number: 0, name: 'De Paul' },
          { number: 0, name: 'E. Fernández' },
          { number: 0, name: 'Mac Allister' },
          { number: 0, name: 'Messi' },
          { number: 0, name: 'J. Álvarez' },
          { number: 0, name: 'N. González' },
        ],
      },
    },
  }
}

export const DEFAULT_FIXTURE_ID: FixtureId = 'third-place'

export const FIXTURES: Record<FixtureId, FixtureConfig> = {
  'third-place': {
    id: 'third-place',
    label: 'Third place · France v England',
    vendorStage: 'THIRD_PLACE',
    preMatchModel: PRE_MATCH_MODEL,
    createInitialMatch,
  },
  final: {
    id: 'final',
    label: 'Final · Spain v Argentina',
    vendorStage: 'FINAL',
    preMatchModel: FINAL_PRE_MATCH_MODEL,
    createInitialMatch: createInitialFinalMatch,
  },
}

export function isFixtureId(value: string | null): value is FixtureId {
  return value === 'third-place' || value === 'final'
}
