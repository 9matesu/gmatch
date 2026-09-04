import { describe, expect, it } from 'vitest'
import { PERVERT_TAGS, pervertSeeds, weightedPick } from './pervertTags'

describe('PERVERT_TAGS pool', () => {
  it('has the user-requested core tags', () => {
    const names = PERVERT_TAGS.map((t) => t.tag)
    for (const want of ['gangbang', 'pregnant', 'veiny_penis', 'bulge', 'ahegao', 'creampie']) {
      expect(names).toContain(want)
    }
  })

  it('contains no blocklisted tag (SPEC §8 invariant)', async () => {
    const { BLOCKLIST } = await import('../game/tagFilter')
    const { isTagBlocked } = await import('../game/tagFilter')
    for (const { tag } of PERVERT_TAGS) {
      expect(isTagBlocked(tag), tag).toBe(false)
      for (const bad of BLOCKLIST) {
        expect(tag.includes(bad), `${tag} vs ${bad}`).toBe(false)
      }
    }
  })

  it('all weights are positive integers', () => {
    for (const t of PERVERT_TAGS) {
      expect(t.weight).toBeGreaterThanOrEqual(1)
      expect(Number.isInteger(t.weight)).toBe(true)
    }
  })
})

describe('weightedPick', () => {
  it('always returns a pool member', () => {
    const pool = [{ tag: 'a', weight: 1 }, { tag: 'b', weight: 9 }]
    for (let i = 0; i < 50; i++) {
      const p = weightedPick(pool)
      expect(['a', 'b']).toContain(p.tag)
    }
  })

  it('heavier weights dominate statistically', () => {
    const pool = [{ tag: 'rare', weight: 1 }, { tag: 'common', weight: 20 }]
    let common = 0
    for (let i = 0; i < 500; i++) {
      if (weightedPick(pool).tag === 'common') common++
    }
    expect(common).toBeGreaterThan(350)
  })
})

describe('pervertSeeds', () => {
  it('returns distinct tags', () => {
    const seeds = pervertSeeds(3)
    expect(new Set(seeds).size).toBe(seeds.length)
    expect(seeds.length).toBe(3)
  })

  it('handles n larger than the pool without dupes', () => {
    const seeds = pervertSeeds(999)
    expect(new Set(seeds).size).toBe(seeds.length)
  })

  it('never emits a blocked tag', () => {
    for (let i = 0; i < 20; i++) {
      for (const s of pervertSeeds(3)) {
        expect(s).not.toMatch(/loli|shota|child|furry|anthro/)
      }
    }
  })
})
