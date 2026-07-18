import type {
  ConnectionStatus,
  Match,
  MatchEvent,
  MatchPhase,
  Score,
  ShotCounts,
  Team,
  TeamId,
  TeamLineup,
} from '../domain/types'
import { createInitialMatch } from '../domain/fixture'
import { effectiveMinute, matchEffectiveMinute } from '../domain/clock'
import { computeMomentum } from '../domain/momentum'
import type {
  LiveFeedPayload,
  LiveFeedResponse,
  LiveFeedTeam,
  VendorMatchStatus,
} from '../domain/feed'
import type { LiveMatchProvider, MatchUpdate } from './LiveMatchProvider'

const POLL_INTERVAL_MS = 15_000

/** The France/England fixture defaults — used as the pre-match fallback and
 * to preserve flags/taglines/lineups when the vendor's own data is missing
 * or doesn't (yet) cover this fixture. */
const FIXTURE = createInitialMatch()

// --- pure mapping context ---------------------------------------------------

/**
 * Everything `mapFeedToMatch` needs to remember between polls, threaded
 * through explicitly so the function stays pure and unit-testable: previously
 * observed shot totals (to detect deltas), the synthetic shot events already
 * emitted (persisted so they survive each poll's event rebuild), and the
 * fourth official's announced stoppage per half (recorded once, then kept).
 */
export interface MapContext {
  previousShots: Record<TeamId, ShotCounts>
  syntheticShotEvents: MatchEvent[]
  syntheticShotCounter: Record<TeamId, number>
  announcedStoppage: { firstHalf: number | null; secondHalf: number | null }
}

export function createInitialContext(): MapContext {
  return {
    previousShots: {
      home: { total: 0, onTarget: 0 },
      away: { total: 0, onTarget: 0 },
    },
    syntheticShotEvents: [],
    syntheticShotCounter: { home: 0, away: 0 },
    announcedStoppage: { firstHalf: null, secondHalf: null },
  }
}

export interface MapFeedResult {
  match: Match
  context: MapContext
}

// --- small pure helpers ------------------------------------------------------

/**
 * Vendor `minute` can be null while a match is IN_PLAY on the free tier.
 * When that happens, estimate elapsed minutes from kickoff instead. Domain
 * code never reads the wall clock (see src/domain/prediction.ts); providers
 * are allowed to, so `nowMs` is threaded in explicitly here rather than
 * calling Date.now() inline, which keeps this helper (and its caller) pure
 * and testable with a fixed instant.
 */
export function estimateMinuteFromKickoff(utcDate: string, nowMs: number): number {
  const kickoffMs = Date.parse(utcDate)
  if (Number.isNaN(kickoffMs)) return 0

  const elapsed = Math.max(0, (nowMs - kickoffMs) / 60_000)
  if (elapsed <= 60) return Math.min(45, elapsed)
  // Past an hour from kickoff, assume a ~15 minute half-time break has
  // already happened and the clock is running in the second half.
  return Math.min(90, elapsed - 15)
}

/**
 * `score.halfTime` only populates at the interval, so a null half-time score
 * during play reliably means the first half — even when the raw vendor
 * minute has run past 45 into first-half stoppage (m=47 for "45+2").
 * Fall back to the minute heuristic once the half-time score exists.
 */
function resolveHalf(feed: LiveFeedPayload, minute: number): 'first' | 'second' {
  if (feed.status === 'IN_PLAY' && feed.score.halfTime.home === null) return 'first'
  return minute >= 46 ? 'second' : 'first'
}

function mapPhase(status: VendorMatchStatus, half: 'first' | 'second'): MatchPhase {
  switch (status) {
    case 'SCHEDULED':
    case 'TIMED':
      return 'pre-match'
    case 'PAUSED':
      return 'half-time'
    case 'FINISHED':
    case 'AWARDED':
      return 'full-time'
    case 'IN_PLAY':
      return half === 'second' ? 'second-half' : 'first-half'
    case 'EXTRA_TIME':
    case 'PENALTY_SHOOTOUT':
      // Extra time / penalties aren't modeled in the domain yet (MatchPhase
      // has no such state) — fold into second-half so the prediction engine
      // still renders something sane instead of crashing on an unknown phase.
      return 'second-half'
    case 'SUSPENDED':
    case 'POSTPONED':
    case 'CANCELLED':
      // No sensible in-match phase for these — render as pre-match; the
      // provider (not this pure mapping) is responsible for surfacing a
      // degraded 'stale' connection status for them.
      return 'pre-match'
    default:
      return 'pre-match'
  }
}

