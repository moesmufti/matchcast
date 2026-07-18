/**
 * Core domain models. Everything here is plain data — no React, no timers.
 * `home` is France, `away` is England throughout this fixture, but the
 * types stay generic so a real feed for any match can slot in.
 */

export type TeamId = 'home' | 'away'

export interface Team {
  id: TeamId
  name: string
  shortName: string
  flag: string
  tagline: string
}

export type MatchPhase =
  | 'pre-match'
  | 'first-half'
  | 'half-time'
  | 'second-half'
  /** 90' whistle with scores level in a knockout — short break before extra time. */
  | 'extra-time-break'
  | 'extra-time-first'
  | 'extra-time-half-time'
  | 'extra-time-second'
  | 'penalties'
  | 'full-time'

export type MatchEventType =
  | 'kickoff'
  | 'goal'
  | 'shot-on-target'
  | 'shot-off-target'
  | 'yellow-card'
  | 'red-card'
  | 'substitution'
  | 'stoppage-announced'
  | 'half-time'
  | 'second-half-start'
  | 'extra-time-start'
  | 'extra-time-half-time'
  | 'extra-time-second-start'
  | 'penalties-start'
  | 'penalty-scored'
  | 'penalty-missed'
  | 'full-time'
  | 'clock'

export interface MatchEvent {
  id: string
  minute: number
  /** Minutes past 45'/90' when the event happened in stoppage time (e.g. 2 for 45+2'). */
  stoppageMinute?: number
  type: MatchEventType
  team?: TeamId
  description: string
  /** How the prediction model reacted to this event, in plain English. */
  modelReaction: string
}

export interface Score {
  home: number
  away: number
}

export interface ShotCounts {
  total: number
  onTarget: number
}

export interface PenaltyKick {
  team: TeamId
  scored: boolean
}

/** Live penalty-shootout state. Present on `Match` only once the shootout has started. */
export interface PenaltyShootout {
  /** Converted kicks per team. */
  score: Score
  /** Every kick in the order taken (best-of-5, then sudden death). */
  kicks: PenaltyKick[]
  firstKicker: TeamId
  /** Set as soon as the shootout is mathematically decided. */
  winner: TeamId | null
}

/** All-time head-to-head record between the two sides. */
export interface HeadToHead {
  played: number
  totalGoals: number
  wins: Record<TeamId, number>
  draws: number
}

export interface LineupPlayer {
  number: number
  /** Short display name, e.g. "Mbappé". */
  name: string
}

export interface TeamLineup {
  /** e.g. "4-3-3" */
  formation: string
  /** True for editorial predicted line-ups (fixture fallback), absent for real vendor data. */
  predicted?: boolean
  /** 11 players: GK first, then defenders → forwards in line order, each line left→right. */
  players: LineupPlayer[]
  /** Unused substitutes still available on the bench; players are removed as they come on. */
  bench?: LineupPlayer[]
}

/** Full live state of the match — the single source of truth for rendering. */
export interface Match {
  competition: string
  round: string
  venue: string
  kickoffIso: string
  teams: Record<TeamId, Team>
  phase: MatchPhase
  /**
   * True for a fixture that must produce a winner: level after 90 goes to
   * extra time (91–120), still level goes to penalties.
   */
  knockout: boolean
  /**
   * Match minute, 0–120. Holds at each half's base (45/90/105/120) while
   * that half's stoppage time is played. Extra time runs 91–105 and 106–120.
   */
  minute: number
  /** Minutes played beyond the current half's base minute (0 in open play). */
  stoppageMinute: number
  /** Fourth-official added time per half; null until announced. */
  announcedStoppage: {
    firstHalf: number | null
    secondHalf: number | null
    extraTimeFirst: number | null
    extraTimeSecond: number | null
  }
  /** Goals in open play — regulation plus extra time, never shootout kicks. */
  score: Score
  /** Score at the interval; absent until half-time is reached. */
  halfTimeScore?: Score
  /** Penalty-shootout state; absent until the shootout starts. */
  penalties?: PenaltyShootout
  redCards: Record<TeamId, number>
  /** Shot counts per team, updated live. Drives the momentum model. */
  shots: Record<TeamId, ShotCounts>
  /** Ball possession per team as percentages; absent when the data source doesn't provide it. */
  possession?: Record<TeamId, number>
  /**
   * Recent attacking momentum per team, 0–1. Derived purely from recent
   * shot/goal events via `computeMomentum` (src/domain/momentum.ts) —
   * providers must keep it in sync with `events`. Feeds the prediction model.
   */
  momentum: Record<TeamId, number>
  events: MatchEvent[]
  /** Starting XIs, announced ~1h before kickoff — absent until then. */
  lineups?: Record<TeamId, TeamLineup>
  /** The main match official, when known. */
  referee?: string
  /** Recorded attendance, when the data source reports it. */
  attendance?: number
  /** All-time record between the sides, when the data source provides it. */
  headToHead?: HeadToHead
}

/** Pre-match model priors for the fixture. */
export interface PreMatchModel {
  /** Percentages summing to 100. */
  homeWin: number
  draw: number
  awayWin: number
  /** Expected goals over the full match. */
  xgHome: number
  xgAway: number
  projectedScore: Score
  /** Both teams to score, percent. */
  btts: number
  /** Over 2.5 goals, percent. */
  over25: number
}

/** One point of probability history, for the momentum chart. */
export interface ProbabilitySnapshot {
  minute: number
  home: number
  draw: number
  away: number
}

/** Output of the prediction engine for a given match state. */
export interface PredictionState {
  /** Integer percentages that always sum to exactly 100. */
  probabilities: { home: number; draw: number; away: number }
  projectedScore: Score
  /** Expected goals still to come + already scored, per team. */
  expectedGoals: { home: number; away: number }
  btts: number
  over25: number
  nextGoalLean: TeamId | 'even'
  /** 0–10 confidence in the current model read. */
  confidence: number
}

export type ConnectionStatus = 'connecting' | 'live' | 'paused' | 'stale' | 'disconnected' | 'error'
