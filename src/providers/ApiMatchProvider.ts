import type {
  ConnectionStatus,
  Match,
  MatchEvent,
  MatchPhase,
  PenaltyKick,
  PenaltyShootout,
  Score,
  ShotCounts,
  Team,
  TeamId,
  TeamLineup,
} from '../domain/types'
import { createInitialMatch } from '../domain/fixture'
import {
  effectiveMinute,
  ET_FIRST_END,
  ET_SECOND_END,
  HALF_MINUTES,
  matchEffectiveMinute,
  REGULATION_MINUTES,
  isExtraTimePhase,
} from '../domain/clock'
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
  /**
   * "Scorer to be confirmed" goal events synthesized when the vendor's score
   * has moved ahead of its itemized `goals` array (the free tier updates the
   * score first and itemizes the goal later, sometimes minutes later). Kept
   * per side and persisted across polls so each keeps the minute it was first
   * seen at; trimmed again as the vendor itemizes (or VAR disallows).
   */
  syntheticGoalEvents: Record<TeamId, MatchEvent[]>
  announcedStoppage: {
    firstHalf: number | null
    secondHalf: number | null
    extraTimeFirst: number | null
    extraTimeSecond: number | null
  }
}

export function createInitialContext(): MapContext {
  return {
    previousShots: {
      home: { total: 0, onTarget: 0 },
      away: { total: 0, onTarget: 0 },
    },
    syntheticShotEvents: [],
    syntheticShotCounter: { home: 0, away: 0 },
    syntheticGoalEvents: { home: [], away: [] },
    announcedStoppage: {
      firstHalf: null,
      secondHalf: null,
      extraTimeFirst: null,
      extraTimeSecond: null,
    },
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

/** Which quarter of the match we're in — first/second half, or the two extra-time periods. */
type MatchPeriod = 'first' | 'second' | 'et-first' | 'et-second'

/**
 * `score.halfTime` only populates at the interval, so a null half-time score
 * during play reliably means the first half — even when the raw vendor
 * minute has run past 45 into first-half stoppage (m=47 for "45+2").
 * Fall back to the minute heuristic once the half-time score exists.
 *
 * For EXTRA_TIME, the raw vendor minute keeps counting through ET1's
 * stoppage past 105 before the second period officially starts — there's no
 * separate signal to tell "105+1" apart from "106 exactly", so any m > 105
 * is read as et-second. Early ET1 stoppage therefore gets misread as
 * et-second — accepted, same spirit as the m>=46 regulation fallback below.
 */
function resolvePeriod(feed: LiveFeedPayload, minute: number): MatchPeriod {
  if (feed.status === 'EXTRA_TIME') {
    return minute > ET_FIRST_END ? 'et-second' : 'et-first'
  }
  if (feed.status === 'IN_PLAY' && feed.score.halfTime.home === null) return 'first'
  return minute >= 46 ? 'second' : 'first'
}

function mapPhase(status: VendorMatchStatus, period: MatchPeriod, minute: number): MatchPhase {
  switch (status) {
    case 'SCHEDULED':
    case 'TIMED':
      return 'pre-match'
    case 'PAUSED':
      // PAUSED covers the regulation half-time break as well as the short
      // 90' breather before extra time and the break between the two ET
      // periods — the minute is the only signal that tells them apart.
      if (minute >= ET_FIRST_END) return 'extra-time-half-time'
      if (minute >= REGULATION_MINUTES) return 'extra-time-break'
      return 'half-time'
    case 'FINISHED':
    case 'AWARDED':
      return 'full-time'
    case 'IN_PLAY':
      return period === 'second' ? 'second-half' : 'first-half'
    case 'EXTRA_TIME':
      return period === 'et-second' ? 'extra-time-second' : 'extra-time-first'
    case 'PENALTY_SHOOTOUT':
      return 'penalties'
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
  announcedStoppage: MapContext['announcedStoppage']
}

type AnnouncedKey = keyof MapContext['announcedStoppage']

/**
 * Which minute a phase "holds" at while its stoppage plays, and which
 * one-shot `announcedStoppage` field that stoppage belongs to. `duration`
 * disambiguates 'full-time', which by itself doesn't say whether the match
 * finished in regulation, extra time, or on penalties.
 */
function clockBase(
  phase: MatchPhase,
  duration: LiveFeedPayload['score']['duration'],
): { base: number; key: AnnouncedKey } {
  switch (phase) {
    case 'pre-match':
    case 'first-half':
    case 'half-time':
      return { base: HALF_MINUTES, key: 'firstHalf' }
    case 'extra-time-break':
      return { base: REGULATION_MINUTES, key: 'secondHalf' }
    case 'extra-time-first':
    case 'extra-time-half-time':
      return { base: ET_FIRST_END, key: 'extraTimeFirst' }
    case 'extra-time-second':
    case 'penalties':
      return { base: ET_SECOND_END, key: 'extraTimeSecond' }
    case 'full-time':
      return duration === 'EXTRA_TIME' || duration === 'PENALTY_SHOOTOUT'
        ? { base: ET_SECOND_END, key: 'extraTimeSecond' }
        : { base: REGULATION_MINUTES, key: 'secondHalf' }
    case 'second-half':
      return { base: REGULATION_MINUTES, key: 'secondHalf' }
  }
}

/**
 * Vendor clock interpretation (deliberately spelled out — this is easy to
 * get backwards):
 *  - Raw vendor `minute` (m) keeps counting up past a period's base time,
 *    e.g. m=93 in the second half means "90+3" has actually been played;
 *    m=107 in extra time's second period means "105+2".
 *  - `injuryTime`, when present at/after a period's boundary, is the fourth
 *    official's ANNOUNCED total added time for that period (e.g. "5 minutes
 *    shown") — not how much of it has been played so far. We record it once
 *    per period into `announcedStoppage` (for display/prediction) and never
 *    let it drive `stoppageMinute` directly.
 *  - The actually-played stoppage (`stoppageMinute`) always comes from how
 *    far m has gone past the period's base — zero otherwise.
 */
function computeClock(
  phase: MatchPhase,
  duration: LiveFeedPayload['score']['duration'],
  m: number,
  injuryTime: number | null,
  announced: MapContext['announcedStoppage'],
): ClockResult {
  const { base, key } = clockBase(phase, duration)
  const minute = Math.min(m, base)
  const stoppageMinute = m > base ? m - base : 0

  const nextAnnounced = { ...announced }
  if (m >= base && injuryTime !== null && nextAnnounced[key] === null) {
    nextAnnounced[key] = injuryTime
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

/**
 * Builds `Match.penalties` once a shootout has started — signalled by the
 * PENALTY_SHOOTOUT status itself, by `score.penalties` appearing (the vendor
 * populates it as soon as the shootout is under way), or by a non-empty
 * kicks array. Returns undefined otherwise so `Match.penalties` stays absent
 * pre-shootout, per the domain contract.
 */
function buildPenalties(feed: LiveFeedPayload, homeTeamId: number): PenaltyShootout | undefined {
  const kicksInput = feed.penalties ?? []
  const hasShootout =
    feed.status === 'PENALTY_SHOOTOUT' ||
    feed.score.penalties !== undefined ||
    kicksInput.length > 0

  if (!hasShootout) return undefined

  const kicks: PenaltyKick[] = kicksInput.map((k) => ({
    team: k.team.id === homeTeamId ? 'home' : 'away',
    scored: k.scored,
  }))

  const scoredCount = (team: TeamId) => kicks.filter((k) => k.team === team && k.scored).length

  const score: Score = {
    home: feed.score.penalties?.home ?? scoredCount('home'),
    away: feed.score.penalties?.away ?? scoredCount('away'),
  }

  const firstKicker: TeamId = kicks[0]?.team ?? 'home'

  let winner: TeamId | null = null
  if (feed.status === 'FINISHED' && feed.score.duration === 'PENALTY_SHOOTOUT') {
    if (feed.score.winner === 'HOME_TEAM') winner = 'home'
    else if (feed.score.winner === 'AWAY_TEAM') winner = 'away'
    // Vendor winner missing/DRAW (shouldn't happen once FINISHED on
    // penalties) — fall back to whichever side is ahead in the shootout.
    else winner = score.home > score.away ? 'home' : score.away > score.home ? 'away' : null
  }

  return { score, kicks, firstKicker, winner }
}

function toTeamLineup(team: LiveFeedTeam): TeamLineup | undefined {
  if (!team.formation || !team.lineup || team.lineup.length !== 11) return undefined
  return {
    formation: team.formation,
    players: team.lineup.map((p) => ({ number: p.shirtNumber ?? 0, name: p.name })),
    bench: team.bench?.map((p) => ({ number: p.shirtNumber ?? 0, name: p.name })),
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

function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

/** Last whitespace-separated token — how the lineup card abbreviates names. */
function lastNameToken(name: string): string {
  const tokens = name.trim().split(/\s+/)
  return tokens[tokens.length - 1]
}

/**
 * Whether a lineup entry refers to the same player as a vendor name. The two
 * spellings rarely agree exactly: vendor events carry full names ("Théo
 * Hernandez") while the fixture-fallback lineups use card-style short ones
 * ("T. Hernandez"), so fall back to comparing accent-stripped surnames.
 */
function playerMatches(lineupName: string, vendorName: string): boolean {
  return (
    normalizeName(lineupName) === normalizeName(vendorName) ||
    normalizeName(lastNameToken(lineupName)) === normalizeName(lastNameToken(vendorName))
  )
}

/**
 * Swaps substituted players into the on-pitch lineups so the card shows who
 * is actually playing, keeping the outgoing player's slot (and thus pitch
 * position), and removes them from the bench so the substitutes list shows
 * only who is still available. The bench entry also supplies the incoming
 * player's shirt number — the vendor's substitution records don't carry
 * one, so without a bench match 0 marks "unknown" and the card renders it
 * as blank. Applied in minute order so chained subs (A→B, later B→C)
 * resolve.
 */
function applySubstitutions(
  lineups: Match['lineups'],
  substitutions: LiveFeedPayload['substitutions'],
  homeTeamId: number,
): Match['lineups'] {
  if (!lineups || substitutions.length === 0) return lineups

  const next: NonNullable<Match['lineups']> = {
    home: {
      ...lineups.home,
      players: [...lineups.home.players],
      bench: lineups.home.bench && [...lineups.home.bench],
    },
    away: {
      ...lineups.away,
      players: [...lineups.away.players],
      bench: lineups.away.bench && [...lineups.away.bench],
    },
  }

  for (const sub of [...substitutions].sort((a, b) => a.minute - b.minute)) {
    const side: TeamId = sub.team.id === homeTeamId ? 'home' : 'away'
    const players = next[side].players
    const index = players.findIndex((p) => playerMatches(p.name, sub.playerOut.name))
    if (index === -1) continue

    const bench = next[side].bench
    const benchIndex = bench?.findIndex((p) => playerMatches(p.name, sub.playerIn.name)) ?? -1
    const benchEntry = benchIndex === -1 ? undefined : bench?.[benchIndex]
    if (bench && benchIndex !== -1) bench.splice(benchIndex, 1)

    players[index] = benchEntry ?? { number: 0, name: lastNameToken(sub.playerIn.name) }
  }

  return next
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
      : feed.status === 'EXTRA_TIME'
        ? // No itemized extra-time heuristic exists yet — clamp the same
          // rough kickoff-elapsed estimate (which tops out at 90) into
          // extra time's 91-120 window rather than inventing a new one.
          Math.min(
            ET_SECOND_END,
            Math.max(
              REGULATION_MINUTES + 1,
              Math.floor(estimateMinuteFromKickoff(feed.utcDate, nowMs)),
            ),
          )
        : feed.status === 'PENALTY_SHOOTOUT'
          ? ET_SECOND_END
          : feed.status === 'FINISHED' || feed.status === 'AWARDED'
            ? feed.score.duration === 'EXTRA_TIME' || feed.score.duration === 'PENALTY_SHOOTOUT'
              ? ET_SECOND_END
              : REGULATION_MINUTES
            : 0)

  const period = resolvePeriod(feed, resolvedMinute)
  const phase = mapPhase(feed.status, period, resolvedMinute)
  const clock = computeClock(
    phase,
    feed.score.duration,
    resolvedMinute,
    feed.injuryTime,
    context.announcedStoppage,
  )

  const homeTeamId = feed.homeTeam.id
  const teams: Record<TeamId, Team> = {
    home: buildTeam('home', feed.homeTeam),
    away: buildTeam('away', feed.awayTeam),
  }

  // v4 semantics: `fullTime` includes regulation plus extra time, but never
  // shootout kicks — exactly what Match.score means, so no extra work here.
  const score: Score = {
    home: feed.score.fullTime.home ?? 0,
    away: feed.score.fullTime.away ?? 0,
  }

  const penalties = buildPenalties(feed, homeTeamId)

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

  // The vendor moves `score.fullTime` before it itemizes the goal in
  // `goals` (on the free tier the scorer detail can trail by minutes). Any
  // score not covered by an itemized goal gets a placeholder event at the
  // minute the delta was first observed — without it the feed (and goal-led
  // momentum) misses the most important event of the match. Re-derived from
  // the gap each poll: itemization shrinks it (the real event takes over),
  // as does a VAR-disallowed goal.
  const vendorGoalCounts: Record<TeamId, number> = { home: 0, away: 0 }
  for (const g of feed.goals) {
    vendorGoalCounts[g.team.id === homeTeamId ? 'home' : 'away'] += 1
  }
  const syntheticGoalEvents: Record<TeamId, MatchEvent[]> = { home: [], away: [] }
  for (const side of ['home', 'away'] as const) {
    const unitemized = Math.max(0, score[side] - vendorGoalCounts[side])
    const kept = context.syntheticGoalEvents[side].slice(0, unitemized)
    while (kept.length < unitemized) {
      kept.push({
        id: `goal-unconfirmed-${side}-${kept.length + 1}`,
        minute: clock.minute,
        stoppageMinute: clock.stoppageMinute,
        type: 'goal',
        team: side,
        description: `GOAL! ${teams[side].name} — scorer to be confirmed.`,
        modelReaction: `${teams[side].name} score. Win probability shifts sharply in their favour.`,
      })
    }
    syntheticGoalEvents[side] = kept
  }

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

  // Reached extra time at all (including the 90' breather before it starts)
  // — either currently in one of its phases, or the match finished having
  // gone there.
  const reachedExtraTime =
    isExtraTimePhase(phase) ||
    phase === 'penalties' ||
    (phase === 'full-time' &&
      (feed.score.duration === 'EXTRA_TIME' || feed.score.duration === 'PENALTY_SHOOTOUT'))
  // In or past extra time's second period specifically.
  const reachedEtSecondOrBeyond =
    phase === 'extra-time-second' ||
    phase === 'penalties' ||
    (phase === 'full-time' &&
      (feed.score.duration === 'EXTRA_TIME' || feed.score.duration === 'PENALTY_SHOOTOUT'))

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
      minute: HALF_MINUTES,
      type: 'half-time',
      description: 'Half-time whistle.',
      modelReaction: 'Model holds probabilities steady until the second half resumes.',
    })
  }
  if (
    phase === 'second-half' ||
    isExtraTimePhase(phase) ||
    phase === 'penalties' ||
    phase === 'full-time'
  ) {
    markerEvents.push({
      id: 'second-half-start',
      minute: HALF_MINUTES,
      type: 'second-half-start',
      description: 'Second half under way.',
      modelReaction: 'Remaining-time model resets its xG clock for the second 45.',
    })
  }
  if (reachedExtraTime) {
    markerEvents.push({
      id: 'extra-time-start',
      minute: REGULATION_MINUTES,
      type: 'extra-time-start',
      description: 'Extra time under way — 15 minutes each way.',
      modelReaction:
        'Model resets the remaining-time clock for extra time and recalculates draw odds for a 30-minute window.',
    })
  }
  if (phase === 'extra-time-half-time' || reachedEtSecondOrBeyond) {
    markerEvents.push({
      id: 'extra-time-half-time',
      minute: ET_FIRST_END,
      type: 'extra-time-half-time',
      description: 'End of the first period of extra time.',
      modelReaction: 'Model holds probabilities steady for the short break.',
    })
  }
  if (reachedEtSecondOrBeyond) {
    markerEvents.push({
      id: 'extra-time-second-start',
      minute: ET_FIRST_END,
      type: 'extra-time-second-start',
      description: 'Second period of extra time under way.',
      modelReaction: 'Model resets the remaining-time clock for the final 15 minutes.',
    })
  }
  if (penalties) {
    markerEvents.push({
      id: 'penalties-start',
      minute: ET_SECOND_END,
      type: 'penalties-start',
      description: 'Penalty shootout.',
      modelReaction:
        'Model switches to shootout mode — win probability now driven by kicks taken and remaining.',
    })
  }
  if (phase === 'full-time') {
    const suffix =
      feed.score.duration === 'PENALTY_SHOOTOUT'
        ? ' on penalties'
        : feed.score.duration === 'EXTRA_TIME'
          ? ' after extra time'
          : ''
    markerEvents.push({
      id: 'full-time',
      minute:
        feed.score.duration === 'EXTRA_TIME' || feed.score.duration === 'PENALTY_SHOOTOUT'
          ? ET_SECOND_END
          : REGULATION_MINUTES,
      type: 'full-time',
      description: `Full-time whistle${suffix}.`,
      modelReaction: 'Result is locked in — probabilities settle at the final outcome.',
    })
  }

  // One event per shootout kick, in the order taken. Padded index keeps the
  // id-based sort tiebreak correct past kick 9 (sudden death can run long).
  const penaltyKickEvents: MatchEvent[] = (feed.penalties ?? []).map((k, index) => {
    const team: TeamId = k.team.id === homeTeamId ? 'home' : 'away'
    const teamName = teams[team].name
    const playerSuffix = k.player ? ` (${k.player.name})` : ''
    return k.scored
      ? {
          id: `pen-${String(index).padStart(2, '0')}`,
          minute: ET_SECOND_END,
          type: 'penalty-scored',
          team,
          description: `Penalty — ${teamName} score${playerSuffix}.`,
          modelReaction: `${teamName} convert from the spot.`,
        }
      : {
          id: `pen-${String(index).padStart(2, '0')}`,
          minute: ET_SECOND_END,
          type: 'penalty-missed',
          team,
          description: `Penalty missed — ${teamName}${playerSuffix}.`,
          modelReaction: `${teamName} miss from the spot — shootout advantage swings to their opponent.`,
        }
  })

  const shotResult = synthesizeShotEvents(feed, context, teams, clock)

  // Same-minute chronology the id tiebreak alone can't provide: everything
  // at 120' would otherwise sort alphabetically ('full-time' < 'pen-NN' <
  // 'penalties-start'). Open play first, then the shootout opens, then its
  // kicks, and the final whistle always last.
  const sameMinuteRank = (event: MatchEvent): number => {
    switch (event.type) {
      case 'penalties-start':
        return 1
      case 'penalty-scored':
      case 'penalty-missed':
        return 2
      case 'full-time':
        return 3
      default:
        return 0
    }
  }

  const events = [
    ...markerEvents,
    ...goalEvents,
    ...syntheticGoalEvents.home,
    ...syntheticGoalEvents.away,
    ...bookingEvents,
    ...subEvents,
    ...shotResult.syntheticShotEvents,
    ...penaltyKickEvents,
  ].sort((a, b) => {
    const ea = effectiveMinute(a.minute, a.stoppageMinute ?? 0)
    const eb = effectiveMinute(b.minute, b.stoppageMinute ?? 0)
    if (ea !== eb) return ea - eb
    const ra = sameMinuteRank(a)
    const rb = sameMinuteRank(b)
    return ra !== rb ? ra - rb : a.id.localeCompare(b.id)
  })

  const lineups = applySubstitutions(
    buildLineups(feed.homeTeam, feed.awayTeam),
    feed.substitutions,
    homeTeamId,
  )

  const halfTimeScore: Score | undefined =
    feed.score.halfTime.home !== null && feed.score.halfTime.away !== null
      ? { home: feed.score.halfTime.home, away: feed.score.halfTime.away }
      : undefined

  const matchWithoutMomentum: Match = {
    competition: FIXTURE.competition,
    round: FIXTURE.round,
    venue: feed.venue ?? FIXTURE.venue,
    kickoffIso: feed.utcDate,
    referee: feed.referee ?? undefined,
    attendance: feed.attendance ?? undefined,
    headToHead: feed.head2head
      ? {
          played: feed.head2head.played,
          totalGoals: feed.head2head.totalGoals,
          wins: { home: feed.head2head.homeWins, away: feed.head2head.awayWins },
          draws: feed.head2head.draws,
        }
      : undefined,
    halfTimeScore,
    teams,
    phase,
    knockout: FIXTURE.knockout,
    minute: clock.minute,
    stoppageMinute: clock.stoppageMinute,
    announcedStoppage: clock.announcedStoppage,
    score,
    penalties,
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
    syntheticGoalEvents,
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
