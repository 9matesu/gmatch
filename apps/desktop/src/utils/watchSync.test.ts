import { describe, expect, it } from 'vitest'
import { computeTargetPosition, driftCorrection, ClockOffset, shouldFireQueueNext, type SyncFrame } from './watchSync'

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

  // A frame restored from the persisted snapshot can arrive with a missing or
  // garbage field. NaN used to flow straight into every comparison in the sync
  // tick — and `NaN > x` is false for every x — so the slot silently stopped
  // seeking, pausing and advancing, with the scrubber frozen at 0:00.
  it('never returns NaN for a corrupt frame', () => {
    for (const bad of [
      { position: NaN },
      { position: undefined as unknown as number },
      { position: -1 },
      { updatedAt: NaN },
      { rate: NaN },
      { rate: undefined as unknown as number },
    ]) {
      const t = computeTargetPosition(frame(bad), 112)
      expect(Number.isNaN(t), JSON.stringify(bad)).toBe(false)
      expect(Number.isFinite(t), JSON.stringify(bad)).toBe(true)
    }
  })
  it('degrades a corrupt frame to a usable position', () => {
    expect(computeTargetPosition(frame({ position: NaN }), 112)).toBe(0)
    expect(computeTargetPosition(frame({ position: 10, updatedAt: NaN }), 112)).toBe(10)
  })
})

describe('driftCorrection with unusable positions', () => {
  it('still applies absolute transport when the positions are NaN', () => {
    // play/pause are absolute; a NaN position must not disable them.
    expect(driftCorrection(NaN, NaN, true, 'pause')).toEqual({ seekTo: null, play: false, pause: true })
    expect(driftCorrection(NaN, NaN, false, 'play')).toEqual({ seekTo: null, play: true, pause: false })
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

describe('shouldFireQueueNext', () => {
  const base = { isHost: true, queueLength: 2, action: 'play' as const, lastFiredKey: '' }
  it('fires for host while playing with a queue', () => {
    expect(shouldFireQueueNext({ ...base, endedKey: 'f1' })).toBe(true)
  })
  it('single-entry queue loops (one video all night)', () => {
    expect(shouldFireQueueNext({ ...base, queueLength: 1, endedKey: 'f1' })).toBe(true)
  })
  it('never double-fires the same frame key (wrap re-keys the frame)', () => {
    expect(shouldFireQueueNext({ ...base, endedKey: 'f1', lastFiredKey: 'f1' })).toBe(false)
  })
  it('non-host and paused rooms do not fire', () => {
    expect(shouldFireQueueNext({ ...base, isHost: false, endedKey: 'f1' })).toBe(false)
    expect(shouldFireQueueNext({ ...base, action: 'pause', endedKey: 'f1' })).toBe(false)
  })
})
