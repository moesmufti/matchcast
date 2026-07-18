import { Hono } from 'hono'
import type {
  LiveFeedBooking,
  LiveFeedGoal,
  LiveFeedHead2Head,
  LiveFeedPayload,
  LiveFeedPenaltyKick,
  LiveFeedResponse,
  LiveFeedSubstitution,
  LiveFeedTeam,
  VendorMatchStatus,
} from '../src/domain/feed'

type Bindings = {
  /**
   * Set via `wrangler secret put SPORTS_API_KEY` for a real data provider.
   * Never shipped to the browser — the client talks only to /api/*.
   */
  SPORTS_API_KEY?: string
  /**
   * Optional plain var pinning the football-data.org match id, e.g. in
   * wrangler.jsonc `vars: { SPORTS_MATCH_ID: "497654" }`. When unset the
   * worker discovers the id once (WC / THIRD_PLACE / date window) and
   * memoizes it for the life of the isolate.
   */
  SPORTS_MATCH_ID?: string
}

const app = new Hono<{ Bindings: Bindings }>()

const VENDOR_BASE = 'https://api.football-data.org/v4'

// football-data.org's free tier allows 10 requests/minute. Every polling
// browser tab would otherwise burn its own request every 15s; instead we
// memoize the vendor's match body for 10s per Worker isolate, so an
// arbitrary number of clients collapse into ~6 vendor calls/min from that
// isolate. Cloudflare may run several isolates concurrently, each with its
// own cache — a soft, best-effort throttle rather than a hard global limit,
// but comfortably inside the 10 req/min budget in practice.
const VENDOR_CACHE_TTL_MS = 10_000

interface VendorCacheEntry {
  fetchedAt: number
  body: VendorMatchBody
}

// Head-to-head is static for the life of a fixture, so one successful vendor
// call serves the whole isolate. Failures back off for a cooldown rather than
// piggybacking a doomed extra request onto every poll.
const H2H_RETRY_COOLDOWN_MS = 5 * 60_000

/** The two fixtures this app serves, keyed by the client's ?fixture= value. */
type FixtureStage = 'THIRD_PLACE' | 'FINAL'

interface StageState {
  discoveredMatchId: string | null
  vendorCache: VendorCacheEntry | null
  h2hCache: LiveFeedHead2Head | null
  h2hLastFailedAt: number
}

// Module-level state persists for the lifetime of a Worker isolate (not
// across isolates/deploys) — fine for memoizing each fixture's match id
// and last vendor response.
const stageState: Record<FixtureStage, StageState> = {
  THIRD_PLACE: { discoveredMatchId: null, vendorCache: null, h2hCache: null, h2hLastFailedAt: 0 },
  FINAL: { discoveredMatchId: null, vendorCache: null, h2hCache: null, h2hLastFailedAt: 0 },
}

// --- raw vendor shapes (football-data.org v4) ------------------------------

interface VendorTeamRef {
  id: number
  name?: string
}

interface VendorPlayerRef {
  id: number
  name: string
}

interface VendorGoal {
  minute: number
  injuryTime: number | null
  type?: string
  team: VendorTeamRef
  scorer: VendorPlayerRef
  assist?: VendorPlayerRef | null
}

interface VendorBooking {
  minute: number
  team: VendorTeamRef
  player: VendorPlayerRef
  card: 'YELLOW' | 'YELLOW_RED' | 'RED'
}

interface VendorSubstitution {
  minute: number
  team: VendorTeamRef
  playerOut: VendorPlayerRef
  playerIn: VendorPlayerRef
}

interface VendorPenaltyKick {
  player?: VendorPlayerRef | null
  team: VendorTeamRef
  scored: boolean
}

interface VendorTeamStatistics {
  shots?: number
  shots_on_goal?: number
  ball_possession?: number
  [key: string]: unknown
}

interface VendorLineupPlayer {
  id: number
  name: string
  position?: string
  shirtNumber?: number
}

interface VendorTeam {
  id: number
  name: string
  shortName?: string
  tla?: string
  crest?: string
  formation?: string | null
  lineup?: VendorLineupPlayer[]
  bench?: VendorLineupPlayer[]
  statistics?: VendorTeamStatistics
}

interface VendorReferee {
  name: string
  type?: string
}

interface VendorMatchBody {
  status: VendorMatchStatus
  minute: number | null
  injuryTime: number | null
  utcDate: string
  venue?: string
  attendance?: number | null
  referees?: VendorReferee[]
  score?: {
    fullTime?: { home: number | null; away: number | null }
    halfTime?: { home: number | null; away: number | null }
    regularTime?: { home: number | null; away: number | null }
    extraTime?: { home: number | null; away: number | null }
    penalties?: { home: number | null; away: number | null }
    duration?: 'REGULAR' | 'EXTRA_TIME' | 'PENALTY_SHOOTOUT'
    winner?: 'HOME_TEAM' | 'AWAY_TEAM' | 'DRAW' | null
  }
  goals?: VendorGoal[]
  bookings?: VendorBooking[]
  substitutions?: VendorSubstitution[]
  penalties?: VendorPenaltyKick[]
  homeTeam: VendorTeam
  awayTeam: VendorTeam
}