interface ClockResult {
  minute: number
  stoppageMinute: number
  announcedStoppage: { firstHalf: number | null; secondHalf: number | null }
}

/**
 * Vendor clock interpretation (deliberately spelled out — this is easy to
 * get backwards):
 *  - Raw vendor `minute` (m) keeps counting up past a half's base time, e.g.
 *    m=93 in the second half means "90+3" has actually been played.
 *  - `injuryTime`, when present at/after the 45'/90' boundary, is the fourth
 *    official's ANNOUNCED total added time for that half (e.g. "5 minutes
 *    shown") — not how much of it has been played so far. We record it once
 *    into `announcedStoppage` (for display/prediction) and never let it
 *    drive `stoppageMinute` directly.
 *  - The actually-played stoppage (`stoppageMinute`) always comes from how
 *    far m has gone past the half's base: m - 45 / m - 90 once m exceeds it,
 *    zero otherwise.
 */
function computeClock(
  half: 'first' | 'second',
  m: number,
  injuryTime: number | null,
  announced: { firstHalf: number | null; secondHalf: number | null },
): ClockResult {
  const base = half === 'first' ? 45 : 90
  const minute = Math.min(m, base)
  const stoppageMinute = m > base ? m - base : 0

  const nextAnnounced = { ...announced }
  if (m >= base && injuryTime !== null) {
    if (half === 'first' && nextAnnounced.firstHalf === null) nextAnnounced.firstHalf = injuryTime
    if (half === 'second' && nextAnnounced.secondHalf === null)
      nextAnnounced.secondHalf = injuryTime
  }

  return { minute, stoppageMinute, announcedStoppage: nextAnnounced }
}

function buildTeam(id: TeamId, vendorTeam: LiveFeedTeam): Team {
  const fixtureTeam =
    vendorTeam.name === FIXTURE.teams.home.name
      ? FIXTURE.teams.home
      : vendorTeam.name === FIXTURE.teams.away.name
        ? FIXTURE.teams.away
        : undefined

  if (fixtureTeam) {
    // Preserve flag/tagline/name; the side (home/away) always follows the
    // vendor's own homeTeam/awayTeam designation, not this fixture's.
    return { ...fixtureTeam, id }
  }

  return {
    id,
    name: vendorTeam.name,
    shortName: vendorTeam.shortName ?? vendorTeam.tla ?? vendorTeam.name,
    flag: '⚽',
    tagline: vendorTeam.tla ?? '',
  }
}

function countRedCards(
  bookings: LiveFeedPayload['bookings'],
  homeTeamId: number,
): Record<TeamId, number> {
  const counts: Record<TeamId, number> = { home: 0, away: 0 }
  for (const booking of bookings) {
    if (booking.card !== 'RED' && booking.card !== 'YELLOW_RED') continue
    counts[booking.team.id === homeTeamId ? 'home' : 'away'] += 1
  }
  return counts
}

function toTeamLineup(team: LiveFeedTeam): TeamLineup | undefined {
  if (!team.formation || !team.lineup || team.lineup.length !== 11) return undefined
  return {
    formation: team.formation,
    players: team.lineup.map((p) => ({ number: p.shirtNumber ?? 0, name: p.name })),
  }
}

function buildLineups(home: LiveFeedTeam, away: LiveFeedTeam): Match['lineups'] {
  const homeLineup = toTeamLineup(home)
  const awayLineup = toTeamLineup(away)
  if (homeLineup && awayLineup) {
    return { home: homeLineup, away: awayLineup }
  }
  return FIXTURE.lineups
}

interface ShotSynthesisResult {
  shots: Record<TeamId, ShotCounts>
  syntheticShotEvents: MatchEvent[]
  syntheticShotCounter: Record<TeamId, number>
}

