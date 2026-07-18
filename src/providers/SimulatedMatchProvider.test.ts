import { afterEach, describe, expect, it, vi } from 'vitest'
import { SimulatedMatchProvider } from './SimulatedMatchProvider'
import type { Match } from '../domain/types'
import { matchEffectiveMinute } from '../domain/clock'

/**
 * Structural tests for the realistic simulation. `start()` spins up a real
 * setInterval, so we `pause()` immediately after to stop it — the rest of
 * the match is driven deterministically via `advanceClock`, which never
 * schedules timers.
 *
 * Random-dependent paths (ambient shots/cards/subs, stoppage-time length,
 * the extra-stoppage-minute quirk, penalty conversion) are pinned down with
 * `vi.spyOn(Math, 'random')` so every test is fully deterministic.
 */

function createHarness(): { provider: SimulatedMatchProvider; getLatest: () => Match } {
  const provider = new SimulatedMatchProvider()
  let latest: Match | undefined
  provider.subscribe(({ match }) => {
    latest = match
  })
  const getLatest = (): Match => {
    if (!latest) throw new Error('expected at least one snapshot')
    return latest
  }
  return { provider, getLatest }
}

/** A constant just under 1 keeps every `Math.random() < p` ambient check
 * false (shots, cards, subs, the extra-stoppage-minute quirk all use tiny
 * probabilities) while still yielding a valid, reproducible stoppage-time
 * sample from `weightedSample`. */
const NO_AMBIENT_EVENTS_RANDOM = 0.999

/** Drives from kickoff to the second-half-stoppage decision point (the tick
 * that either blows full-time or — level in a knockout — starts the
 * extra-time break), reading each half's announced stoppage back from the
 * match rather than hard-coding it, so this stays correct regardless of the
 * stoppage-weight tables. */
function driveToSecondHalfDecision(
  provider: SimulatedMatchProvider,
  getLatest: () => Match,
): Match {
  provider.advanceClock(45) // reach 45', first-half stoppage announced
  const firstHalfStoppage = getLatest().announcedStoppage.firstHalf as number
  provider.advanceClock(firstHalfStoppage) // half-time whistle
  provider.advanceClock(1) // second half kicks off
  provider.advanceClock(45) // reach 90', second-half stoppage announced
  const secondHalfStoppage = getLatest().announcedStoppage.secondHalf as number
  provider.advanceClock(secondHalfStoppage) // decision tick
  return getLatest()
}

/** From the second-half-stoppage decision point, consumes the ~2-tick
 * extra-time break and lands on 'extra-time-first'. */
function driveToExtraTimeFirst(provider: SimulatedMatchProvider, getLatest: () => Match): Match {
  driveToSecondHalfDecision(provider, getLatest)
  provider.advanceClock(2)
  return getLatest()
}

/** Drives a level knockout match all the way to the opening kick of the
 * shoot-out. */
