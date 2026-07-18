import type { Match, PredictionState, PreMatchModel, TeamId } from './types'

/**
 * Deterministic, explainable prediction engine.
 *
 * The model has two regimes:
 *  - pre-match: the fixture priors are returned as-is (by construction they
 *    must match the given 51/25/24 exactly).
 *  - live (first-half / half-time / second-half / full-time): pre-match xG
 *    is converted into a *remaining* xG rate (scaled by time left, red
 *    cards, and momentum), then a Poisson model of remaining goals for each
 *    team is combined with the current score to derive outcome
 *    probabilities, BTTS, over/under, and a projected final score.
 *
 * Everything here is a pure function of its inputs: no randomness, no
 * wall-clock reads. Same (match, preMatch) in, same PredictionState out.
 */

/** Poisson probability mass function, P(X = k) for X ~ Poisson(lambda). */
export function poissonPmf(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0
  if (k < 0) return 0
  let factorial = 1
  for (let i = 2; i <= k; i++) factorial *= i
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial
}

/** P(X >= k) for X ~ Poisson(lambda), i.e. 1 - CDF(k - 1). */
function poissonAtLeast(k: number, lambda: number): number {
  if (k <= 0) return 1
  let cdf = 0
  for (let i = 0; i < k; i++) cdf += poissonPmf(i, lambda)
  return Math.max(0, 1 - cdf)
}

/** Round three non-negative weights to integer percentages summing to exactly 100. */
export function normalizeToHundred(values: [number, number, number]): [number, number, number] {
  const total = values[0] + values[1] + values[2]
  // Degenerate input (all zero, or negative-sum garbage): fall back to an
  // equal-ish split so we still return something sane summing to 100.
  const weights: [number, number, number] = total > 0 ? values : [1, 1, 1]
  const weightTotal = total > 0 ? total : 3

  const raw = weights.map((v) => (Math.max(0, v) / weightTotal) * 100)
  const floors = raw.map((r) => Math.floor(r))
  const flooredSum = floors.reduce((a, b) => a + b, 0)
  let remainder = 100 - flooredSum

  const order = raw.map((r, i) => ({ i, frac: r - floors[i] })).sort((a, b) => b.frac - a.frac)

  const result = [...floors] as [number, number, number]
  let k = 0
  while (remainder > 0 && k < order.length) {
    result[order[k].i] += 1
    remainder -= 1
    k += 1
  }
  return result
}

const FULL_MATCH_MINUTES = 90
const MAX_REMAINING_GOALS = 10

// Tuning constants for the explainable model.
const RED_CARD_OWN_FACTOR = 0.62 // own remaining xG multiplier per red card
const RED_CARD_OWN_FLOOR = 0.15 // never suppress a team below this multiplier
const RED_CARD_OPP_FACTOR = 1.25 // opponent remaining xG multiplier per red card
const RED_CARD_OPP_CEILING = 2.5
const MOMENTUM_MAX_BOOST = 0.2 // momentum 0 -> neutral, momentum 1 -> +20% xG
const NEXT_GOAL_LEAN_EPSILON = 0.05 // xG/remaining-match difference treated as "even"

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function opponent(team: TeamId): TeamId {
  return team === 'home' ? 'away' : 'home'
}

/** Remaining-match xG rate for `team`, folding in time left, red cards, and momentum. */
function remainingXg(
  team: TeamId,
  preMatch: PreMatchModel,
  match: Match,
  fractionRemaining: number,
): number {
  const baseXg = team === 'home' ? preMatch.xgHome : preMatch.xgAway
  const ownReds = match.redCards[team]
  const oppReds = match.redCards[opponent(team)]

  const ownRedFactor = clamp(Math.pow(RED_CARD_OWN_FACTOR, ownReds), RED_CARD_OWN_FLOOR, 1)
  const oppRedFactor = clamp(Math.pow(RED_CARD_OPP_FACTOR, oppReds), 1, RED_CARD_OPP_CEILING)
  const momentumFactor = 1 + clamp(match.momentum[team], 0, 1) * MOMENTUM_MAX_BOOST

  return Math.max(0, baseXg * fractionRemaining * ownRedFactor * oppRedFactor * momentumFactor)
}

/** Percent in [1, 99] unless the outcome is mathematically certain. */
function certainOrClamped(raw: number, certainZero: boolean, certainHundred: boolean): number {
  if (certainZero) return 0
  if (certainHundred) return 100
  return clamp(Math.round(raw), 1, 99)
}