interface VendorDiscoveryBody {
  matches?: Array<{ id: number; stage?: string }>
}

interface VendorHead2HeadBody {
  aggregates?: {
    numberOfMatches: number
    totalGoals: number
    homeTeam: { id: number; wins: number; draws: number; losses: number }
    awayTeam: { id: number; wins: number; draws: number; losses: number }
  }
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

async function vendorFetch(path: string, apiKey: string): Promise<Response> {
  return fetch(`${VENDOR_BASE}${path}`, { headers: { 'X-Auth-Token': apiKey } })
}

/** Resolve the football-data.org match id: pinned var, memoized discovery, or a fresh lookup. */
async function resolveMatchId(
  pinned: string | undefined,
  apiKey: string,
  stage: FixtureStage,
): Promise<string | null> {
  // The pin var predates fixture selection and refers to the third-place
  // match — never apply it to the final.
  if (pinned && stage === 'THIRD_PLACE') return pinned
  const state = stageState[stage]
  if (state.discoveredMatchId) return state.discoveredMatchId

  const now = new Date()
  const dateFrom = isoDate(new Date(now.getTime() - 24 * 60 * 60 * 1000))
  const dateTo = isoDate(new Date(now.getTime() + 24 * 60 * 60 * 1000))

  // The competition-scoped endpoint is the one that honours `stage` — the
  // cross-competition /matches listing silently ignores it and would hand
  // back whichever WC match comes first in the window. Double-check the
  // stage on the response rather than trusting the first entry.
  const res = await vendorFetch(
    `/competitions/WC/matches?stage=${stage}&dateFrom=${dateFrom}&dateTo=${dateTo}`,
    apiKey,
  )
  if (!res.ok) {
    throw new Error(`Match discovery failed with vendor status ${res.status}.`)
  }
  const body = (await res.json()) as VendorDiscoveryBody
  const match = body.matches?.find((m) => (m.stage ? m.stage === stage : true))
  if (!match) return null

  state.discoveredMatchId = String(match.id)
  return state.discoveredMatchId
}

/** Fetch the match body, sharing one vendor call across all pollers for `VENDOR_CACHE_TTL_MS`. */
async function fetchMatchBody(
  matchId: string,
  apiKey: string,
  state: StageState,
): Promise<VendorMatchBody> {
  const now = Date.now()
  if (state.vendorCache && now - state.vendorCache.fetchedAt < VENDOR_CACHE_TTL_MS) {
    return state.vendorCache.body
  }

  const res = await vendorFetch(`/matches/${matchId}`, apiKey)
  if (!res.ok) {
    throw new Error(`Vendor match fetch failed with status ${res.status}.`)
  }
  const body = (await res.json()) as VendorMatchBody
  state.vendorCache = { fetchedAt: now, body }
  return body
}

/**
 * All-time head-to-head aggregates for the fixture (free tier includes this
 * endpoint). Best-effort: any failure returns undefined and the match payload
 * simply omits the block.
 */
async function fetchHead2Head(
  matchId: string,
  apiKey: string,
  state: StageState,
): Promise<LiveFeedHead2Head | null> {
  if (state.h2hCache) return state.h2hCache
  if (Date.now() - state.h2hLastFailedAt < H2H_RETRY_COOLDOWN_MS) return null

  try {
    const res = await vendorFetch(`/matches/${matchId}/head2head?limit=100`, apiKey)
    if (!res.ok) throw new Error(`Vendor head2head fetch failed with status ${res.status}.`)
    const body = (await res.json()) as VendorHead2HeadBody
    const agg = body.aggregates
    if (!agg) throw new Error('Vendor head2head response has no aggregates.')

    state.h2hCache = {
      played: agg.numberOfMatches,
      totalGoals: agg.totalGoals,
      homeWins: agg.homeTeam.wins,
      draws: agg.homeTeam.draws,
      awayWins: agg.awayTeam.wins,
    }
    return state.h2hCache
  } catch {
    state.h2hLastFailedAt = Date.now()
    return null
  }
}

function toFeedTeam(team: VendorTeam): LiveFeedTeam {
  return {
    id: team.id,
    name: team.name,
    shortName: team.shortName,
    tla: team.tla,
    crest: team.crest,
    formation: team.formation ?? null,
    lineup: team.lineup?.map((p) => ({
      id: p.id,
      name: p.name,
      position: p.position,
      shirtNumber: p.shirtNumber,
    })),
    bench: team.bench?.map((p) => ({
      id: p.id,
      name: p.name,
      position: p.position,
      shirtNumber: p.shirtNumber,
    })),
    statistics: team.statistics
      ? {
          shots: team.statistics.shots,
          shots_on_goal: team.statistics.shots_on_goal,
          ball_possession: team.statistics.ball_possession,
        }
      : undefined,
  }
}

function toFeedGoal(g: VendorGoal): LiveFeedGoal {
  return {
    minute: g.minute,
    injuryTime: g.injuryTime ?? null,
    type: g.type,
    team: { id: g.team.id, name: g.team.name },
    scorer: { id: g.scorer.id, name: g.scorer.name },
    assist: g.assist ? { id: g.assist.id, name: g.assist.name } : null,
  }
}

function toFeedBooking(b: VendorBooking): LiveFeedBooking {
  return {
    minute: b.minute,
    team: { id: b.team.id, name: b.team.name },
    player: { id: b.player.id, name: b.player.name },
    card: b.card,
  }
}

function toFeedSubstitution(s: VendorSubstitution): LiveFeedSubstitution {
  return {
    minute: s.minute,
    team: { id: s.team.id, name: s.team.name },
    playerOut: { id: s.playerOut.id, name: s.playerOut.name },
    playerIn: { id: s.playerIn.id, name: s.playerIn.name },
  }
}

function toFeedPenaltyKick(k: VendorPenaltyKick): LiveFeedPenaltyKick {
  return {
    player: k.player ? { id: k.player.id, name: k.player.name } : null,
    team: { id: k.team.id, name: k.team.name },
    scored: k.scored,
  }
}

function toFeedPayload(
  body: VendorMatchBody,
  head2head: LiveFeedHead2Head | null,
): LiveFeedPayload {
  // The named REFEREE is the man/woman in the middle; assistants, fourth
  // officials and VAR share the same array under other `type` values.
  const referee =
    body.referees?.find((r) => r.type === 'REFEREE')?.name ?? body.referees?.[0]?.name ?? null

  return {
    status: body.status,
    minute: body.minute ?? null,
    injuryTime: body.injuryTime ?? null,
    utcDate: body.utcDate,
    venue: body.venue,
    attendance: body.attendance ?? null,
    referee,
    head2head: head2head ?? undefined,
    score: {
      fullTime: {
        home: body.score?.fullTime?.home ?? null,
        away: body.score?.fullTime?.away ?? null,
      },
      halfTime: {
        home: body.score?.halfTime?.home ?? null,
        away: body.score?.halfTime?.away ?? null,
      },
      // Unlike fullTime/halfTime, the vendor only sends these once they're
      // relevant (no extra time played yet, no shootout started) — mirror
      // that absence rather than always filling in a null placeholder, since
      // the client's shootout-detection logic keys off presence.
      regularTime: body.score?.regularTime
        ? { home: body.score.regularTime.home ?? null, away: body.score.regularTime.away ?? null }
        : undefined,
      extraTime: body.score?.extraTime
        ? { home: body.score.extraTime.home ?? null, away: body.score.extraTime.away ?? null }
        : undefined,
      penalties: body.score?.penalties
        ? { home: body.score.penalties.home ?? null, away: body.score.penalties.away ?? null }
        : undefined,
      duration: body.score?.duration,
      winner: body.score?.winner ?? null,
    },
    goals: (body.goals ?? []).map(toFeedGoal),
    bookings: (body.bookings ?? []).map(toFeedBooking),
    substitutions: (body.substitutions ?? []).map(toFeedSubstitution),
    penalties: body.penalties?.map(toFeedPenaltyKick),
    homeTeam: toFeedTeam(body.homeTeam),
    awayTeam: toFeedTeam(body.awayTeam),
  }
}

app.get('/api/health', (c) => c.json({ ok: true, liveConfigured: Boolean(c.env.SPORTS_API_KEY) }))

app.get('/api/match', async (c) => {
  const apiKey = c.env.SPORTS_API_KEY
  if (!apiKey) {
    return c.json<LiveFeedResponse>(
      {
        configured: false,
        error: 'No live data provider configured. Using client-side simulation.',
      },
      501,
    )
  }

  // Which fixture to serve: ?fixture=final for the final, anything else
  // (including absent — older clients) falls back to the third-place match.
  const stage: FixtureStage = c.req.query('fixture') === 'final' ? 'FINAL' : 'THIRD_PLACE'
  const state = stageState[stage]

  try {
    const matchId = await resolveMatchId(c.env.SPORTS_MATCH_ID, apiKey, stage)
    if (!matchId) {
      return c.json<LiveFeedResponse>(
        {
          configured: true,
          ok: false,
          error: `No World Cup ${stage === 'FINAL' ? 'final' : 'third-place match'} found for today.`,
        },
        404,
      )
    }

    const vendorBody = await fetchMatchBody(matchId, apiKey, state)
    const head2head = await fetchHead2Head(matchId, apiKey, state)
    const feed = toFeedPayload(vendorBody, head2head)

    c.header('Cache-Control', 'no-store')
    return c.json<LiveFeedResponse>({ configured: true, ok: true, feed })
  } catch (err) {
    // Vendor unreachable / non-2xx / malformed body: the client keeps its
    // last good Match and surfaces a "stale" status rather than resetting.
    return c.json<LiveFeedResponse>(
      {
        configured: true,
        ok: false,
        error: err instanceof Error ? err.message : 'Vendor request failed.',
      },
      502,
    )
  }
})

export default app
