import type { Match, MatchEvent, MatchEventType, PenaltyKick, Score, TeamId } from '../domain/types'
import { createInitialMatch, PRE_MATCH_MODEL } from '../domain/fixture'
import {
  DEFAULT_STOPPAGE,
  ET_FIRST_END,
  ET_SECOND_END,
  isExtraTimePhase,
  matchEffectiveMinute,
} from '../domain/clock'
import { computeMomentum } from '../domain/momentum'
import type { LiveMatchProvider, MatchUpdate, SimulationControls } from './LiveMatchProvider'

const HALF_TIME_MINUTE = 45
const FULL_TIME_MINUTE = 90
const SUBSTITUTION_MIN_MINUTE = 55

/** Short breaks (extra-time break, ET half-time) last this many ticks. */
const EXTRA_TIME_BREAK_TICKS = 2
const ET_HALF_TIME_TICKS = 2

/** Tired legs: shot rate is dampened during extra time. */
const ET_INTENSITY_FACTOR = 0.9

/** Chance a penalty kick is converted. */
const PENALTY_CONVERSION = 0.75

/** A shoot-out is best-of-5 per side before sudden death kicks in. */
const PENALTY_BEST_OF = 5

const SUPPORTED_SPEEDS = [1, 15, 60] as const
type Speed = (typeof SUPPORTED_SPEEDS)[number]
const DEFAULT_SPEED: Speed = 60

function isSupportedSpeed(value: number): value is Speed {
  return (SUPPORTED_SPEEDS as readonly number[]).includes(value)
}

// --- Shot model ------------------------------------------------------------
//
// Shots drive goals (rather than a flat per-minute goal chance). Each team's
// base shot rate is derived from its pre-match xG: xG = shots * xgPerShot, so
// shotsPerMinute = (teamXg / XG_PER_SHOT) / TOTAL_EXPECTED_MINUTES.
//
// Sanity check (the calibration this is meant to preserve):
//   shotsPerMinute * TOTAL_EXPECTED_MINUTES * XG_PER_SHOT ≈ teamXg
//   home: 0.1374 * 98 * 0.13 ≈ 1.75   away: 0.0981 * 98 * 0.13 ≈ 1.25
const XG_PER_SHOT = 0.13
const TOTAL_EXPECTED_MINUTES = 98

const BIG_CHANCE_PROBABILITY = 0.18
const BIG_CHANCE_XG = 0.35
const REGULAR_SHOT_XG = 0.08
const BIG_CHANCE_ON_TARGET_PROBABILITY = 0.7
const REGULAR_ON_TARGET_PROBABILITY = 0.32

const RED_CARD_OWN_FACTOR = 0.62
const RED_CARD_OPP_FACTOR = 1.25
const MOMENTUM_SHOT_BOOST = 0.5
const CHASE_START_MINUTE = 70
const CHASE_TRAILING_FACTOR = 1.3
const CHASE_LEADING_FACTOR = 0.85

const YELLOW_CARD_PROBABILITY = 0.03
const SUBSTITUTION_PROBABILITY = 0.03

const EXTRA_STOPPAGE_MINUTE_PROBABILITY = 0.25

type WeightedOption = readonly [value: number, weight: number]

// Weights per spec: first half 2-5 min (20/35/30/15), second half 3-7 min
// (10/25/30/20/15). Both sum to 100.
const FIRST_HALF_STOPPAGE_WEIGHTS: readonly WeightedOption[] = [
  [2, 20],
  [3, 35],
  [4, 30],
  [5, 15],
]
const SECOND_HALF_STOPPAGE_WEIGHTS: readonly WeightedOption[] = [
  [3, 10],
  [4, 25],
  [5, 30],
  [6, 20],
  [7, 15],
]
// Extra-time halves are shorter, so the board tends to show less added time.
const ET_FIRST_STOPPAGE_WEIGHTS: readonly WeightedOption[] = [
  [0, 25],
  [1, 45],
  [2, 30],
]
const ET_SECOND_STOPPAGE_WEIGHTS: readonly WeightedOption[] = [
  [1, 35],
  [2, 40],
  [3, 25],
]

