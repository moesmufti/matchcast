import { describe, expect, it } from 'vitest'
import { computeMomentum } from './momentum'
import type { MatchEvent } from './types'

let counter = 0
function event(partial: Partial<MatchEvent> & Pick<MatchEvent, 'minute' | 'type'>): MatchEvent {
  return {
    id: `evt-${counter++}`,
    description: '',
    modelReaction: '',
    ...partial,
  }
}

describe('computeMomentum', () => {
  it('is zero for both teams with no events', () => {
    expect(computeMomentum([], 30)).toEqual({ home: 0, away: 0 })
  })

  it('rises for the team that just created shots and stays in [0, 1)', () => {
    const events = [
      event({ minute: 58, type: 'shot-on-target', team: 'home' }),
      event({ minute: 59, type: 'shot-off-target', team: 'home' }),
      event({ minute: 60, type: 'goal', team: 'home' }),
    ]
    const momentum = computeMomentum(events, 60)
    expect(momentum.home).toBeGreaterThan(0.5)
    expect(momentum.home).toBeLessThan(1)
    expect(momentum.away).toBe(0)
  })

  it('weighs a shot on target more than one off target', () => {
    const on = computeMomentum([event({ minute: 50, type: 'shot-on-target', team: 'home' })], 50)
    const off = computeMomentum([event({ minute: 50, type: 'shot-off-target', team: 'home' })], 50)
    expect(on.home).toBeGreaterThan(off.home)
  })

  it('fades with age and ignores events outside the window', () => {
    const shot = event({ minute: 40, type: 'shot-on-target', team: 'away' })
    const fresh = computeMomentum([shot], 41)
    const fading = computeMomentum([shot], 50)
    const gone = computeMomentum([shot], 56)
    expect(fresh.away).toBeGreaterThan(fading.away)
    expect(fading.away).toBeGreaterThan(0)
    expect(gone.away).toBe(0)
  })

  it('counts first-half-stoppage events without going negative in the early second half', () => {
    const stoppageGoal = event({ minute: 45, stoppageMinute: 3, type: 'goal', team: 'home' })
    const momentum = computeMomentum([stoppageGoal], 46)
    expect(momentum.home).toBeGreaterThan(0.6)
  })

  it('ignores non-attacking events', () => {
    const events = [
      event({ minute: 30, type: 'yellow-card', team: 'home' }),
      event({ minute: 31, type: 'substitution', team: 'away' }),
      event({ minute: 32, type: 'half-time' }),
    ]
    expect(computeMomentum(events, 33)).toEqual({ home: 0, away: 0 })
  })

  it('is deterministic', () => {
    const events = [
      event({ minute: 20, type: 'goal', team: 'away' }),
      event({ minute: 25, type: 'shot-on-target', team: 'home' }),
    ]
    expect(computeMomentum(events, 28)).toEqual(computeMomentum(events, 28))
  })
})
