import { describe, expect, it } from 'vitest'
import { computePrediction, normalizeToHundred } from './prediction'
import { createInitialMatch, PRE_MATCH_MODEL } from './fixture'
import type { Match } from './types'

function cloneMatch(overrides: Partial<Match> = {}): Match {
  const base = createInitialMatch()
  return {
    ...base,
    ...overrides,
    teams: base.teams,
    score: { ...base.score, ...(overrides.score ?? {}) },
    redCards: { ...base.redCards, ...(overrides.redCards ?? {}) },
    momentum: { ...base.momentum, ...(overrides.momentum ?? {}) },
    announcedStoppage: { ...base.announcedStoppage, ...(overrides.announcedStoppage ?? {}) },
    shots: overrides.shots ?? base.shots,
    events: overrides.events ?? base.events,
  }
}

describe('normalizeToHundred', () => {
  it('always sums to exactly 100 across a wide sweep of weight combos', () => {
    const values = [0, 1, 2, 3, 5, 7, 10, 13.5, 17, 24, 33, 50, 51, 64, 100, 123.456]
    for (const a of values) {
      for (const b of values) {
        for (const c of values) {
          const [x, y, z] = normalizeToHundred([a, b, c])
          expect(x + y + z).toBe(100)
          expect(x).toBeGreaterThanOrEqual(0)
          expect(y).toBeGreaterThanOrEqual(0)
          expect(z).toBeGreaterThanOrEqual(0)
        }
      }
    }
  })

  it('handles all-zero input with a fallback that still sums to 100', () => {
    const [x, y, z] = normalizeToHundred([0, 0, 0])
    expect(x + y + z).toBe(100)
  })

  it('handles a single dominant weight', () => {
    const [x, y, z] = normalizeToHundred([100, 0, 0])
    expect(x + y + z).toBe(100)
    expect(x).toBe(100)
  })
})

describe('computePrediction - pre-match', () => {
  it('returns the exact fixture priors', () => {
    const match = cloneMatch({ phase: 'pre-match', minute: 0 })
    const result = computePrediction(match, PRE_MATCH_MODEL)
    expect(result.probabilities).toEqual({ home: 51, draw: 25, away: 24 })
    expect(result.projectedScore).toEqual({ home: 2, away: 1 })
    expect(result.expectedGoals).toEqual({ home: 1.75, away: 1.25 })
    expect(result.btts).toBe(64)
    expect(result.over25).toBe(61)
    expect(result.confidence).toBeCloseTo(6.5)
  })
})

describe('computePrediction - probability sums', () => {
  it('always sums to 100 across a sweep of live states', () => {
    const phases: Match['phase'][] = ['first-half', 'half-time', 'second-half', 'full-time']
    const scores = [
      { home: 0, away: 0 },
      { home: 1, away: 0 },
      { home: 0, away: 1 },
      { home: 2, away: 1 },
      { home: 1, away: 1 },
      { home: 3, away: 2 },
    ]
    const redCardCombos = [
      { home: 0, away: 0 },
      { home: 1, away: 0 },
      { home: 0, away: 1 },
      { home: 1, away: 1 },
    ]
    const momentumCombos = [
      { home: 0, away: 0 },
      { home: 1, away: 0 },
      { home: 0.5, away: 0.5 },
      { home: 0.2, away: 0.9 },
    ]

    for (const phase of phases) {
      for (let minute = 0; minute <= 90; minute += 15) {
        for (const score of scores) {
          for (const redCards of redCardCombos) {
            for (const momentum of momentumCombos) {
              const match = cloneMatch({ phase, minute, score, redCards, momentum })
              const result = computePrediction(match, PRE_MATCH_MODEL)
              const { home, draw, away } = result.probabilities
              expect(home + draw + away).toBe(100)
              expect(result.btts).toBeGreaterThanOrEqual(0)
              expect(result.btts).toBeLessThanOrEqual(100)
              expect(result.over25).toBeGreaterThanOrEqual(0)
              expect(result.over25).toBeLessThanOrEqual(100)
              expect(result.confidence).toBeGreaterThanOrEqual(0)
              expect(result.confidence).toBeLessThanOrEqual(10)
            }
          }
        }
      }
    }
  })
})

