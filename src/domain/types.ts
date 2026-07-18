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
  | 'chance'
  | 'yellow-card'
  | 'red-card'
  | 'substitution'
  | 'half-time'
  | 'second-half-start'
  | 'full-time'
  | 'clock'

export interface MatchEvent {
  id: string
  minute: number
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

/** Full live state of the match — the single source of truth for rendering. */
export interface Match {
  competition: string
  round: string
  venue: string
  kickoffIso: string
  teams: Record<TeamId, Team>
  phase: MatchPhase
  /** Elapsed match minute, 0–90. */
  minute: number
  score: Score
  redCards: Record<TeamId, number>
  /**
   * Recent attacking momentum per team, 0–1. Decays over time and rises
   * with chances/goals. Feeds the prediction model.
   */
  momentum: Record<TeamId, number>
  events: MatchEvent[]
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