export function computePrediction(match: Match, preMatch: PreMatchModel): PredictionState {
  if (match.phase === 'pre-match') {
    return {
      probabilities: { home: preMatch.homeWin, draw: preMatch.draw, away: preMatch.awayWin },
      projectedScore: { ...preMatch.projectedScore },
      expectedGoals: { home: preMatch.xgHome, away: preMatch.xgAway },
      btts: preMatch.btts,
      over25: preMatch.over25,
      nextGoalLean: preMatch.xgHome >= preMatch.xgAway ? 'home' : 'away',
      confidence: 6.5,
    }
  }

  const isFullTime = match.phase === 'full-time'
  const fractionRemaining = isFullTime
    ? 0
    : clamp((FULL_MATCH_MINUTES - match.minute) / FULL_MATCH_MINUTES, 0, 1)

  const lambdaHome = remainingXg('home', preMatch, match, fractionRemaining)
  const lambdaAway = remainingXg('away', preMatch, match, fractionRemaining)

  // Joint distribution over remaining goals, truncated at MAX_REMAINING_GOALS
  // each way — plenty of tail mass for a football score.
  let pHome = 0
  let pDraw = 0
  let pAway = 0
  let total = 0
  for (let h = 0; h <= MAX_REMAINING_GOALS; h++) {
    const ph = poissonPmf(h, lambdaHome)
    if (ph === 0 && h > 0) continue
    for (let a = 0; a <= MAX_REMAINING_GOALS; a++) {
      const pa = poissonPmf(a, lambdaAway)
      const p = ph * pa
      if (p === 0) continue
      total += p
      const finalHome = match.score.home + h
      const finalAway = match.score.away + a
      if (finalHome > finalAway) pHome += p
      else if (finalHome < finalAway) pAway += p
      else pDraw += p
    }
  }
  if (total <= 0) {
    // Should not happen (h=0,a=0 always has mass), but stay safe.
    pHome = match.score.home > match.score.away ? 1 : 0
    pAway = match.score.away > match.score.home ? 1 : 0
    pDraw = match.score.home === match.score.away ? 1 : 0
    total = 1
  }

  const [home, draw, away] = normalizeToHundred([pHome / total, pDraw / total, pAway / total])

  const currentTotalGoals = match.score.home + match.score.away
  const homeAlreadyScored = match.score.home > 0
  const awayAlreadyScored = match.score.away > 0
  const noTimeLeft = fractionRemaining <= 0

  // BTTS
  const bttsCertainHundred = homeAlreadyScored && awayAlreadyScored
  const bttsCertainZero = !bttsCertainHundred && noTimeLeft
  const pHomeScores = homeAlreadyScored ? 1 : 1 - poissonPmf(0, lambdaHome)
  const pAwayScores = awayAlreadyScored ? 1 : 1 - poissonPmf(0, lambdaAway)
  const btts = certainOrClamped(
    pHomeScores * pAwayScores * 100,
    bttsCertainZero,
    bttsCertainHundred,
  )

  // Over 2.5
  const over25CertainHundred = currentTotalGoals >= 3
  const over25CertainZero = !over25CertainHundred && noTimeLeft
  const remainingGoalsNeeded = 3 - currentTotalGoals
  const combinedLambda = lambdaHome + lambdaAway
  const over25Raw = over25CertainHundred
    ? 100
    : poissonAtLeast(remainingGoalsNeeded, combinedLambda) * 100
  const over25 = certainOrClamped(over25Raw, over25CertainZero, over25CertainHundred)

  const projectedScore = {
    home: match.score.home + Math.round(lambdaHome),
    away: match.score.away + Math.round(lambdaAway),
  }

  const xgDiff = lambdaHome - lambdaAway
  const nextGoalLean: TeamId | 'even' =
    Math.abs(xgDiff) < NEXT_GOAL_LEAN_EPSILON ? 'even' : xgDiff > 0 ? 'home' : 'away'

  const percentages = [home, draw, away].sort((a, b) => b - a)
  const separation = percentages[0] - percentages[1]
  const elapsedFraction = clamp(match.minute / FULL_MATCH_MINUTES, 0, 1)
  let confidence = clamp(3 + (separation / 100) * 4 + elapsedFraction * 3, 0, 10)
  confidence = Math.round(confidence * 10) / 10

  if (isFullTime) {
    confidence = 10
  }

  return {
    probabilities: { home, draw, away },
    projectedScore,
    expectedGoals: {
      home: match.score.home + lambdaHome,
      away: match.score.away + lambdaAway,
    },
    btts,
    over25,
    nextGoalLean,
    confidence,
  }
}