function driveToPenaltiesStart(provider: SimulatedMatchProvider, getLatest: () => Match): Match {
  driveToExtraTimeFirst(provider, getLatest)
  provider.advanceClock(15) // ET1: 91' -> 105'
  const et1Stoppage = getLatest().announcedStoppage.extraTimeFirst as number
  provider.advanceClock(et1Stoppage) // -> extra-time-half-time
  provider.advanceClock(2) // -> extra-time-second
  provider.advanceClock(15) // ET2: 106' -> 120'
  const et2Stoppage = getLatest().announcedStoppage.extraTimeSecond as number
  provider.advanceClock(et2Stoppage) // level -> penalties
  return getLatest()
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SimulatedMatchProvider realistic simulation', () => {
  it('blows full-time exactly at 90 when the match is not level (regression)', () => {
    const { provider, getLatest } = createHarness()
    provider.start()
    provider.pause()
    provider.injectGoal('home') // deterministic — no randomness involved
    vi.spyOn(Math, 'random').mockReturnValue(NO_AMBIENT_EVENTS_RANDOM)

    const match = driveToSecondHalfDecision(provider, getLatest)

    expect(match.phase).toBe('full-time')
    expect(match.score).toEqual({ home: 1, away: 0 })
    expect(match.events.at(-1)?.type).toBe('full-time')

    expect(match.announcedStoppage.firstHalf).not.toBeNull()
    expect(match.announcedStoppage.secondHalf).not.toBeNull()
    expect(match.announcedStoppage.firstHalf as number).toBeGreaterThanOrEqual(2)
    expect(match.announcedStoppage.firstHalf as number).toBeLessThanOrEqual(5)
    expect(match.announcedStoppage.secondHalf as number).toBeGreaterThanOrEqual(3)
    expect(match.announcedStoppage.secondHalf as number).toBeLessThanOrEqual(7)

    expect(matchEffectiveMinute(match)).toBeGreaterThanOrEqual(90)

    for (const team of ['home', 'away'] as const) {
      expect(match.shots[team].onTarget).toBeLessThanOrEqual(match.shots[team].total)
      expect(match.score[team]).toBeLessThanOrEqual(match.shots[team].onTarget)
      expect(match.momentum[team]).toBeGreaterThanOrEqual(0)
      expect(match.momentum[team]).toBeLessThan(1)
    }

    // No extra time occurred, so the old minute invariant still holds.
    for (const event of match.events) {
      if (event.stoppageMinute !== undefined) {
        expect(event.stoppageMinute).toBeGreaterThanOrEqual(1)
        expect([45, 90]).toContain(event.minute)
      }
    }
  })

  it('goes to extra time — never full-time at 90 — when level in a knockout match', () => {
    const { provider, getLatest } = createHarness()
    provider.start()
    provider.pause()
    vi.spyOn(Math, 'random').mockReturnValue(NO_AMBIENT_EVENTS_RANDOM)

    const atDecision = driveToSecondHalfDecision(provider, getLatest)
    expect(atDecision.score).toEqual({ home: 0, away: 0 })
    expect(atDecision.phase).toBe('extra-time-break')
    expect(atDecision.phase).not.toBe('full-time')
    expect(atDecision.events.some((e) => e.type === 'full-time')).toBe(false)
    expect(atDecision.events.some((e) => e.type === 'clock')).toBe(true)

    provider.advanceClock(1)
    expect(getLatest().phase).toBe('extra-time-break')

    provider.advanceClock(1)
    const afterBreak = getLatest()
    expect(afterBreak.phase).toBe('extra-time-first')
    expect(afterBreak.events.some((e) => e.type === 'extra-time-start')).toBe(true)
  })

  it('plays extra time to 120 without a golden goal when a goal is scored in ET', () => {
    const { provider, getLatest } = createHarness()
    provider.start()
    provider.pause()
    vi.spyOn(Math, 'random').mockReturnValue(NO_AMBIENT_EVENTS_RANDOM)

    driveToExtraTimeFirst(provider, getLatest)
    provider.injectGoal('home')
    expect(getLatest().score).toEqual({ home: 1, away: 0 })
    expect(getLatest().phase).toBe('extra-time-first') // the goal does not end the match

    provider.advanceClock(15) // ET1: 91' -> 105'
    const et1Stoppage = getLatest().announcedStoppage.extraTimeFirst as number
    provider.advanceClock(et1Stoppage) // -> extra-time-half-time
    provider.advanceClock(2) // -> extra-time-second
    provider.advanceClock(15) // ET2: 106' -> 120'
    const et2Stoppage = getLatest().announcedStoppage.extraTimeSecond as number
    provider.advanceClock(et2Stoppage) // not level -> full-time (no shoot-out)

    const final = getLatest()
    expect(final.phase).toBe('full-time')
    expect(final.minute).toBe(120)
    expect(final.score).toEqual({ home: 1, away: 0 })
    expect(final.penalties).toBeUndefined()
    expect(final.events.at(-1)?.type).toBe('full-time')
    expect(final.events.at(-1)?.description.toLowerCase()).toContain('extra time')
  })

  it('runs a full deterministic match into a decided penalty shoot-out', () => {
    const { provider, getLatest } = createHarness()
    provider.start()
    provider.pause()
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(NO_AMBIENT_EVENTS_RANDOM)

    const atPenalties = driveToPenaltiesStart(provider, getLatest)
    expect(atPenalties.phase).toBe('penalties')
    expect(atPenalties.score).toEqual({ home: 0, away: 0 })
    expect(atPenalties.penalties).toEqual({
      score: { home: 0, away: 0 },
      kicks: [],
      firstKicker: 'home',
      winner: null,
    })

    const eventTypesSoFar = atPenalties.events.map((e) => e.type)
    expect(eventTypesSoFar).toContain('extra-time-start')
    expect(eventTypesSoFar).toContain('extra-time-half-time')
    expect(eventTypesSoFar).toContain('extra-time-second-start')
    expect(eventTypesSoFar).toContain('penalties-start')

    // Home scores every kick, away misses every kick — decided 3-0 after 3
    // rounds each per the best-of-5 rule (3 > 0 + 2 remaining away kicks).
    let kickIndex = 0
    randomSpy.mockImplementation(() => (kickIndex++ % 2 === 0 ? 0 : 0.9))

    provider.advanceClock(6)
    const decided = getLatest()

    expect(decided.phase).toBe('full-time')
    expect(decided.score).toEqual({ home: 0, away: 0 }) // shoot-out never touches open-play score
    expect(decided.penalties?.winner).toBe('home')
    expect(decided.penalties?.score).toEqual({ home: 3, away: 0 })
    expect(decided.penalties?.kicks).toHaveLength(6)
    expect(decided.events.at(-1)?.type).toBe('full-time')
    expect(decided.events.at(-1)?.description).toContain('shoot-out')
  })

  it('no-ops manual injections once the shoot-out has started', () => {
    const { provider, getLatest } = createHarness()
    provider.start()
    provider.pause()
    vi.spyOn(Math, 'random').mockReturnValue(NO_AMBIENT_EVENTS_RANDOM)

    const atPenalties = driveToPenaltiesStart(provider, getLatest)
    const eventCountBefore = atPenalties.events.length

    provider.injectGoal('home')
    provider.injectChance('away')
    provider.injectRedCard('home')

    const after = getLatest()
    expect(after.score).toEqual({ home: 0, away: 0 })
    expect(after.redCards).toEqual({ home: 0, away: 0 })
    expect(after.events).toHaveLength(eventCountBefore)
  })

  it('advanceClock steps from second-half stoppage through extra time to a decided shoot-out without hanging', () => {
    const { provider, getLatest } = createHarness()
    provider.start()
    provider.pause()
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(NO_AMBIENT_EVENTS_RANDOM)

    const atPenalties = driveToPenaltiesStart(provider, getLatest)
    expect(atPenalties.phase).toBe('penalties')

    let kickIndex = 0
    randomSpy.mockImplementation(() => (kickIndex++ % 2 === 0 ? 0 : 0.9))

    // Only 6 kicks are needed to decide it (see the shoot-out test above);
    // ask for far more to prove the extra ticks past a decided shoot-out
    // are safe no-ops rather than a hang, and that the bounded for-loop in
    // advanceClock always terminates.
    provider.advanceClock(100)

    const final = getLatest()
    expect(final.phase).toBe('full-time')
    expect(final.penalties?.winner).toBe('home')
    expect(final.penalties?.kicks).toHaveLength(6)
  })
})
