/**
 * Trimmed wire shape returned by the worker's `GET /api/match` for a real
 * football-data.org v4 fixture. Types only — zero runtime code — so this
 * module is safe to import from both the worker and the browser provider.
 *
 * Only the vendor fields the client mapping (`ApiMatchProvider.mapFeedToMatch`)
 * actually needs are mirrored here; see worker/index.ts for the full vendor
 * response shape and the trimming logic.
 */

export type VendorMatchStatus =
  | 'SCHEDULED'
  | 'TIMED'
  | 'IN_PLAY'
  | 'PAUSED'
  | 'EXTRA_TIME'
  | 'PENALTY_SHOOTOUT'
  | 'FINISHED'
  | 'SUSPENDED'
  | 'POSTPONED'
  | 'CANCELLED'
  | 'AWARDED'

export interface LiveFeedTeamRef {
  id: number
  name?: string
}

export interface LiveFeedPlayerRef {
  id: number
  name: string
}

export interface LiveFeedGoal {
  minute: number
  injuryTime: number | null
  type?: string
  team: LiveFeedTeamRef
  scorer: LiveFeedPlayerRef
  assist: LiveFeedPlayerRef | null
}

export interface LiveFeedBooking {
  minute: number
  team: LiveFeedTeamRef
  player: LiveFeedPlayerRef
  card: 'YELLOW' | 'YELLOW_RED' | 'RED'
}

export interface LiveFeedSubstitution {
  minute: number
  team: LiveFeedTeamRef
  playerOut: LiveFeedPlayerRef
  playerIn: LiveFeedPlayerRef
}

export interface LiveFeedTeamStatistics {
  shots?: number
  shots_on_goal?: number
}

export interface LiveFeedLineupPlayer {
  id: number
  name: string
  position?: string
  shirtNumber?: number
}

export interface LiveFeedTeam {
  id: number
  name: string
  shortName?: string
  tla?: string
  crest?: string
  /** Tier-gated on the vendor side — absent unless the plan includes it. */
  formation?: string | null
  /** Tier-gated — absent unless the plan includes it. */
  lineup?: LiveFeedLineupPlayer[]
  /** Tier-gated — absent unless the plan includes it. */
  statistics?: LiveFeedTeamStatistics
}

export interface LiveFeedPayload {
  status: VendorMatchStatus
  /** 0 at kickoff; null has been observed on the free tier. */
  minute: number | null
  injuryTime: number | null
  utcDate: string
  venue?: string
  score: {
    fullTime: { home: number | null; away: number | null }
    halfTime: { home: number | null; away: number | null }
  }
  goals: LiveFeedGoal[]
  bookings: LiveFeedBooking[]
  substitutions: LiveFeedSubstitution[]
  homeTeam: LiveFeedTeam
  awayTeam: LiveFeedTeam
}

/**
 * Discriminated union for the `/api/match` response body.
 *  - `configured: false` — no `SPORTS_API_KEY` set server-side; client falls
 *    back to the simulator / fixture state (current behaviour).
 *  - `configured: true, ok: true` — vendor call succeeded, `feed` is fresh.
 *  - `configured: true, ok: false` — vendor call failed or discovery found no
 *    match; client keeps its last good `Match` and surfaces a degraded status.
 */
export type LiveFeedResponse =
  | { configured: false; error: string }
  | { configured: true; ok: true; feed: LiveFeedPayload }
  | { configured: true; ok: false; error: string }
