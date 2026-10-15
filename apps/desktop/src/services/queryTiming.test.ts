import { describe, expect, it, beforeEach } from 'vitest'
import { clearQueryTimings, endRound, markStage, readQueryTimings, startRound, timingSummary } from './queryTiming'

describe('queryTiming', () => {
  beforeEach(() => {
    clearQueryTimings()
  })

  it('records a round with its stages', () => {
    const r = startRound('wet ass')
    markStage(r, 'request', 120)
    markStage(r, 'filter', 8)
    endRound(r)
    expect(readQueryTimings()).toEqual([expect.objectContaining({ label: 'wet ass', stages: { request: 120, filter: 8 } })])
  })

  it('accumulates a repeated stage instead of overwriting it', () => {
    const r = startRound('q')
    markStage(r, 'request', 10)
    markStage(r, 'request', 5)
    expect(r.stages.request).toBe(15)
  })

  it('ignores negative durations (clock skew must not poison the median)', () => {
    const r = startRound('q')
    markStage(r, 'request', -50)
    markStage(r, 'request', 20)
    expect(r.stages.request).toBe(20)
  })

  it('summarizes the median per stage and leaves unrun stages NaN', () => {
    for (const ms of [10, 20, 30]) {
      const r = startRound('q')
      markStage(r, 'request', ms)
      endRound(r)
    }
    const s = timingSummary()
    expect(s.request).toBe(20)
    expect(s.plan).toBeNaN()
    expect(s.filter).toBeNaN()
  })

  it('averages the two middle values on an even sample', () => {
    for (const ms of [10, 20, 30, 40]) {
      const r = startRound('q')
      markStage(r, 'filter', ms)
      endRound(r)
    }
    expect(timingSummary().filter).toBe(25)
  })

  it('bounds the ring buffer so a long session cannot grow without limit', () => {
    for (let i = 0; i < 60; i++) {
      const r = startRound(`q${i}`)
      markStage(r, 'request', i)
      endRound(r)
    }
    const all = readQueryTimings()
    expect(all).toHaveLength(50)
    // Oldest evicted, newest kept.
    expect(all[0].label).toBe('q10')
    expect(all[49].label).toBe('q59')
  })
})