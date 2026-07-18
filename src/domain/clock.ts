import type { Match, MatchEvent, MatchPhase } from './types'

/**
 * Stoppage-aware clock helpers. Pure functions only — no wall-clock reads.
 *
 * The clock model: `Match.minute` is the match minute (holds at each half's
 * base — 45/90/105/120 — while stoppage is played) and `Match.stoppageMinute`
 * counts minutes past the base of the current half, so "45+2" is
 * `{ minute: 45, stoppageMinute: 2 }` and "105+1" is
 * `{ minute: 105, stoppageMinute: 1 }`.
 */

export const HALF_MINUTES = 45
export const REGULATION_MINUTES = 90
export const ET_HALF_MINUTES = 15
export const ET_FIRST_END = 105
export const ET_SECOND_END = 120

/** Expected added minutes per half when the fourth official's board hasn't gone up yet. */
export const DEFAULT_STOPPAGE = {
  firstHalf: 3,
  secondHalf: 5,
  extraTimeFirst: 1,
  extraTimeSecond: 2,
} as const

export function isExtraTimePhase(phase: MatchPhase): boolean {
  return (
    phase === 'extra-time-break' ||
    phase === 'extra-time-first' ||
    phase === 'extra-time-half-time' ||
    phase === 'extra-time-second'
  )
}

export function expectedStoppage(match: Match): {
  firstHalf: number
  secondHalf: number
  extraTimeFirst: number
  extraTimeSecond: number
} {
  return {
    firstHalf: match.announcedStoppage.firstHalf ?? DEFAULT_STOPPAGE.firstHalf,
    secondHalf: match.announcedStoppage.secondHalf ?? DEFAULT_STOPPAGE.secondHalf,
    extraTimeFirst: match.announcedStoppage.extraTimeFirst ?? DEFAULT_STOPPAGE.extraTimeFirst,
    extraTimeSecond: match.announcedStoppage.extraTimeSecond ?? DEFAULT_STOPPAGE.extraTimeSecond,
  }
}

/**
 * A single monotonic-enough timeline for event ages: regulation minute plus
 * stoppage played. First-half stoppage overlaps the first second-half minutes
 * (45+3 maps to 48, like the 48th minute) — fine for windowed momentum, not
 * for exact chronology.
 */
export function effectiveMinute(minute: number, stoppageMinute = 0): number {
  return minute + stoppageMinute
}

export function matchEffectiveMinute(match: Match): number {
  return effectiveMinute(match.minute, match.stoppageMinute)
}

/** Broadcast-style minute: "34'", "45+2'", "90+4'". */
export function formatMinute(minute: number, stoppageMinute = 0): string {
  if (stoppageMinute > 0) return `${minute}+${stoppageMinute}'`
  return `${minute}'`
}

export function formatMatchMinute(match: Match): string {
  return formatMinute(match.minute, match.stoppageMinute)
}

export function formatEventMinute(event: MatchEvent): string {
  return formatMinute(event.minute, event.stoppageMinute ?? 0)
}
