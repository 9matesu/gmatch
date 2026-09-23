import { describe, expect, it } from 'vitest'
import { buildRoundQueries, roundQueryKey, PILLS_PER_ROUND, RECENT_QUERY_DEPTH } from './queryBuilder'

/** Deterministic RNG: always returns the same value. */
const zeroRand = () => 0
const oneRand = () => 0.999999

describe('roundQueryKey', () => {
  it('is order-independent', () => {
    expect(roundQueryKey(['b', 'a'])).toBe(roundQueryKey(['a', 'b']))
  })
})

describe('buildRoundQueries (single-pill smart rotation)', () => {
  it('returns single pills only — never combines separate tags', () => {
    const picks = buildRoundQueries({ pills: ['a', 'b', 'c', 'd'], count: 2, rand: zeroRand })
    expect(picks).toHaveLength(2)
    for (const p of picks) expect(p).not.toContain(' ')
  })

  it('keeps merged pills atomic (never split apart)', () => {
    for (let i = 0; i < 20; i++) {
      const picks = buildRoundQueries({ pills: ['a b', 'c', 'd'], count: 2 })
      for (const p of picks) expect(['a b', 'c', 'd']).toContain(p)
      expect(picks).not.toContain('a')
      expect(picks).not.toContain('b')
    }
  })

  it('caps count at the pool size and returns [] for empty pools', () => {
    expect(buildRoundQueries({ pills: ['a'], count: 5, rand: zeroRand })).toEqual(['a'])
    expect(buildRoundQueries({ pills: [], count: 2 })).toEqual([])
  })

  it('always includes the forced pill when eligible', () => {
    for (let i = 0; i < 20; i++) {
      const picks = buildRoundQueries({ pills: ['a', 'b', 'c', 'd'], count: 2, forceInclude: 'c' })
      expect(picks).toContain('c')
      expect(picks).toHaveLength(2)
    }
  })

  it('ignores a forced pill that is not eligible', () => {
    const picks = buildRoundQueries({ pills: ['a', 'b'], count: 2, forceInclude: 'zzz', rand: zeroRand })
    expect(picks).not.toContain('zzz')
    expect(picks).toHaveLength(2)
  })

  it('refuses recent round keys when an alternative exists', () => {
    // 3 pills, count 2 → possible keys: a b, a c, b c. Block two of them.
    const picks = buildRoundQueries({
      pills: ['a', 'b', 'c'],
      count: 2,
      recentKeys: ['a b', 'a c'],
      maxRetries: 50,
    })
    expect(roundQueryKey(picks)).toBe('b c')
  })

  it('randomizes order (different RNG → different order)', () => {
    const pills = ['a', 'b', 'c', 'd']
    const r1 = buildRoundQueries({ pills, count: 4, rand: zeroRand })
    const r2 = buildRoundQueries({ pills, count: 4, rand: oneRand })
    expect([...r1].sort()).toEqual([...r2].sort())
    expect(r1).not.toEqual(r2)
  })

  it('exposes sane round tuning constants', () => {
    expect(PILLS_PER_ROUND).toBeGreaterThanOrEqual(1)
    expect(RECENT_QUERY_DEPTH).toBeGreaterThanOrEqual(4)
  })
})
