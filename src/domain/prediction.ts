import type { Match, PenaltyShootout, PredictionState, PreMatchModel, TeamId } from './types'
import {
  ET_FIRST_END,
  ET_HALF_MINUTES,
  ET_SECOND_END,
  expectedStoppage,
  isExtraTimePhase,
} from './clock'

/**
 * Deterministic, explainable prediction engine.
 *
 * The model has these regimes:
 *  - pre-match: the fixture priors are returned as-is (by construction they
 *    must match the given 51/25/24 exactly).
 *  - regulation (first-half / half-time / second-half): pre-match xG is
 *    converted into a *remaining* xG rate (scaled by time left, red cards,
 *    and momentum), then a Poisson model of remaining goals for each team is
 *    combined with the current score to derive outcome probabilities, BTTS,
 *    over/under, and a projected final score. `probabilities` here is the
 *    result at the 90' whistle — a draw is a real outcome even in a
 *    knockout, since level after 90 just means extra time follows.
 *  - extra time (extra-time-break / extra-time-first / extra-time-half-time
 *    / extra-time-second): same Poisson machinery, but the remaining-xG rate
 *    is dampened (tired legs, cagier play) and `probabilities` now means the
 *    result at the 120' whistle — a draw here means "goes to penalties".
 *  - penalties: `probabilities` come from the penalty-shootout model
 *    (`shootoutWinProbability`) instead of goals; draw is always 0. The
 *    open-play markets (btts/over25/projectedScore/expectedGoals) keep
 *    tracking the whole match including extra time — they just settle into
 *    certainties once no open-play time is left, since shootout kicks never
 *    count as goals.
 *  - full-time: certainty from the final score, unless the match went to a
 *    shootout, in which case `match.penalties.winner` decides it (the score
 *    itself is level, because shootout kicks never enter `match.score`).
 *
 * Time left is stoppage-aware: each half/extra-time period is expected to
 * run past its base minute by the fourth official's announced added time
 * (or a typical default before the board goes up), and during stoppage the
 * clock runs down toward the whistle without ever reaching certainty until
 * phase is `full-time`.
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

const REGULATION_MINUTES = 90
const HALF_MINUTES = 45
const MAX_REMAINING_GOALS = 10
/**
 * While stoppage time is being played past the announced/expected added
 * minutes, keep at least this much model time on the clock — the outcome
 * only becomes certain at the whistle (phase full-time), not before.
 */
const MIN_STOPPAGE_REMAINING = 0.5

// Tuning constants for the explainable model.
const RED_CARD_OWN_FACTOR = 0.62 // own remaining xG multiplier per red card
const RED_CARD_OWN_FLOOR = 0.15 // never suppress a team below this multiplier
const RED_CARD_OPP_FACTOR = 1.25 // opponent remaining xG multiplier per red card
const RED_CARD_OPP_CEILING = 2.5
const MOMENTUM_MAX_BOOST = 0.2 // momentum 0 -> neutral, momentum 1 -> +20% xG
const NEXT_GOAL_LEAN_EPSILON = 0.05 // xG/remaining-match difference treated as "even"
const ET_INTENSITY_FACTOR = 0.9 // extra-time xG dampener: tired legs, cagier play
const PENALTY_CONVERSION = 0.75 // historical penalty-kick conversion rate, both teams

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function stoppageRemaining(expected: number, played: number): number {
  return Math.max(expected - played, MIN_STOPPAGE_REMAINING)
}

/** Expected playing minutes still to come, stoppage-aware. */
function remainingMinutes(match: Match): number {
  const { firstHalf, secondHalf } = expectedStoppage(match)
  const restOfSecondHalf = HALF_MINUTES + secondHalf

  switch (match.phase) {
    case 'pre-match':
      return REGULATION_MINUTES + firstHalf + secondHalf
    case 'first-half':
      if (match.minute >= HALF_MINUTES) {
        return stoppageRemaining(firstHalf, match.stoppageMinute) + restOfSecondHalf
      }
      return HALF_MINUTES - match.minute + firstHalf + restOfSecondHalf
    case 'half-time':
      return restOfSecondHalf
    case 'second-half':
      if (match.minute >= REGULATION_MINUTES) {
        return stoppageRemaining(secondHalf, match.stoppageMinute)
      }
      return REGULATION_MINUTES - match.minute + secondHalf
    case 'full-time':
      return 0
    default:
      // Extra time / penalties are handled by remainingExtraTimeMinutes.
      return 0
  }
}

