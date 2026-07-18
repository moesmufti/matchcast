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

export type MatchPhase = 'pre-match' | 'first-half' | 'half-time' | 'second-half' | 'full-time'

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

export interface LineupPlayer {
  number: number
  /** Short display name, e.g. "Mbappé". */
  name: string
}

export interface TeamLineup {
  /** e.g. "4-3-3" */
  formation: string
  /** 11 players: GK first, then defenders → forwards in line order, each line left→right. */
  players: LineupPlayer[]
}

/** Full live state of the match — the single source of truth for rendering. */
export interface Match {
  competition: string
  round: string
  venue: string
  kickoffIso: string
  teams: Record<TeamId, Team>
  phase: MatchPhase
  /** Regulation minute, 0–90. Holds at 45/90 while stoppage time is played. */
  minute: number
  /** Minutes played beyond 45'/90' in the current half (0 in open play). */
  stoppageMinute: number
  /** Fourth-official added time per half; null until announced. */
  announcedStoppage: { firstHalf: number | null; secondHalf: number | null }
  score: Score
  redCards: Record<TeamId, number>
  /** Shot counts per team, updated live. Drives the momentum model. */
  shots: Record<TeamId, ShotCounts>
  /**
   * Recent attacking momentum per team, 0–1. Derived purely from recent
   * shot/goal events via `computeMomentum` (src/domain/momentum.ts) —
   * providers must keep it in sync with `events`. Feeds the prediction model.
   */
  momentum: Record<TeamId, number>
  events: MatchEvent[]
  /** Starting XIs, announced ~1h before kickoff — absent until then. */
  lineups?: Record<TeamId, TeamLineup>
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