type StoppageHalf = 'firstHalf' | 'secondHalf' | 'extraTimeFirst' | 'extraTimeSecond'

const STOPPAGE_WEIGHTS: Record<StoppageHalf, readonly WeightedOption[]> = {
  firstHalf: FIRST_HALF_STOPPAGE_WEIGHTS,
  secondHalf: SECOND_HALF_STOPPAGE_WEIGHTS,
  extraTimeFirst: ET_FIRST_STOPPAGE_WEIGHTS,
  extraTimeSecond: ET_SECOND_STOPPAGE_WEIGHTS,
}

function weightedSample(options: readonly WeightedOption[]): number {
  const total = options.reduce((sum, [, weight]) => sum + weight, 0)
  let roll = Math.random() * total
  for (const [value, weight] of options) {
    if (roll < weight) return value
    roll -= weight
  }
  return options[options.length - 1][0]
}

function opponent(team: TeamId): TeamId {
  return team === 'home' ? 'away' : 'home'
}

function baseShotsPerMinute(team: TeamId): number {
  const teamXg = team === 'home' ? PRE_MATCH_MODEL.xgHome : PRE_MATCH_MODEL.xgAway
  return teamXg / XG_PER_SHOT / TOTAL_EXPECTED_MINUTES
}

/**
 * Real-time client-side match simulator. Holds the single source-of-truth
 * `Match`, mutates it on a timer (or via manual injection), and pushes
 * immutable snapshots to subscribers. The simulation itself is allowed to
 * use randomness for ambient events (ordinary football happening) — the
 * *prediction* model that consumes this data (src/domain/prediction.ts)
 * stays pure and deterministic, and so does the momentum model
 * (src/domain/momentum.ts) — this provider only ever calls `computeMomentum`
 * and stores the result, it never hand-tunes momentum values.
 */
export class SimulatedMatchProvider implements LiveMatchProvider, SimulationControls {
  private match: Match = createInitialMatch()
  private listeners = new Set<(update: MatchUpdate) => void>()
  private timer: ReturnType<typeof setInterval> | null = null
  private running = false
  private eventCounter = 0
  private speed: Speed
  /** Ticks left in the current short break (extra-time break or ET half-time). */
  private breakTicksRemaining = 0

  constructor(initialSpeed: number = DEFAULT_SPEED) {
    this.speed = isSupportedSpeed(initialSpeed) ? initialSpeed : DEFAULT_SPEED
  }

  subscribe(listener: (update: MatchUpdate) => void): () => void {
    this.listeners.add(listener)
    listener({ match: this.snapshot(), status: this.running ? 'live' : 'live' })
    return () => this.listeners.delete(listener)
  }

  dispose(): void {
    this.stopTimer()
    this.listeners.clear()
  }

  start(): void {
    if (this.match.phase === 'full-time') return

    if (this.match.phase === 'pre-match') {
      this.match = {
        ...this.match,
        phase: 'first-half',
      }
      this.appendEvent({
        minute: 0,
        type: 'kickoff',
        description: 'Kick-off in Miami.',
        modelReaction: 'Pre-match probabilities activated.',
      })
    }

    this.running = true
    this.startTimer()
    this.emit('live')
  }

  pause(): void {
    this.running = false
    this.stopTimer()
    this.emit('paused')
  }

  reset(): void {
    this.stopTimer()
    this.running = false
    this.eventCounter = 0
    this.breakTicksRemaining = 0
    this.match = createInitialMatch()
    this.emit('live')
  }

  injectGoal(team: TeamId): void {
    if (!this.canInject()) return
    this.recordShot(team, true)
    this.scoreGoal(team, 'A well-worked finish')
    this.emit(this.statusForCurrentState())
  }

  injectChance(team: TeamId): void {
    if (!this.canInject()) return
    this.recordShot(team, true)
    this.recordShotOnTarget(team, true)
    this.emit(this.statusForCurrentState())
  }

