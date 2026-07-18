import type { ConnectionStatus, Match, TeamId } from '../domain/types'

export interface MatchUpdate {
  match: Match
  status: ConnectionStatus
}

/**
 * Source-agnostic contract for live match data. The UI renders exclusively
 * from `MatchUpdate`s pushed through `subscribe`, so swapping the simulator
 * for a real feed is a one-line change in App.
 */
export interface LiveMatchProvider {
  /** Push the current state immediately, then every subsequent change. Returns an unsubscribe fn. */
  subscribe(listener: (update: MatchUpdate) => void): () => void
  /** Tear down timers / sockets. */
  dispose(): void
}

/**
 * Extra controls only a simulation can offer. The real provider will not
 * implement this — the UI renders sim controls only when the provider does.
 */
export interface SimulationControls {
  start(): void
  pause(): void
  reset(): void
  injectGoal(team: TeamId): void
  injectChance(team: TeamId): void
  injectRedCard(team: TeamId): void
  /** Advance the match clock by the given number of minutes. */
  advanceClock(minutes: number): void
  isRunning(): boolean
}

export function supportsSimulation(
  p: LiveMatchProvider,
): p is LiveMatchProvider & SimulationControls {
  return typeof (p as LiveMatchProvider & Partial<SimulationControls>).injectGoal === 'function'
}