describe('computePrediction - goal effects', () => {
  it('a home goal increases home win probability relative to the same state without it', () => {
    const base = cloneMatch({ phase: 'second-half', minute: 60, score: { home: 0, away: 0 } })
    const withHomeGoal = cloneMatch({
      phase: 'second-half',
      minute: 60,
      score: { home: 1, away: 0 },
    })
    const baseResult = computePrediction(base, PRE_MATCH_MODEL)
    const goalResult = computePrediction(withHomeGoal, PRE_MATCH_MODEL)
    expect(goalResult.probabilities.home).toBeGreaterThan(baseResult.probabilities.home)
  })

  it('an away goal increases away win probability relative to the same state without it', () => {
    const base = cloneMatch({ phase: 'second-half', minute: 60, score: { home: 0, away: 0 } })
    const withAwayGoal = cloneMatch({
      phase: 'second-half',
      minute: 60,
      score: { home: 0, away: 1 },
    })
    const baseResult = computePrediction(base, PRE_MATCH_MODEL)
    const goalResult = computePrediction(withAwayGoal, PRE_MATCH_MODEL)
    expect(goalResult.probabilities.away).toBeGreaterThan(baseResult.probabilities.away)
  })
})

describe('computePrediction - red cards', () => {
  it('a red card for home decreases home win probability', () => {
    const base = cloneMatch({
      phase: 'second-half',
      minute: 50,
      score: { home: 1, away: 1 },
      redCards: { home: 0, away: 0 },
    })
    const withRed = cloneMatch({
      phase: 'second-half',
      minute: 50,
      score: { home: 1, away: 1 },
      redCards: { home: 1, away: 0 },
    })
    const baseResult = computePrediction(base, PRE_MATCH_MODEL)
    const redResult = computePrediction(withRed, PRE_MATCH_MODEL)
    expect(redResult.probabilities.home).toBeLessThan(baseResult.probabilities.home)
  })
})

describe('computePrediction - momentum', () => {
  it('higher home momentum yields a higher home win probability', () => {
    const low = cloneMatch({
      phase: 'second-half',
      minute: 60,
      score: { home: 1, away: 1 },
      momentum: { home: 0, away: 0 },
    })
    const high = cloneMatch({
      phase: 'second-half',
      minute: 60,
      score: { home: 1, away: 1 },
      momentum: { home: 1, away: 0 },
    })
    const lowResult = computePrediction(low, PRE_MATCH_MODEL)
    const highResult = computePrediction(high, PRE_MATCH_MODEL)
    expect(highResult.probabilities.home).toBeGreaterThan(lowResult.probabilities.home)
  })
})

describe('computePrediction - time decay of uncertainty', () => {
  it('a late lead is much more decisive than the same lead earlier in the match', () => {
    const midMatch = cloneMatch({ phase: 'second-half', minute: 50, score: { home: 1, away: 0 } })
    const lateMatch = cloneMatch({ phase: 'second-half', minute: 85, score: { home: 1, away: 0 } })
    const midResult = computePrediction(midMatch, PRE_MATCH_MODEL)
    const lateResult = computePrediction(lateMatch, PRE_MATCH_MODEL)
    expect(lateResult.probabilities.home).toBeGreaterThan(midResult.probabilities.home)
  })
})