/**
 * Expected playing minutes still to come in extra time, to the 120'
 * whistle. Mirrors remainingMinutes' half logic, one ET period at a time.
 */
function remainingExtraTimeMinutes(match: Match): number {
  const { extraTimeFirst, extraTimeSecond } = expectedStoppage(match)
  const restOfEtSecondHalf = ET_HALF_MINUTES + extraTimeSecond

  switch (match.phase) {
    case 'extra-time-break':
      return ET_HALF_MINUTES + extraTimeFirst + restOfEtSecondHalf
    case 'extra-time-first':
      if (match.minute >= ET_FIRST_END) {
        return stoppageRemaining(extraTimeFirst, match.stoppageMinute) + restOfEtSecondHalf
      }
      return ET_FIRST_END - match.minute + extraTimeFirst + restOfEtSecondHalf
    case 'extra-time-half-time':
      return restOfEtSecondHalf
    case 'extra-time-second':
      if (match.minute >= ET_SECOND_END) {
        return stoppageRemaining(extraTimeSecond, match.stoppageMinute)
      }
      return ET_SECOND_END - match.minute + extraTimeSecond
    case 'penalties':
      return 0
    default:
      return 0
  }
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

function freshShootout(): PenaltyShootout {
  return { score: { home: 0, away: 0 }, kicks: [], firstKicker: 'home', winner: null }
}

/**
 * Best-of-5-then-sudden-death decision check, from raw converted counts and
 * kicks taken per team. Returns the winner if the state is already
 * mathematically decided, otherwise null.
 */
function decidedShootoutWinner(
  homeScore: number,
  awayScore: number,
  homeTaken: number,
  awayTaken: number,
): TeamId | null {
  const inSuddenDeath = homeTaken >= 5 && awayTaken >= 5
  if (!inSuddenDeath) {
    // Decided as soon as a team's converted count can't be caught even if
    // the opponent scores every one of their remaining first-5 kicks.
    const homeRemaining = Math.max(0, 5 - homeTaken)
    const awayRemaining = Math.max(0, 5 - awayTaken)
    if (homeScore > awayScore + awayRemaining) return 'home'
    if (awayScore > homeScore + homeRemaining) return 'away'
    return null
  }
  // Sudden death: only decide once the current pair has both been taken —
  // a lone made kick doesn't win it until the opponent's reply is known.
  if (homeTaken === awayTaken) {
    if (homeScore > awayScore) return 'home'
    if (awayScore > homeScore) return 'away'
  }
  return null
}

/**
 * P(home wins) from a given shootout state, recursing over the two outcomes
 * of each remaining kick. Bounded depth: the regular best-of-5 phase is at
 * most 10 kicks deep, and every sudden-death round either decides the tie
 * or returns to the symmetric level-sudden-death base case below — it never
 * has to recurse round after round.
 */
function shootoutWinProbabilityFrom(
  homeScore: number,
  awayScore: number,
  homeTaken: number,
  awayTaken: number,
  nextKicker: TeamId,
  conversion: number,
): number {
  const decided = decidedShootoutWinner(homeScore, awayScore, homeTaken, awayTaken)
  if (decided === 'home') return 1
  if (decided === 'away') return 0

  // Sudden death, level, pair just completed (or not yet started): every
  // future round is a fresh coin flip between two equally-skilled kickers,
  // so this resolves to exactly 0.5 by symmetry — no need to recurse forever.
  if (homeTaken >= 5 && awayTaken >= 5 && homeTaken === awayTaken && homeScore === awayScore) {
    return 0.5
  }

  const scores = nextKicker === 'home' ? homeScore + 1 : homeScore
  const scoresAway = nextKicker === 'away' ? awayScore + 1 : awayScore
  const takenHome = nextKicker === 'home' ? homeTaken + 1 : homeTaken
  const takenAway = nextKicker === 'away' ? awayTaken + 1 : awayTaken

  const ifScored = shootoutWinProbabilityFrom(
    scores,
    scoresAway,
    takenHome,
    takenAway,
    opponent(nextKicker),
    conversion,
  )
  const ifMissed = shootoutWinProbabilityFrom(
    homeScore,
    awayScore,
    takenHome,
    takenAway,
    opponent(nextKicker),
    conversion,
  )

  return conversion * ifScored + (1 - conversion) * ifMissed
}

/**
 * P(home wins) the penalty shootout. Kicks alternate strictly starting with
 * `firstKicker`; the next kicker is determined purely by the parity of
 * `kicks.length`. Pure and deterministic given the same shootout + conversion
 * rate — same input twice yields the identical output.
 */
export function shootoutWinProbability(
  shootout: PenaltyShootout,
  conversion = PENALTY_CONVERSION,
): number {
  if (shootout.winner === 'home') return 1
  if (shootout.winner === 'away') return 0

  const homeTaken = shootout.kicks.filter((k) => k.team === 'home').length
  const awayTaken = shootout.kicks.filter((k) => k.team === 'away').length
  const { home: homeScore, away: awayScore } = shootout.score

  const decided = decidedShootoutWinner(homeScore, awayScore, homeTaken, awayTaken)
  if (decided === 'home') return 1
  if (decided === 'away') return 0

  const nextKicker: TeamId =
    shootout.kicks.length % 2 === 0 ? shootout.firstKicker : opponent(shootout.firstKicker)

  return shootoutWinProbabilityFrom(
    homeScore,
    awayScore,
    homeTaken,
    awayTaken,
    nextKicker,
    conversion,
  )
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
  const isPenalties = match.phase === 'penalties'
  const inExtraTime = isExtraTimePhase(match.phase)

  // fractionRemaining feeds the Poisson goal model (and so the open-play
  // markets); elapsedFraction feeds confidence. Regulation and extra time
  // use different timelines/denominators — see the module doc comment.
  let fractionRemaining: number
  let elapsedFraction: number

  if (inExtraTime || isPenalties) {
    const remainingEt = remainingExtraTimeMinutes(match)
    // Extra-time xG is still expressed against the same per-90 baseXg
    // reference, just dampened by ET_INTENSITY_FACTOR (tired legs, cagier
    // extra time) rather than rescaled to a 120-minute total.
    fractionRemaining = clamp((remainingEt / REGULATION_MINUTES) * ET_INTENSITY_FACTOR, 0, 1)
    // Confidence tracks elapsed time over the full 120' timeline instead.
    elapsedFraction = clamp((ET_SECOND_END - remainingEt) / ET_SECOND_END, 0, 1)
  } else {
    const stoppage = expectedStoppage(match)
    const totalExpectedMinutes = REGULATION_MINUTES + stoppage.firstHalf + stoppage.secondHalf
    fractionRemaining = clamp(remainingMinutes(match) / totalExpectedMinutes, 0, 1)
    elapsedFraction = clamp(1 - fractionRemaining, 0, 1)
  }

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

  let [home, draw, away] = normalizeToHundred([pHome / total, pDraw / total, pAway / total])

  // Penalties: the win-meter comes from the shootout model, not goals — a
  // draw is impossible once a shootout is underway (best-of-5 then sudden
  // death always produces a winner).
  if (isPenalties) {
    const shootout = match.penalties ?? freshShootout()
    home = Math.round(shootoutWinProbability(shootout) * 100)
    away = 100 - home
    draw = 0
  }

  const currentTotalGoals = match.score.home + match.score.away
  const homeAlreadyScored = match.score.home > 0
  const awayAlreadyScored = match.score.away > 0
  const noTimeLeft = fractionRemaining <= 0

  // BTTS / over 2.5 track the whole match including extra time, excluding
  // the shootout (shootout kicks never count as goals) — they naturally
  // settle into certainties once fractionRemaining hits 0 (full-time, or
  // once extra time's open play has run out during penalties).
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
  // During penalties lambdaHome/lambdaAway are both 0 (no open-play time
  // left), so this falls through to 'even' on its own — no special-case
  // needed for the penalties phase.
  const nextGoalLean: TeamId | 'even' =
    Math.abs(xgDiff) < NEXT_GOAL_LEAN_EPSILON ? 'even' : xgDiff > 0 ? 'home' : 'away'

  // Full-time: certainty from the final score, unless the match was settled
  // by a shootout — the score itself is level in that case, since shootout
  // kicks never enter match.score, so the winner has to come from
  // match.penalties.winner instead.
  if (isFullTime && match.penalties?.winner) {
    const winner = match.penalties.winner
    home = winner === 'home' ? 100 : 0
    away = winner === 'away' ? 100 : 0
    draw = 0
  }

  const percentages = [home, draw, away].sort((a, b) => b - a)
  const separation = percentages[0] - percentages[1]

  let confidence: number
  if (isPenalties) {
    // Shootout separation only — the goal-clock elapsedFraction isn't
    // meaningful once the game has left open play.
    confidence = clamp(5 + (separation / 100) * 5, 0, 10)
  } else {
    confidence = clamp(3 + (separation / 100) * 4 + elapsedFraction * 3, 0, 10)
  }
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
