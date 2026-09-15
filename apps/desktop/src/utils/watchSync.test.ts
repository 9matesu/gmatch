import { describe, expect, it } from 'vitest'
import { computeTargetPosition, driftCorrection, ClockOffset, type SyncFrame } from './watchSync'

function frame(over: Partial<SyncFrame> = {}): SyncFrame {
  return { url: 'a.mp4', action: 'play', position: 10, rate: 1, updatedAt: 100, ...over }
}

describe('computeTargetPosition', () => {
  it('paused frame sits exactly on position', () => {
    expect(computeTargetPosition(frame({ action: 'pause' }), 999)).toBe(10)
  })
  it('play frame advances by rate * elapsed server time', () => {
    expect(computeTargetPosition(frame(), 112)).toBe(22)
  })
  it('never rewinds before updatedAt', () => {
    expect(computeTargetPosition(frame(), 90)).toBe(10)
  })
})

describe('driftCorrection', () => {
  it('ignores drift inside the deadband while playing', () => {
    expect(driftCorrection(21.9, 22, true, 'play')).toEqual({ seekTo: null, play: false, pause: false })
  })
  it('seeks paused slots onto the target even inside hardresync range', () => {
    expect(driftCorrection(9, 10, false, 'pause')).toEqual({ seekTo: 10, play: false, pause: false })
  })
  it('absorbs mid-range drift while playing without a seek', () => {
    expect(driftCorrection(20, 22, true, 'play')).toEqual({ seekTo: null, play: false, pause: false })
  })
  it('hard-resyncs on large drift while playing', () => {
    expect(driftCorrection(27, 22, true, 'play').seekTo).toBe(22)
  })
  it('starts a paused local video when the party is playing', () => {
    expect(driftCorrection(22, 22, false, 'play')).toEqual({ seekTo: null, play: true, pause: false })
  })
  it('pauses a playing local video when the party is paused', () => {
    expect(driftCorrection(10, 10, true, 'pause')).toEqual({ seekTo: null, play: false, pause: true })
  })
})

describe('ClockOffset', () => {
  it('uses raw local time with no samples', () => {
    const c = new ClockOffset()
    expect(Math.abs(c.now() - Date.now() / 1000)).toBeLessThan(0.1)
  })
  it('applies the offset of the lowest-RTT sample', async () => {
    const c = new ClockOffset()
    // noisy: server t1=50 at local roundtrip 10s
    await c.sample(async () => ({ t0: 0, t1: 50, t3: 10 }))
    // clean: server t1=100 at local 2s roundtrip
    await c.sample(async () => ({ t0: 200, t1: 100, t3: 202 }))
    // offset = 100 + 1 - 202 = -101 vs Date.now/1000
    expect(Math.abs(c.now() - (Date.now() / 1000 - 101))).toBeLessThan(0.5)
    // a worse sample must not override the best one
    await c.sample(async () => ({ t0: 0, t1: 40, t3: 30 }))
    expect(Math.abs(c.now() - (Date.now() / 1000 - 101))).toBeLessThan(0.5)
  })
})