/**
 * The vendor only gives us running shot totals, not individual shot events,
 * so we synthesize one 'shot-on-target'/'shot-off-target' event per unit of
 * increase since the last poll, and persist them in context — they are not
 * rebuilt from vendor data like goals/bookings/subs are, since there is
 * nothing itemized to rebuild them from.
 */
function synthesizeShotEvents(
  feed: LiveFeedPayload,
  context: MapContext,
  teams: Record<TeamId, Team>,
  clock: { minute: number; stoppageMinute: number },
): ShotSynthesisResult {
  const shots: Record<TeamId, ShotCounts> = {
    home: { ...context.previousShots.home },
    away: { ...context.previousShots.away },
  }
  const syntheticShotEvents = [...context.syntheticShotEvents]
  const syntheticShotCounter = { ...context.syntheticShotCounter }

  const sides: Array<{ side: TeamId; vendorTeam: LiveFeedTeam }> = [
    { side: 'home', vendorTeam: feed.homeTeam },
    { side: 'away', vendorTeam: feed.awayTeam },
  ]

  for (const { side, vendorTeam } of sides) {
    const stats = vendorTeam.statistics
    if (!stats || stats.shots === undefined || stats.shots_on_goal === undefined) continue

    const prev = context.previousShots[side]
    const curTotal = stats.shots
    const curOnTarget = stats.shots_on_goal
    const prevOffTarget = prev.total - prev.onTarget
    const curOffTarget = curTotal - curOnTarget

    const deltaOnTarget = Math.max(0, curOnTarget - prev.onTarget)
    const deltaOffTarget = Math.max(0, curOffTarget - prevOffTarget)
    const teamName = teams[side].name

    for (let i = 0; i < deltaOnTarget; i++) {
      syntheticShotCounter[side] += 1
      syntheticShotEvents.push({
        id: `shot-${side}-${syntheticShotCounter[side]}`,
        minute: clock.minute,
        stoppageMinute: clock.stoppageMinute,
        type: 'shot-on-target',
        team: side,
        description: `${teamName} force a save — shot on target.`,
        modelReaction: `${teamName} momentum ticks up — remaining xG shifts their way.`,
      })
    }
    for (let i = 0; i < deltaOffTarget; i++) {
      syntheticShotCounter[side] += 1
      syntheticShotEvents.push({
        id: `shot-${side}-${syntheticShotCounter[side]}`,
        minute: clock.minute,
        stoppageMinute: clock.stoppageMinute,
        type: 'shot-off-target',
        team: side,
        description: `${teamName} shot drifts wide of goal.`,
        modelReaction: `${teamName} momentum ticks up slightly — no clear-cut chance yet.`,
      })
    }

    shots[side] = { total: curTotal, onTarget: curOnTarget }
  }

  return { shots, syntheticShotEvents, syntheticShotCounter }
}

/**
 * Pure mapping from a trimmed vendor feed payload to this app's `Match`
 * domain model. Exported (and side-effect free) so it can be unit tested
 * directly with hand-built fixtures — see ApiMatchProvider.test.ts.
 */