  injectRedCard(team: TeamId): void {
    if (!this.canInject()) return
    this.sendOff(team)
    this.emit(this.statusForCurrentState())
  }

  advanceClock(minutes: number): void {
    if (!this.hasStarted()) return
    const steps = Math.max(0, Math.floor(minutes))
    for (let i = 0; i < steps && this.match.phase !== 'full-time'; i++) {
      this.advanceOneGameMinute(false)
    }
    this.emit(this.statusForCurrentState())
  }

  isRunning(): boolean {
    return this.running
  }

  setSpeed(multiplier: number): void {
    if (!isSupportedSpeed(multiplier)) return
    this.speed = multiplier
    if (this.running) {
      this.startTimer()
    }
    this.emit(this.statusForCurrentState())
  }

  getSpeed(): number {
    return this.speed
  }

  // --- internals ---------------------------------------------------------

  private hasStarted(): boolean {
    return this.match.phase !== 'pre-match'
  }

  /** Manual injections only make sense while open play is actually happening. */
  private canInject(): boolean {
    return this.hasStarted() && this.match.phase !== 'full-time' && this.match.phase !== 'penalties'
  }

  private statusForCurrentState(): MatchUpdate['status'] {
    return this.running ? 'live' : 'paused'
  }

  private startTimer(): void {
    this.stopTimer()
    this.timer = setInterval(() => this.tick(), 60000 / this.speed)
  }

