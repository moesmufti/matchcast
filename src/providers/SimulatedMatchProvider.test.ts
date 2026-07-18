import { describe, expect, it } from 'vitest'
import { SimulatedMatchProvider } from './SimulatedMatchProvider'
import type { Match } from '../domain/types'
import { matchEffectiveMinute } from '../domain/clock'

/**
 * Structural smoke tests for the realistic simulation. `start()` spins up a
 * real setInterval, so we `pause()` immediately after to stop it — the rest
 * of the match is driven deterministically via `advanceClock`, which never
 * schedules timers.
 */
function driveToFullTime(): Match {
  const provider = new SimulatedMatchProvider()
  let latest: Match | undefined

  const unsubscribe = provider.subscribe(({ match }) => {
    latest = match
  })

  provider.start()
  provider.pause()
  provider.advanceClock(150)

  const result = latest
  unsubscribe()
  provider.dispose()

  if (!result) throw new Error('expected at least one snapshot')
  return result
}

describe('SimulatedMatchProvider realistic simulation', () => {
  it('reaches full-time with a coherent stoppage-time and shot state', () => {
    const match = driveToFullTime()

    expect(match.phase).toBe('full-time')

    expect(match.announcedStoppage.firstHalf).not.toBeNull()
    expect(match.announcedStoppage.secondHalf).not.toBeNull()
    expect(Number.isInteger(match.announcedStoppage.firstHalf)).toBe(true)
    expect(Number.isInteger(match.announcedStoppage.secondHalf)).toBe(true)
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

    for (const event of match.events) {
      if (event.stoppageMinute !== undefined) {
        expect(event.stoppageMinute).toBeGreaterThanOrEqual(1)
        expect([45, 90]).toContain(event.minute)
      }
    }
  })
})