export function mapFeedToMatch(
  feed: LiveFeedPayload,
  context: MapContext,
  nowMs: number,
): MapFeedResult {
  const resolvedMinute =
    feed.minute ??
    (feed.status === 'IN_PLAY'
      ? Math.floor(estimateMinuteFromKickoff(feed.utcDate, nowMs))
      : feed.status === 'FINISHED' || feed.status === 'AWARDED'
        ? 90
        : 0)

  const half = resolveHalf(feed, resolvedMinute)
  const phase = mapPhase(feed.status, half)
  const clock = computeClock(half, resolvedMinute, feed.injuryTime, context.announcedStoppage)

  const homeTeamId = feed.homeTeam.id
  const teams: Record<TeamId, Team> = {
    home: buildTeam('home', feed.homeTeam),
    away: buildTeam('away', feed.awayTeam),
  }

  const score: Score = {
    home: feed.score.fullTime.home ?? 0,
    away: feed.score.fullTime.away ?? 0,
  }

  const redCards = countRedCards(feed.bookings, homeTeamId)

  const hasKickedOff = feed.status !== 'SCHEDULED' && feed.status !== 'TIMED'

  const goalEvents: MatchEvent[] = feed.goals.map((g) => {
    const team: TeamId = g.team.id === homeTeamId ? 'home' : 'away'
    return {
      id: `goal-${g.scorer.id}-${g.minute}`,
      minute: g.minute,
      stoppageMinute: g.injuryTime ?? 0,
      type: 'goal',
      team,
      description: `GOAL! ${teams[team].name} — ${g.scorer.name}${
        g.assist ? ` (assist: ${g.assist.name})` : ''
      }.`,
      modelReaction: `${teams[team].name} score. Win probability shifts sharply in their favour.`,
    }
  })

  const bookingEvents: MatchEvent[] = feed.bookings.map((b) => {
    const team: TeamId = b.team.id === homeTeamId ? 'home' : 'away'
    const isRed = b.card === 'RED' || b.card === 'YELLOW_RED'
    return {
      id: `booking-${b.player.id}-${b.minute}`,
      minute: b.minute,
      type: isRed ? 'red-card' : 'yellow-card',
      team,
      description: isRed
        ? `RED CARD! ${b.player.name} (${teams[team].name}) is sent off.`
        : `Yellow card shown to ${b.player.name} (${teams[team].name}).`,
      modelReaction: isRed
        ? `${teams[team].name} down to ten men — their remaining xG drops sharply while the opponent's rises.`
        : 'No material change to the model — a yellow card alone does not move the xG rate.',
    }
  })

  const subEvents: MatchEvent[] = feed.substitutions.map((s) => {
    const team: TeamId = s.team.id === homeTeamId ? 'home' : 'away'
    return {
      id: `sub-${s.playerIn.id}-${s.minute}`,
      minute: s.minute,
      type: 'substitution',
      team,
      description: `${teams[team].name} bring on ${s.playerIn.name} for ${s.playerOut.name}.`,
      modelReaction: 'Model treats this as neutral until on-pitch momentum shows a real shift.',
    }
  })

  const markerEvents: MatchEvent[] = []
  if (hasKickedOff) {
    markerEvents.push({
      id: 'kickoff',
      minute: 0,
      type: 'kickoff',
      description: `Kick-off${feed.venue ? ` in ${feed.venue}` : ''}.`,
      modelReaction: 'Pre-match probabilities activated.',
    })
  }
  if (phase === 'half-time') {
    markerEvents.push({
      id: 'half-time',
      minute: 45,
      type: 'half-time',
      description: 'Half-time whistle.',
      modelReaction: 'Model holds probabilities steady until the second half resumes.',
    })
  }
  if (phase === 'second-half' || phase === 'full-time') {
    markerEvents.push({
      id: 'second-half-start',
      minute: 45,
      type: 'second-half-start',
      description: 'Second half under way.',
      modelReaction: 'Remaining-time model resets its xG clock for the second 45.',
    })
  }
  if (phase === 'full-time') {
    markerEvents.push({
      id: 'full-time',
      minute: 90,
      type: 'full-time',
      description: 'Full-time whistle.',
      modelReaction: 'Result is locked in — probabilities settle at the final outcome.',
    })
  }

  const shotResult = synthesizeShotEvents(feed, context, teams, clock)

  const events = [
    ...markerEvents,
    ...goalEvents,
    ...bookingEvents,
    ...subEvents,
    ...shotResult.syntheticShotEvents,
  ].sort((a, b) => {
    const ea = effectiveMinute(a.minute, a.stoppageMinute ?? 0)
    const eb = effectiveMinute(b.minute, b.stoppageMinute ?? 0)
    return ea !== eb ? ea - eb : a.id.localeCompare(b.id)
  })

  const lineups = buildLineups(feed.homeTeam, feed.awayTeam)

  const matchWithoutMomentum: Match = {
    competition: FIXTURE.competition,
    round: FIXTURE.round,
    venue: feed.venue ?? FIXTURE.venue,
    kickoffIso: feed.utcDate,
    teams,
    phase,
    minute: clock.minute,
    stoppageMinute: clock.stoppageMinute,
    announcedStoppage: clock.announcedStoppage,
    score,
    redCards,
    shots: shotResult.shots,
    momentum: { home: 0, away: 0 },
    events,
    lineups,
  }

  const momentum = computeMomentum(events, matchEffectiveMinute(matchWithoutMomentum))

  const match: Match = { ...matchWithoutMomentum, momentum }

  const nextContext: MapContext = {
    previousShots: shotResult.shots,
    syntheticShotEvents: shotResult.syntheticShotEvents,
    syntheticShotCounter: shotResult.syntheticShotCounter,
    announcedStoppage: clock.announcedStoppage,
  }

  return { match, context: nextContext }
}

