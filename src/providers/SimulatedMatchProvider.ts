import type { Match, MatchEvent, MatchEventType, TeamId } from '../domain/types'
import { createInitialMatch } from '../domain/fixture'
import type { LiveMatchProvider, MatchUpdate, SimulationControls } from './LiveMatchProvider'

const DEFAULT_TICK_MS = 1200
const HALF_TIME_MINUTE = 45
const FULL_TIME_MINUTE = 90
const SUBSTITUTION_MIN_MINUTE = 55

const MOMENTUM_DECAY = 0.9
const MOMENTUM_CHANCE_BUMP = 0.35
const MOMENTUM_GOAL_BUMP = 0.5

// Ambient per-minute event probabilities while the sim is running.
// ~0.014/team/min ≈ 2.5 goals per simulated match before momentum/red-card
// adjustments — roughly the real-world scoring rate.
const BASE_GOAL_CHANCE_PER_MINUTE = 0.014
const CHANCE_EVENT_PROBABILITY = 0.08
const YELLOW_CARD_PROBABILITY = 0.03
const SUBSTITUTION_PROBABILITY = 0.03

function opponent(team: TeamId): TeamId {
  return team === 'home' ? 'away' : 'home'
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/**
 * Real-time client-side match simulator. Holds the single source-of-truth
 * `Match`, mutates it on a timer (or via manual injection), and pushes
 * immutable snapshots to subscribers. The simulation itself is allowed to
 * use randomness for ambient events (ordinary football happening) — the
 * *prediction* model that consumes this data (src/domain/prediction.ts)
 * stays pure and deterministic.
 */
export class SimulatedMatchProvider implements LiveMatchProvider, SimulationControls {
  private match: Match = createInitialMatch()
  private listeners = new Set<(update: MatchUpdate) => void>()
  private timer: ReturnType<typeof setInterval> | null = null
  private running = false
  private eventCounter = 0
  private readonly tickMs: number

  constructor(tickMs: number = DEFAULT_TICK_MS) {
    this.tickMs = tickMs
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
    this.match = createInitialMatch()
    this.emit('live')
  }

  injectGoal(team: TeamId): void {
    if (!this.hasStarted()) return
    this.scoreGoal(team, 'A well-worked finish')
    this.emit(this.statusForCurrentState())
  }

  injectChance(team: TeamId): void {
    if (!this.hasStarted()) return
    this.createChance(team)
    this.emit(this.statusForCurrentState())
  }

  injectRedCard(team: TeamId): void {
    if (!this.hasStarted()) return
    this.sendOff(team)
    this.emit(this.statusForCurrentState())
  }

  advanceClock(minutes: number): void {
    if (!this.hasStarted()) return
    const target = this.match.minute + Math.max(0, minutes)
    while (this.match.minute < target && this.match.phase !== 'full-time') {
      this.advanceOneMinute({ allowRandomEvents: false })
    }
    this.emit(this.statusForCurrentState())
  }

  isRunning(): boolean {
    return this.running
  }

  // --- internals ---------------------------------------------------------

  private hasStarted(): boolean {
    return this.match.phase !== 'pre-match'
  }

  private statusForCurrentState(): MatchUpdate['status'] {
    return this.running ? 'live' : 'paused'
  }

  private startTimer(): void {
    this.stopTimer()
    this.timer = setInterval(() => this.tick(), this.tickMs)
  }

  private stopTimer(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private tick(): void {
    if (this.match.phase === 'half-time') {
      // One tick of stoppage, then kick off the second half.
      this.match = { ...this.match, phase: 'second-half' }
      this.appendEvent({
        minute: this.match.minute,
        type: 'second-half-start',
        description: 'Second half under way.',
        modelReaction: 'Remaining-time model resets its xG clock for the second 45.',
      })
      this.emit('live')
      return
    }

    this.advanceOneMinute({ allowRandomEvents: true })
    this.emit(this.running ? 'live' : 'paused')

    if (this.match.phase === 'full-time') {
      this.stopTimer()
      this.running = false
    }
  }

  private advanceOneMinute({ allowRandomEvents }: { allowRandomEvents: boolean }): void {
    if (this.match.phase === 'full-time') return

    const nextMinute = Math.min(FULL_TIME_MINUTE, this.match.minute + 1)
    this.match = { ...this.match, minute: nextMinute }
    this.decayMomentum()

    if (allowRandomEvents) {
      this.maybeRunAmbientEvents()
    }

    if (this.match.minute >= HALF_TIME_MINUTE && this.match.phase === 'first-half') {
      this.match = { ...this.match, phase: 'half-time' }
      this.appendEvent({
        minute: this.match.minute,
        type: 'half-time',
        description: 'Half-time whistle.',
        modelReaction: 'Model holds probabilities steady until the second half resumes.',
      })
      return
    }

    if (this.match.minute >= FULL_TIME_MINUTE && this.match.phase === 'second-half') {
      this.match = { ...this.match, phase: 'full-time' }
      this.appendEvent({
        minute: this.match.minute,
        type: 'full-time',
        description: 'Full-time whistle.',
        modelReaction: 'Result is locked in — probabilities settle at the final outcome.',
      })
    }
  }

  private maybeRunAmbientEvents(): void {
    if (this.match.phase !== 'first-half' && this.match.phase !== 'second-half') return

    for (const team of ['home', 'away'] as TeamId[]) {
      const goalChance = this.goalProbabilityForTeam(team)
      if (Math.random() < goalChance) {
        this.scoreGoal(team, this.randomGoalDescription())
        continue
      }
      if (Math.random() < CHANCE_EVENT_PROBABILITY) {
        this.createChance(team)
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

  private goalProbabilityForTeam(team: TeamId): number {
    const own = this.match.redCards[team]
    const opp = this.match.redCards[opponent(team)]
    const redAdjust = Math.pow(0.62, own) * Math.pow(1.25, opp)
    const momentumAdjust = 1 + this.match.momentum[team] * 0.5
    return BASE_GOAL_CHANCE_PER_MINUTE * redAdjust * momentumAdjust
  }

  private decayMomentum(): void {
    this.match = {
      ...this.match,
      momentum: {
        home: clamp01(this.match.momentum.home * MOMENTUM_DECAY),
        away: clamp01(this.match.momentum.away * MOMENTUM_DECAY),
      },
    }
  }

  private bumpMomentum(team: TeamId, amount: number): void {
    this.match = {
      ...this.match,
      momentum: {
        ...this.match.momentum,
        [team]: clamp01(this.match.momentum[team] + amount),
      },
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
    this.bumpMomentum(team, MOMENTUM_GOAL_BUMP)

    const leadDescription = this.describeLead(team)
    this.appendEvent({
      minute: this.match.minute,
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

  private createChance(team: TeamId): void {
    const teamName = this.match.teams[team].name
    this.bumpMomentum(team, MOMENTUM_CHANCE_BUMP)
    this.appendEvent({
      minute: this.match.minute,
      type: 'chance',
      team,
      description: `Chance for ${teamName} — the keeper does well to keep it out.`,
      modelReaction: `${teamName} momentum ticks up — remaining xG shifts modestly their way.`,
    })
  }

  private bookPlayer(team: TeamId): void {
    const teamName = this.match.teams[team].name
    this.appendEvent({
      minute: this.match.minute,
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
      type: 'red-card',
      team,
      description: `RED CARD! A ${teamName} player is sent off.`,
      modelReaction: `${teamName} down to ten men — their remaining xG drops sharply while the opponent's rises.`,
    })
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

  private appendEvent(partial: {
    minute: number
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
  }

  private snapshot(): Match {
    return {
      ...this.match,
      teams: { home: { ...this.match.teams.home }, away: { ...this.match.teams.away } },
      score: { ...this.match.score },
      redCards: { ...this.match.redCards },
      momentum: { ...this.match.momentum },
      events: this.match.events.map((e) => ({ ...e })),
    }
  }

  private emit(status: MatchUpdate['status']): void {
    const snapshot = this.snapshot()
    for (const listener of this.listeners) {
      listener({ match: snapshot, status })
    }
  }
}