describe('computePrediction - stoppage time', () => {
  it('keeps a 1-0 lead short of certainty while second-half stoppage is played', () => {
    const inStoppage = cloneMatch({
      phase: 'second-half',
      minute: 90,
      stoppageMinute: 3,
      announcedStoppage: { firstHalf: 2, secondHalf: 5 },
      score: { home: 1, away: 0 },
    })
    const result = computePrediction(inStoppage, PRE_MATCH_MODEL)
    expect(result.probabilities.home).toBeGreaterThan(80)
    expect(result.probabilities.home).toBeLessThan(100)
  })

  it('never reaches certainty even when play runs past the announced added time', () => {
    const deepStoppage = cloneMatch({
      phase: 'second-half',
      minute: 90,
      stoppageMinute: 9,
      announcedStoppage: { firstHalf: 2, secondHalf: 5 },
      score: { home: 1, away: 0 },
    })
    const result = computePrediction(deepStoppage, PRE_MATCH_MODEL)
    expect(result.probabilities.home).toBeLessThan(100)
    expect(result.probabilities.away).toBeGreaterThanOrEqual(0)
  })

  it('a longer announced board keeps the trailing team more alive', () => {
    const shortBoard = cloneMatch({
      phase: 'second-half',
      minute: 90,
      stoppageMinute: 0,
      announcedStoppage: { firstHalf: 2, secondHalf: 1 },
      score: { home: 1, away: 0 },
    })
    const longBoard = cloneMatch({
      phase: 'second-half',
      minute: 90,
      stoppageMinute: 0,
      announcedStoppage: { firstHalf: 2, secondHalf: 9 },
      score: { home: 1, away: 0 },
    })
    const shortResult = computePrediction(shortBoard, PRE_MATCH_MODEL)
    const longResult = computePrediction(longBoard, PRE_MATCH_MODEL)
    expect(shortResult.probabilities.home).toBeGreaterThan(longResult.probabilities.home)
  })

  it('first-half stoppage still leaves the whole second half in the model', () => {
    const firstHalfStoppage = cloneMatch({
      phase: 'first-half',
      minute: 45,
      stoppageMinute: 2,
      score: { home: 1, away: 0 },
    })
    const halfTime = cloneMatch({
      phase: 'half-time',
      minute: 45,
      score: { home: 1, away: 0 },
    })
    const inStoppage = computePrediction(firstHalfStoppage, PRE_MATCH_MODEL)
    const atBreak = computePrediction(halfTime, PRE_MATCH_MODEL)
    // Similar amounts of match left → similar (not wildly different) leads.
    expect(Math.abs(inStoppage.probabilities.home - atBreak.probabilities.home)).toBeLessThan(6)
    expect(inStoppage.probabilities.home).toBeLessThan(90)
  })
})

describe('computePrediction - full-time', () => {
  it('locks the winner at 100% with confidence 10', () => {
    const match = cloneMatch({ phase: 'full-time', minute: 90, score: { home: 2, away: 1 } })
    const result = computePrediction(match, PRE_MATCH_MODEL)
    expect(result.probabilities.home).toBe(100)
    expect(result.probabilities.draw).toBe(0)
    expect(result.probabilities.away).toBe(0)
    expect(result.confidence).toBe(10)
  })

  it('locks the draw at 100% when scores are level', () => {
    const match = cloneMatch({ phase: 'full-time', minute: 90, score: { home: 1, away: 1 } })
    const result = computePrediction(match, PRE_MATCH_MODEL)
    expect(result.probabilities.draw).toBe(100)
    expect(result.probabilities.home).toBe(0)
    expect(result.probabilities.away).toBe(0)
    expect(result.confidence).toBe(10)
  })
})

describe('computePrediction - btts / over 2.5 certainty', () => {
  it('2-1 at any live minute is certain over 2.5 and certain btts', () => {
    for (const minute of [1, 30, 45, 60, 89]) {
      const match = cloneMatch({ phase: 'second-half', minute, score: { home: 2, away: 1 } })
      const result = computePrediction(match, PRE_MATCH_MODEL)
      expect(result.over25).toBe(100)
      expect(result.btts).toBe(100)
    }
  })
})

describe('computePrediction - determinism', () => {
  it('returns identical output for identical input', () => {
    const match = cloneMatch({
      phase: 'second-half',
      minute: 67,
      score: { home: 1, away: 1 },
      redCards: { home: 0, away: 1 },
      momentum: { home: 0.6, away: 0.3 },
    })
    const a = computePrediction(match, PRE_MATCH_MODEL)
    const b = computePrediction(match, PRE_MATCH_MODEL)
    expect(a).toEqual(b)
  })
})

describe('computePrediction - nextGoalLean', () => {
  it('leans toward the team with the higher effective remaining xG', () => {
    const match = cloneMatch({
      phase: 'second-half',
      minute: 50,
      redCards: { home: 0, away: 1 },
    })
    const result = computePrediction(match, PRE_MATCH_MODEL)
    expect(result.nextGoalLean).toBe('home')
  })

  it('is even when the state is symmetric', () => {
    const match = cloneMatch({
      phase: 'pre-match',
    })
    // Use a symmetric preMatch model to check the 'even' branch explicitly.
    const symmetric = { ...PRE_MATCH_MODEL, xgHome: 1.5, xgAway: 1.5 }
    const result = computePrediction({ ...match, phase: 'second-half', minute: 50 }, symmetric)
    expect(result.nextGoalLean).toBe('even')
  })
})