const DEGRADED_VENDOR_STATUSES: ReadonlySet<VendorMatchStatus> = new Set([
  'SUSPENDED',
  'POSTPONED',
  'CANCELLED',
])

/**
 * Real polling client for the worker's `/api/match` proxy (see
 * worker/index.ts). The browser never talks to the third-party sports API
 * directly — only same-origin `/api/*` routes — so no API key is ever
 * present in client code or the network tab.
 *
 * Connection status:
 *  - Before the first successful poll: 'connecting'.
 *  - Successful poll, ordinary vendor status: 'live'.
 *  - Successful poll, but vendor status is SUSPENDED/POSTPONED/CANCELLED:
 *    'stale' — we have fresh data, but it doesn't describe a match in
 *    progress, so the UI shouldn't present it as confidently "live".
 *  - A failed/502 poll: 'stale', keeping the last good Match.
 *  - Three consecutive failed polls: 'disconnected' (still keeping the last
 *    good Match).
 *  - 501 (server not configured with SPORTS_API_KEY): 'disconnected' with the
 *    fixture's pre-match state — matches the previous stub behaviour.
 *
 * Does not implement `SimulationControls` — a real fixture isn't
 * controllable, so the UI's simulator-only controls correctly stay hidden
 * for this provider (see `supportsSimulation` in ./LiveMatchProvider).
 */
export class ApiMatchProvider implements LiveMatchProvider {
  private readonly baseUrl: string
  private listeners = new Set<(update: MatchUpdate) => void>()
  private disposed = false
  private timer: ReturnType<typeof setInterval> | null = null

  private context: MapContext = createInitialContext()
  private lastMatch: Match = createInitialMatch()
  private lastStatus: ConnectionStatus = 'connecting'
  private consecutiveFailures = 0

  constructor(baseUrl = '') {
    this.baseUrl = baseUrl
  }

  subscribe(listener: (update: MatchUpdate) => void): () => void {
    // A new subscription revives a disposed provider. React StrictMode
    // mounts effects twice (subscribe → dispose → subscribe), so `dispose`
    // must not be a permanent point of no return.
    this.disposed = false
    this.listeners.add(listener)
    listener({ match: this.lastMatch, status: this.lastStatus })

    if (this.timer === null) {
      void this.poll()
      this.timer = setInterval(() => void this.poll(), POLL_INTERVAL_MS)
    }

    return () => this.listeners.delete(listener)
  }

  dispose(): void {
    this.disposed = true
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.listeners.clear()
  }

  private async poll(): Promise<void> {
    if (this.disposed) return

    try {
      const response = await fetch(`${this.baseUrl}/api/match`)
      if (this.disposed) return

      const body = (await response.json()) as LiveFeedResponse

      if (!body.configured) {
        this.consecutiveFailures = 0
        this.setState(createInitialMatch(), 'disconnected')
        return
      }

      if (!body.ok) {
        this.registerFailure()
        return
      }

      const { match, context } = mapFeedToMatch(body.feed, this.context, Date.now())
      this.context = context
      this.consecutiveFailures = 0

      const status: ConnectionStatus = DEGRADED_VENDOR_STATUSES.has(body.feed.status)
        ? 'stale'
        : 'live'
      this.setState(match, status)
    } catch {
      if (this.disposed) return
      this.registerFailure()
    }
  }

  private registerFailure(): void {
    this.consecutiveFailures += 1
    const status: ConnectionStatus = this.consecutiveFailures >= 3 ? 'disconnected' : 'stale'
    this.setState(this.lastMatch, status)
  }

  private setState(match: Match, status: ConnectionStatus): void {
    this.lastMatch = match
    this.lastStatus = status
    for (const listener of this.listeners) {
      listener({ match, status })
    }
  }
}