  private stopTimer(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private tick(): void {
    this.advanceOneGameMinute(true)
    this.emit(this.running ? 'live' : 'paused')

    if (this.match.phase === 'full-time') {
      this.stopTimer()
      this.running = false
    }
  }

  /** Advances the match by exactly one match-minute worth of state, whatever phase it's in. */
  private advanceOneGameMinute(allowRandomEvents: boolean): void {
    if (this.match.phase === 'half-time') {
      // One tick of stoppage, then kick off the second half.
      this.match = { ...this.match, phase: 'second-half' }
      this.appendEvent({
        minute: this.match.minute,
        type: 'second-half-start',
        description: 'Second half under way.',
        modelReaction: 'Remaining-time model resets its xG clock for the second 45.',
      })
      return
    }

    if (this.match.phase === 'first-half') {
      this.tickFirstHalf(allowRandomEvents)
      return
    }

    if (this.match.phase === 'second-half') {
      this.tickSecondHalf(allowRandomEvents)
      return
    }

    if (this.match.phase === 'extra-time-break') {
      this.tickExtraTimeBreak()
      return
    }

    if (this.match.phase === 'extra-time-first') {
      this.tickExtraTimeFirst(allowRandomEvents)
      return
    }

    if (this.match.phase === 'extra-time-half-time') {
      this.tickExtraTimeHalfTime()
      return
    }

    if (this.match.phase === 'extra-time-second') {
      this.tickExtraTimeSecond(allowRandomEvents)
      return
    }

    if (this.match.phase === 'penalties') {
      this.tickPenalties()
      return
    }

    // pre-match / full-time: nothing to advance.
  }

  private tickFirstHalf(allowRandomEvents: boolean): void {
    if (this.match.minute < HALF_TIME_MINUTE) {
      const nextMinute = Math.min(HALF_TIME_MINUTE, this.match.minute + 1)
      this.match = { ...this.match, minute: nextMinute }
      if (allowRandomEvents) this.maybeRunAmbientEvents()
      this.recomputeMomentum()

      if (this.match.minute >= HALF_TIME_MINUTE) {
        this.announceStoppage('firstHalf')
      }
      return
    }

    // Playing first-half stoppage time: minute holds at 45, stoppageMinute climbs.
    const nextStoppageMinute = this.match.stoppageMinute + 1
    this.match = { ...this.match, stoppageMinute: nextStoppageMinute }
    if (allowRandomEvents) this.maybeRunAmbientEvents()
    this.recomputeMomentum()

    const announced = this.match.announcedStoppage.firstHalf ?? DEFAULT_STOPPAGE.firstHalf
    const playExtraMinute =
      nextStoppageMinute === announced && Math.random() < EXTRA_STOPPAGE_MINUTE_PROBABILITY
    if (nextStoppageMinute >= announced && !playExtraMinute) {
      this.blowHalfTime()
    }
  }

  private tickSecondHalf(allowRandomEvents: boolean): void {
    if (this.match.minute < FULL_TIME_MINUTE) {
      const nextMinute = Math.min(FULL_TIME_MINUTE, this.match.minute + 1)
      this.match = { ...this.match, minute: nextMinute }
      if (allowRandomEvents) this.maybeRunAmbientEvents()
      this.recomputeMomentum()

      if (this.match.minute >= FULL_TIME_MINUTE) {
        this.announceStoppage('secondHalf')
      }
      return
    }

    // Playing second-half stoppage time: minute holds at 90, stoppageMinute climbs.
    const nextStoppageMinute = this.match.stoppageMinute + 1
    this.match = { ...this.match, stoppageMinute: nextStoppageMinute }
    if (allowRandomEvents) this.maybeRunAmbientEvents()
    this.recomputeMomentum()

    const announced = this.match.announcedStoppage.secondHalf ?? DEFAULT_STOPPAGE.secondHalf
    const playExtraMinute =
      nextStoppageMinute === announced && Math.random() < EXTRA_STOPPAGE_MINUTE_PROBABILITY
    if (nextStoppageMinute >= announced && !playExtraMinute) {
      if (this.match.knockout && this.match.score.home === this.match.score.away) {
        this.startExtraTimeBreak()
      } else {
        this.blowFullTime()
      }
    }
  }

  private tickExtraTimeBreak(): void {
    this.breakTicksRemaining -= 1
    if (this.breakTicksRemaining > 0) return

    this.match = { ...this.match, phase: 'extra-time-first' }
    this.appendEvent({
      minute: this.match.minute,
      type: 'extra-time-start',
      description: 'Extra time under way.',
      modelReaction: 'Model resets its clock for 30 more minutes — draw probability drops to zero.',
    })
  }

  private tickExtraTimeFirst(allowRandomEvents: boolean): void {
    if (this.match.minute < ET_FIRST_END) {
      const nextMinute = Math.min(ET_FIRST_END, this.match.minute + 1)
      this.match = { ...this.match, minute: nextMinute }
      if (allowRandomEvents) this.maybeRunAmbientEvents()
      this.recomputeMomentum()

      if (this.match.minute >= ET_FIRST_END) {
        this.announceStoppage('extraTimeFirst')
      }
      return
    }

    // Playing ET1 stoppage time: minute holds at 105, stoppageMinute climbs.
    const nextStoppageMinute = this.match.stoppageMinute + 1
    this.match = { ...this.match, stoppageMinute: nextStoppageMinute }
    if (allowRandomEvents) this.maybeRunAmbientEvents()
    this.recomputeMomentum()

    const announced = this.match.announcedStoppage.extraTimeFirst ?? DEFAULT_STOPPAGE.extraTimeFirst
    const playExtraMinute =
      nextStoppageMinute === announced && Math.random() < EXTRA_STOPPAGE_MINUTE_PROBABILITY
    if (nextStoppageMinute >= announced && !playExtraMinute) {
      this.blowExtraTimeHalfTime()
    }
  }

  private blowExtraTimeHalfTime(): void {
    this.appendEvent({
      minute: this.match.minute,
      stoppageMinute: this.currentStoppageMinute(),
      type: 'extra-time-half-time',
      description: 'End of the first period of extra time.',
      modelReaction: 'Model holds probabilities steady for the short turnaround.',
    })
    this.match = { ...this.match, phase: 'extra-time-half-time', stoppageMinute: 0 }
    this.breakTicksRemaining = ET_HALF_TIME_TICKS
  }

  private tickExtraTimeHalfTime(): void {
    this.breakTicksRemaining -= 1
    if (this.breakTicksRemaining > 0) return

    this.match = { ...this.match, phase: 'extra-time-second' }
    this.appendEvent({
      minute: this.match.minute,
      type: 'extra-time-second-start',
      description: 'Second period of extra time under way.',
      modelReaction: 'Model resets its clock for the final 15 minutes.',
    })
  }

  private tickExtraTimeSecond(allowRandomEvents: boolean): void {
    if (this.match.minute < ET_SECOND_END) {
      const nextMinute = Math.min(ET_SECOND_END, this.match.minute + 1)
      this.match = { ...this.match, minute: nextMinute }
      if (allowRandomEvents) this.maybeRunAmbientEvents()
      this.recomputeMomentum()

      if (this.match.minute >= ET_SECOND_END) {
        this.announceStoppage('extraTimeSecond')
      }
      return
    }

    // Playing ET2 stoppage time: minute holds at 120, stoppageMinute climbs.
    const nextStoppageMinute = this.match.stoppageMinute + 1
    this.match = { ...this.match, stoppageMinute: nextStoppageMinute }
    if (allowRandomEvents) this.maybeRunAmbientEvents()
    this.recomputeMomentum()

    const announced =
      this.match.announcedStoppage.extraTimeSecond ?? DEFAULT_STOPPAGE.extraTimeSecond
    const playExtraMinute =
      nextStoppageMinute === announced && Math.random() < EXTRA_STOPPAGE_MINUTE_PROBABILITY
    if (nextStoppageMinute >= announced && !playExtraMinute) {
      if (this.match.score.home === this.match.score.away) {
        this.startPenalties()
      } else {
        this.blowFullTimeAfterExtraTime()
      }
    }
  }

  private startExtraTimeBreak(): void {
    this.appendEvent({
      minute: this.match.minute,
      stoppageMinute: this.currentStoppageMinute(),
      type: 'clock',
      description: 'Level after 90 — extra time coming.',
      modelReaction: 'Model holds the draw scenario open — 30 more minutes to separate the sides.',
    })
    this.match = { ...this.match, phase: 'extra-time-break', stoppageMinute: 0 }
    this.breakTicksRemaining = EXTRA_TIME_BREAK_TICKS
  }

  private startPenalties(): void {
    this.appendEvent({
      minute: this.match.minute,
      type: 'penalties-start',
      description: 'It goes to penalties.',
      modelReaction:
        'Model switches to shoot-out mode — the outcome is now a run of individual kicks.',
    })
    this.match = {
      ...this.match,
      phase: 'penalties',
      penalties: { score: { home: 0, away: 0 }, kicks: [], firstKicker: 'home', winner: null },
    }
  }

  private tickPenalties(): void {
    const penalties = this.match.penalties
    if (!penalties || penalties.winner) return

    const kicker =
      penalties.kicks.length % 2 === 0 ? penalties.firstKicker : opponent(penalties.firstKicker)
    const scored = Math.random() < PENALTY_CONVERSION
    const kicks: PenaltyKick[] = [...penalties.kicks, { team: kicker, scored }]
    const score: Score = {
      ...penalties.score,
      [kicker]: penalties.score[kicker] + (scored ? 1 : 0),
    }
    const winner = this.decideShootoutWinner(kicks, score)

    this.match = { ...this.match, penalties: { ...penalties, kicks, score, winner } }

    const teamName = this.match.teams[kicker].name
    const tally = `${score.home}–${score.away}`
    this.appendEvent({
      minute: this.match.minute,
      type: scored ? 'penalty-scored' : 'penalty-missed',
      team: kicker,
      description: scored
        ? `Penalty — ${teamName} score. ${tally}.`
        : `Penalty — ${teamName} miss. ${tally}.`,
      modelReaction: scored
        ? `${teamName} converts — shoot-out score moves to ${tally}.`
        : `${teamName} misses — shoot-out score holds at ${tally}.`,
    })

    if (!winner) return

    const winnerName = this.match.teams[winner].name
    this.appendEvent({
      minute: this.match.minute,
      type: 'full-time',
      description: `${winnerName} win the shoot-out ${score[winner]}–${score[opponent(winner)]}.`,
      modelReaction: 'Result is locked in — probabilities settle at the final outcome.',
    })
    this.match = { ...this.match, phase: 'full-time' }
  }

  /**
   * Best-of-5 first, decided as soon as the trailing side cannot catch up
   * even scoring every remaining kick in their first 5. Level after 5 each
   * goes to sudden death, decided after each completed pair.
   */
  private decideShootoutWinner(kicks: PenaltyKick[], score: Score): TeamId | null {
    const homeTaken = kicks.filter((k) => k.team === 'home').length
    const awayTaken = kicks.filter((k) => k.team === 'away').length

    if (homeTaken <= PENALTY_BEST_OF && awayTaken <= PENALTY_BEST_OF) {
      const homeRemaining = PENALTY_BEST_OF - homeTaken
      const awayRemaining = PENALTY_BEST_OF - awayTaken
      if (score.home > score.away + awayRemaining) return 'home'
      if (score.away > score.home + homeRemaining) return 'away'
      return null
    }

    if (homeTaken === awayTaken && score.home !== score.away) {
      return score.home > score.away ? 'home' : 'away'
    }
    return null
  }

  private blowFullTimeAfterExtraTime(): void {
    this.appendEvent({
      minute: this.match.minute,
      stoppageMinute: this.currentStoppageMinute(),
      type: 'full-time',
      description: 'Full-time whistle after extra time.',
      modelReaction: 'Result is locked in — probabilities settle at the final outcome.',
    })
    this.match = { ...this.match, phase: 'full-time' }
  }

  private announceStoppage(half: StoppageHalf): void {
    const minutes = weightedSample(STOPPAGE_WEIGHTS[half])

    this.match = {
      ...this.match,
      announcedStoppage: { ...this.match.announcedStoppage, [half]: minutes },
    }
    this.appendEvent({
      minute: this.match.minute,
      type: 'stoppage-announced',
      description: `Fourth official's board goes up: +${minutes} minutes.`,
      modelReaction: `Model extends the remaining-time clock by ${minutes} minutes to match the board.`,
    })
  }

  private blowHalfTime(): void {
    this.appendEvent({
      minute: this.match.minute,
      stoppageMinute: this.currentStoppageMinute(),
      type: 'half-time',
      description: 'Half-time whistle.',
      modelReaction: 'Model holds probabilities steady until the second half resumes.',
    })
    this.match = { ...this.match, phase: 'half-time', stoppageMinute: 0 }
  }

  private blowFullTime(): void {
    this.appendEvent({
      minute: this.match.minute,
      stoppageMinute: this.currentStoppageMinute(),
      type: 'full-time',
      description: 'Full-time whistle.',
      modelReaction: 'Result is locked in — probabilities settle at the final outcome.',
    })
    this.match = { ...this.match, phase: 'full-time' }
  }

  private maybeRunAmbientEvents(): void {
    for (const team of ['home', 'away'] as TeamId[]) {
      const shotProbability = this.shotProbabilityForTeam(team)
      if (Math.random() < shotProbability) {
        this.takeShot(team)
        continue
      }
      if (Math.random() < YELLOW_CARD_PROBABILITY) {
        this.bookPlayer(team)
        continue
      }
      if (
        this.match.minute >= SUBSTITUTION_MIN_MINUTE &&
        Math.random() < SUBSTITUTION_PROBABILITY
      ) {
        this.makeSubstitution(team)
      }
    }
  }

  private shotProbabilityForTeam(team: TeamId): number {
    const base = baseShotsPerMinute(team)

    const own = this.match.redCards[team]
    const opp = this.match.redCards[opponent(team)]
    const redAdjust = Math.pow(RED_CARD_OWN_FACTOR, own) * Math.pow(RED_CARD_OPP_FACTOR, opp)

    const momentumAdjust = 1 + this.match.momentum[team] * MOMENTUM_SHOT_BOOST

    let chaseAdjust = 1
    if (this.match.minute >= CHASE_START_MINUTE) {
      const diff = this.match.score[team] - this.match.score[opponent(team)]
      if (diff < 0) chaseAdjust = CHASE_TRAILING_FACTOR
      else if (diff > 0) chaseAdjust = CHASE_LEADING_FACTOR
    }

    const etAdjust = isExtraTimePhase(this.match.phase) ? ET_INTENSITY_FACTOR : 1

    return base * redAdjust * momentumAdjust * chaseAdjust * etAdjust
  }

  private takeShot(team: TeamId): void {
    const isBigChance = Math.random() < BIG_CHANCE_PROBABILITY
    const shotXg = isBigChance ? BIG_CHANCE_XG : REGULAR_SHOT_XG
    const isGoal = Math.random() < shotXg

    if (isGoal) {
      this.recordShot(team, true)
      this.scoreGoal(team, this.randomGoalDescription())
      return
    }

    const onTargetProbability = isBigChance
      ? BIG_CHANCE_ON_TARGET_PROBABILITY
      : REGULAR_ON_TARGET_PROBABILITY
    const onTarget = Math.random() < onTargetProbability
    this.recordShot(team, onTarget)

    if (onTarget) {
      this.recordShotOnTarget(team, isBigChance)
    } else {
      this.recordShotOffTarget(team, isBigChance)
    }
  }

  private recordShot(team: TeamId, onTarget: boolean): void {
    const current = this.match.shots[team]
    this.match = {
      ...this.match,
      shots: {
        ...this.match.shots,
        [team]: { total: current.total + 1, onTarget: current.onTarget + (onTarget ? 1 : 0) },
      },
    }
  }

  private recomputeMomentum(): void {
    this.match = {
      ...this.match,
      momentum: computeMomentum(this.match.events, matchEffectiveMinute(this.match)),
    }
  }

  private scoreGoal(team: TeamId, description: string): void {
    const teamName = this.match.teams[team].name
    this.match = {
      ...this.match,
      score: {
        ...this.match.score,
        [team]: this.match.score[team] + 1,
      },
    }

    const leadDescription = this.describeLead(team)
    this.appendEvent({
      minute: this.match.minute,
      stoppageMinute: this.currentStoppageMinute(),
      type: 'goal',
      team,
      description: `GOAL! ${teamName} — ${description}.`,
      modelReaction: `${teamName} score. ${leadDescription}`,
    })
  }

  private describeLead(scoringTeam: TeamId): string {
    const { home, away } = this.match.score
    const diff = Math.abs(home - away)
    const minute = this.match.minute
    if (diff === 0) {
      return 'Scores level again — the model pulls the draw probability back up.'
    }
    const leaderIsScoringTeam =
      (scoringTeam === 'home' && home > away) || (scoringTeam === 'away' && away > home)
    if (!leaderIsScoringTeam) {
      return 'They pull one back — win probability swings back toward them.'
    }
    if (minute >= 75) {
      return 'Win probability jumps sharply — a lead this late is close to decisive.'
    }
    if (diff >= 2) {
      return 'A two-goal cushion moves win probability up substantially.'
    }
    return 'Win probability rises — there is still time for a reply, so the swing is measured.'
  }

  private recordShotOnTarget(team: TeamId, isBigChance: boolean): void {
    const teamName = this.match.teams[team].name
    const flavor = isBigChance ? 'A big chance' : 'A shot'
    this.appendEvent({
      minute: this.match.minute,
      stoppageMinute: this.currentStoppageMinute(),
      type: 'shot-on-target',
      team,
      description: `${flavor} for ${teamName} — ${this.randomSaveDescription()}.`,
      modelReaction: `${teamName} momentum ticks up — remaining xG shifts modestly their way.`,
    })
  }

  private recordShotOffTarget(team: TeamId, isBigChance: boolean): void {
    const teamName = this.match.teams[team].name
    const flavor = isBigChance ? 'A big chance' : 'A shot'
    this.appendEvent({
      minute: this.match.minute,
      stoppageMinute: this.currentStoppageMinute(),
      type: 'shot-off-target',
      team,
      description: `${flavor} for ${teamName} — ${this.randomMissDescription()}.`,
      modelReaction: `Chance goes begging for ${teamName} — model barely moves.`,
    })
  }

  private bookPlayer(team: TeamId): void {
    const teamName = this.match.teams[team].name
    this.appendEvent({
      minute: this.match.minute,
      stoppageMinute: this.currentStoppageMinute(),
      type: 'yellow-card',
      team,
      description: `Yellow card shown to a ${teamName} player for a late challenge.`,
      modelReaction:
        'No material change to the model — a yellow card alone does not move the xG rate.',
    })
  }

  private makeSubstitution(team: TeamId): void {
    const teamName = this.match.teams[team].name
    this.appendEvent({
      minute: this.match.minute,
      stoppageMinute: this.currentStoppageMinute(),
      type: 'substitution',
      team,
      description: `${teamName} make a substitution, freshening up their attack.`,
      modelReaction: 'Model treats this as neutral until on-pitch momentum shows a real shift.',
    })
  }

  private sendOff(team: TeamId): void {
    const teamName = this.match.teams[team].name
    this.match = {
      ...this.match,
      redCards: {
        ...this.match.redCards,
        [team]: this.match.redCards[team] + 1,
      },
    }
    this.appendEvent({
      minute: this.match.minute,
      stoppageMinute: this.currentStoppageMinute(),
      type: 'red-card',
      team,
      description: `RED CARD! A ${teamName} player is sent off.`,
      modelReaction: `${teamName} down to ten men — their remaining xG drops sharply while the opponent's rises.`,
    })
  }

  private currentStoppageMinute(): number | undefined {
    return this.match.stoppageMinute > 0 ? this.match.stoppageMinute : undefined
  }

  private randomGoalDescription(): string {
    const options = [
      'a composed finish inside the box',
      'a curling effort from the edge of the area',
      'a header from a set piece',
      'a swift counter-attack finished clinically',
      'a scrambled effort after a goalmouth melee',
    ]
    return options[Math.floor(Math.random() * options.length)]
  }

  private randomSaveDescription(): string {
    const options = [
      'the keeper parries it away',
      'a flying save tips it over the bar',
      'the keeper gets down well to smother it',
      'a strong hand keeps it out at the near post',
      'the keeper stands tall to block it',
    ]
    return options[Math.floor(Math.random() * options.length)]
  }

  private randomMissDescription(): string {
    const options = [
      'drags it wide of the far post',
      'blazes over the crossbar',
      'sees the effort blocked by a last-ditch defender',
      'sends it into the side netting',
      'can only watch it drift wide',
    ]
    return options[Math.floor(Math.random() * options.length)]
  }

  private appendEvent(partial: {
    minute: number
    stoppageMinute?: number
    type: MatchEventType
    team?: TeamId
    description: string
    modelReaction: string
  }): void {
    const event: MatchEvent = {
      id: `evt-${this.eventCounter++}`,
      ...partial,
    }
    this.match = { ...this.match, events: [...this.match.events, event] }
    this.recomputeMomentum()
  }

  private snapshot(): Match {
    return {
      ...this.match,
      teams: { home: { ...this.match.teams.home }, away: { ...this.match.teams.away } },
      score: { ...this.match.score },
      redCards: { ...this.match.redCards },
      shots: { home: { ...this.match.shots.home }, away: { ...this.match.shots.away } },
      announcedStoppage: { ...this.match.announcedStoppage },
      momentum: { ...this.match.momentum },
      events: this.match.events.map((e) => ({ ...e })),
      penalties: this.match.penalties
        ? {
            ...this.match.penalties,
            score: { ...this.match.penalties.score },
            kicks: this.match.penalties.kicks.map((k) => ({ ...k })),
          }
        : undefined,
    }
  }

  private emit(status: MatchUpdate['status']): void {
    const snapshot = this.snapshot()
    for (const listener of this.listeners) {
      listener({ match: snapshot, status })
    }
  }
}
