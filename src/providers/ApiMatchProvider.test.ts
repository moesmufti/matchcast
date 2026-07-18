import { describe, expect, it } from 'vitest'
import { createInitialContext, mapFeedToMatch } from './ApiMatchProvider'
import type { LiveFeedPayload, LiveFeedTeam } from '../domain/feed'

const KICKOFF_ISO = '2026-07-18T21:00:00Z'
// Fixed instant for any estimate-from-kickoff path exercised indirectly —
// kept constant so tests stay deterministic.
const NOW_MS = Date.parse(KICKOFF_ISO) + 5 * 60_000

function team(id: number, name: string, overrides: Partial<LiveFeedTeam> = {}): LiveFeedTeam {
  return {
    id,
    name,
    shortName: name,
    tla: name.slice(0, 3).toUpperCase(),
    ...overrides,
  }
}

function baseFeed(overrides: Partial<LiveFeedPayload> = {}): LiveFeedPayload {
  return {
    status: 'SCHEDULED',
    minute: null,
    injuryTime: null,
    utcDate: KICKOFF_ISO,
    venue: 'Test Arena',
    score: {
      fullTime: { home: null, away: null },
      halfTime: { home: null, away: null },
    },
    goals: [],
    bookings: [],
    substitutions: [],
    homeTeam: team(1, 'Home FC'),
    awayTeam: team(2, 'Away FC'),
    ...overrides,
  }
}

describe('mapFeedToMatch', () => {
  it('maps a pre-match (SCHEDULED) feed', () => {
    const feed = baseFeed()
    const { match } = mapFeedToMatch(feed, createInitialContext(), NOW_MS)

    expect(match.phase).toBe('pre-match')
    expect(match.score).toEqual({ home: 0, away: 0 })
    expect(match.minute).toBe(0)
    expect(match.stoppageMinute).toBe(0)
    // Kick-off hasn't happened yet (SCHEDULED), so no kickoff marker event.
    expect(match.events.find((e) => e.type === 'kickoff')).toBeUndefined()
  })

  it('maps in-play first half with a goal, a yellow, and a red card', () => {
    const feed = baseFeed({
      status: 'IN_PLAY',
      minute: 30,
      injuryTime: null,
      score: { fullTime: { home: 1, away: 0 }, halfTime: { home: null, away: null } },
      goals: [
        {
          minute: 22,
          injuryTime: null,
          team: { id: 1, name: 'Home FC' },
          scorer: { id: 101, name: 'Striker' },
          assist: null,
        },
      ],
      bookings: [
        {
          minute: 25,
          team: { id: 2, name: 'Away FC' },
          player: { id: 202, name: 'Defender' },
          card: 'YELLOW',
        },
        {
          minute: 28,
          team: { id: 2, name: 'Away FC' },
          player: { id: 203, name: 'Fullback' },
          card: 'RED',
        },
      ],
    })

    const { match } = mapFeedToMatch(feed, createInitialContext(), NOW_MS)

    expect(match.phase).toBe('first-half')
    expect(match.minute).toBe(30)
    expect(match.stoppageMinute).toBe(0)
    expect(match.score).toEqual({ home: 1, away: 0 })
    expect(match.redCards).toEqual({ home: 0, away: 1 })

    const goalEvent = match.events.find((e) => e.type === 'goal')
    expect(goalEvent?.team).toBe('home')
    expect(goalEvent?.description).toContain('Striker')

    const yellowEvent = match.events.find((e) => e.type === 'yellow-card')
    expect(yellowEvent?.team).toBe('away')

    const redEvent = match.events.find((e) => e.type === 'red-card')
    expect(redEvent?.team).toBe('away')

    // Match has left pre-match, so a kickoff marker is present.
    expect(match.events.find((e) => e.id === 'kickoff')).toBeDefined()
  })

  it('keeps first-half stoppage in the first half: raw minute past 45 with no half-time score yet', () => {
    // Raw vendor minute 47 during first-half stoppage ("45+2"). The
    // half-time score is still null (it only populates at the interval), so
    // this must resolve to first-half 45+2 — not second-half minute 47.
    const feed = baseFeed({
      status: 'IN_PLAY',
      minute: 47,
      injuryTime: 4,
      score: { fullTime: { home: 0, away: 0 }, halfTime: { home: null, away: null } },
    })

    const { match } = mapFeedToMatch(feed, createInitialContext(), NOW_MS)

    expect(match.phase).toBe('first-half')
    expect(match.minute).toBe(45)
    expect(match.stoppageMinute).toBe(2)
    expect(match.announcedStoppage.firstHalf).toBe(4)
    expect(match.announcedStoppage.secondHalf).toBeNull()
  })

  it('interprets second-half stoppage: raw minute past 90 is played time, injuryTime is the announced total', () => {
    // Vendor reports raw minute 93 (i.e. "90+3" already played) and an
    // injuryTime of 5 — the fourth official's announced total added time,
    // not the amount played so far. Per our clock rule: stoppageMinute must
    // come from (m - 90), and injuryTime only feeds announcedStoppage.
    const feed = baseFeed({
      status: 'IN_PLAY',
      minute: 93,
      injuryTime: 5,
      score: { fullTime: { home: 1, away: 1 }, halfTime: { home: 0, away: 1 } },
    })

    const { match } = mapFeedToMatch(feed, createInitialContext(), NOW_MS)

    expect(match.phase).toBe('second-half')
    expect(match.minute).toBe(90)
    expect(match.stoppageMinute).toBe(3)
    expect(match.announcedStoppage.secondHalf).toBe(5)
  })

  it('synthesizes shot events from a shot-total delta across two successive calls and feeds momentum', () => {
    const firstFeed = baseFeed({
      status: 'IN_PLAY',
      minute: 40,
      homeTeam: team(1, 'Home FC', { statistics: { shots: 5, shots_on_goal: 2 } }),
      awayTeam: team(2, 'Away FC'),
    })
    const first = mapFeedToMatch(firstFeed, createInitialContext(), NOW_MS)
    expect(first.match.shots.home).toEqual({ total: 5, onTarget: 2 })

    const secondFeed = baseFeed({
      status: 'IN_PLAY',
      minute: 42,
      homeTeam: team(1, 'Home FC', { statistics: { shots: 7, shots_on_goal: 3 } }),
      awayTeam: team(2, 'Away FC'),
    })
    const second = mapFeedToMatch(secondFeed, first.context, NOW_MS)

    expect(second.match.shots.home).toEqual({ total: 7, onTarget: 3 })

    // Exactly one new on-target and one new off-target event are appended by
    // this second call's delta (2->3 on target, 3->4 off target); previously
    // synthesized events from the first call persist untouched.
    const newEvents = second.context.syntheticShotEvents.slice(
      first.context.syntheticShotEvents.length,
    )
    expect(newEvents).toHaveLength(2)
    expect(newEvents.map((e) => e.type).sort()).toEqual(['shot-off-target', 'shot-on-target'])
    expect(newEvents.every((e) => e.team === 'home')).toBe(true)

    expect(second.match.momentum.home).toBeGreaterThan(0)
  })

  it('maps FINISHED to full-time', () => {
    const feed = baseFeed({
      status: 'FINISHED',
      minute: 90,
      score: { fullTime: { home: 2, away: 1 }, halfTime: { home: 1, away: 0 } },
    })
    const { match } = mapFeedToMatch(feed, createInitialContext(), NOW_MS)

    expect(match.phase).toBe('full-time')
    expect(match.events.find((e) => e.id === 'full-time')).toBeDefined()
  })
})
