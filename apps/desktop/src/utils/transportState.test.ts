import { describe, expect, it } from 'vitest'
import { createTransportRegistry } from './transportState'

function fixedClock(start = 1000): { now: () => number; tick: (ms: number) => void } {
  let t = start
  return { now: () => t, tick: (ms) => { t += ms } }
}

describe('peer transport-selection registry', () => {
  it('starts idle and promotes only after validation', () => {
    const clock = fixedClock()
    const reg = createTransportRegistry({ now: clock.now })
    expect(reg.phaseFor('p')).toBe('idle')

    reg.startDirectAttempt('p')
    expect(reg.phaseFor('p')).toBe('connecting-direct')
    // Still connecting: no promotion by the clock alone.
    clock.tick(30_000)
    expect(reg.phaseFor('p')).toBe('connecting-direct')

    reg.markDirectValidated('p')
    expect(reg.phaseFor('p')).toBe('direct')
    expect(reg.snapshot().get('p')!.lastFailure).toBeUndefined()
  })

  it('a failed first attempt demotes to relay and schedules a jittered retry', () => {
    const clock = fixedClock()
    const reg = createTransportRegistry({ now: clock.now, baseRetryMs: 1000, maxRetryMs: 60_000 })
    reg.startDirectAttempt('p')
    reg.markDirectFailed('p', 'ice failed', true)
    expect(reg.phaseFor('p')).toBe('relay')

    const entry = reg.snapshot().get('p')!
    expect(entry.lastFailure).toBe('ice failed')
    expect(entry.nextDirectRetryAt).toBeGreaterThan(clock.now())
    expect(entry.nextDirectRetryAt).toBeLessThanOrEqual(clock.now() + 1250)
  })

  it('keeps the relay session while direct retries back off exponentially', () => {
    const clock = fixedClock()
    const reg = createTransportRegistry({ now: clock.now, baseRetryMs: 1000, maxRetryMs: 8000 })
    // Bootstrap: the first failed attempt schedules the first retry.
    reg.startDirectAttempt('p')
    reg.markDirectFailed('p', 'boom', true)
    const seen: number[] = []
    // Five cycles of fail -> wait -> retry -> fail. The retry delay must grow
    // monotonically (up to the cap), and the phase must stay on relay.
    for (let i = 0; i < 5; i++) {
      while (!reg.shouldRetryDirect('p')) clock.tick(100)
      reg.startDirectAttempt('p')
      expect(reg.phaseFor('p')).toBe('connecting-direct')
      reg.markDirectFailed('p', 'candidate pair failed', true)
      expect(reg.phaseFor('p')).toBe('relay')
      seen.push(reg.snapshot().get('p')!.nextDirectRetryAt)
    }
    // Delay from NOW grows (backoff growth outpaces the jitter band).
    const base = seen[0] - clock.now()
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i] - clock.now()).toBeGreaterThan(base)
    }
  })

  it('relay loss parks the peer in failed until the relay is wired again', () => {
    const reg = createTransportRegistry({ now: fixedClock().now })
    reg.startDirectAttempt('p')
    reg.markDirectFailed('p', 'no route', false)
    expect(reg.phaseFor('p')).toBe('failed')
    expect(reg.shouldRetryDirect('p')).toBe(false)

    // The node came back: registraing the relay demotes failed -> relay.
    reg.markRelayInUse('p')
    expect(reg.phaseFor('p')).toBe('relay')
  })

  it('a validated direct path is not demoted by relay sightings', () => {
    const clock = fixedClock()
    const reg = createTransportRegistry({ now: clock.now })
    reg.startDirectAttempt('p')
    reg.markDirectValidated('p')
    reg.markRelayInUse('p')
    expect(reg.phaseFor('p')).toBe('direct')
  })

  it('retry is one-shot and only outside direct/connecting phases', () => {
    const clock = fixedClock()
    const reg = createTransportRegistry({ now: clock.now })
    expect(reg.shouldRetryDirect('p')).toBe(false) // idle: never scheduled

    reg.startDirectAttempt('p')
    reg.markDirectFailed('p', 'x', true)
    clock.tick(60_000)
    expect(reg.shouldRetryDirect('p')).toBe(true)
    expect(reg.shouldRetryDirect('p')).toBe(false) // consumed

    reg.startDirectAttempt('p')
    reg.markDirectValidated('p')
    expect(reg.shouldRetryDirect('p')).toBe(false)
  })

  it('a direct attempt in flight, when declared overdue, is failure-shaped', () => {
    const clock = fixedClock()
    const reg = createTransportRegistry({ now: clock.now, directDeadlineMs: 5000 })
    reg.startDirectAttempt('p')
    expect(reg.isDirectAttemptOverdue('p')).toBe(false)
    clock.tick(6000)
    expect(reg.isDirectAttemptOverdue('p')).toBe(true)
  })

  it('cleanup clears state; an unknown peer stays idle forever', () => {
    const reg = createTransportRegistry({ now: fixedClock().now })
    reg.startDirectAttempt('p')
    reg.markDirectValidated('p')
    reg.forget('p')
    expect(reg.phaseFor('p')).toBe('idle')
    expect(reg.snapshot().size).toBe(0)
  })
})
