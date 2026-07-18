import type { MatchEvent, MatchEventType, TeamId } from './types'
import { effectiveMinute } from './clock'

/**
 * Shot-based momentum: a pure function of the recent event stream, replacing
 * the old per-tick decay heuristic. Momentum for a team is a recency-weighted
 * sum of its attacking events inside a sliding window, squashed into [0, 1).
 *
 * Deterministic: same (events, now) in, same momentum out. Providers call
 * this after every event/minute and store the result on `Match.momentum`.
 */

const WINDOW_MINUTES = 15

const EVENT_WEIGHTS: Partial<Record<MatchEventType, number>> = {
  goal: 1.0,
  'shot-on-target': 0.55,
  'shot-off-target': 0.25,
}

/** 0 → 0, rises smoothly with the weighted sum, asymptotically capped below 1. */
function saturate(sum: number): number {
  return 1 - Math.exp(-sum)
}

export function computeMomentum(
  events: MatchEvent[],
  nowEffectiveMinute: number,
): Record<TeamId, number> {
  const raw: Record<TeamId, number> = { home: 0, away: 0 }

  for (const event of events) {
    if (!event.team) continue
    const weight = EVENT_WEIGHTS[event.type]
    if (weight === undefined) continue

    // Clamp to 0 so first-half-stoppage events (whose effective minute can
    // slightly exceed the early second-half clock) count as "just happened"
    // instead of flickering out and back in.
    const age = Math.max(
      0,
      nowEffectiveMinute - effectiveMinute(event.minute, event.stoppageMinute ?? 0),
    )
    if (age > WINDOW_MINUTES) continue

    raw[event.team] += weight * (1 - age / WINDOW_MINUTES)
  }

  return { home: saturate(raw.home), away: saturate(raw.away) }
}
