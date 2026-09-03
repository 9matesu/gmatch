import { describe, expect, it } from 'vitest'
import {
  MAX_TAG_LEVEL,
  STARTER_TAGS,
  buyTag,
  canBuyTag,
  deriveTagStats,
  feedQuery,
  starterOffers,
  tagCost,
} from './tags'
import type { OwnedTag } from './types'

function tag(name: string, level: number, base = 100): OwnedTag {
  return { name, level, base, income: 1, weight: 1 }
}

describe('tagCost (SPEC §3)', () => {
  it('cost = base * 1.15^owned', () => {
    expect(tagCost(100, 0)).toBe(100)
    expect(tagCost(100, 1)).toBe(115)
    expect(tagCost(100, 2)).toBe(133)
    expect(tagCost(100, 3)).toBe(153)
  })

  it('grows exponentially', () => {
    expect(tagCost(50, 10)).toBe(Math.ceil(50 * Math.pow(1.15, 10)))
  })
})

describe('level cap', () => {
  it('max 20 levels per tag', () => {
    expect(MAX_TAG_LEVEL).toBe(20)
    expect(canBuyTag(tag('wet', 19))).toBe(true)
    expect(canBuyTag(tag('wet', 20))).toBe(false)
    expect(buyTag(tag('wet', 20), 1e9)).toBeNull()
  })
})

describe('buyTag', () => {
  it('charges current cost and levels up', () => {
    const res = buyTag(tag('wet', 0, 100), 150)
    expect(res).not.toBeNull()
    expect(res!.tag.level).toBe(1)
    expect(res!.gp).toBe(50)
  })

  it('refuses when unaffordable', () => {
    expect(buyTag(tag('wet', 0, 100), 99)).toBeNull()
  })
})

describe('starter tags (SPEC §3)', () => {
  it('seeds the evergreen list', () => {
    expect([...STARTER_TAGS]).toEqual([
      '1girl', 'solo', 'long_hair', 'smile', 'closed_eyes', 'wet', 'lingerie', 'cosplay',
    ])
    const offers = starterOffers()
    expect(offers.map((o) => o.name)).toEqual([...STARTER_TAGS])
    expect(offers.every((o) => o.level === 0 && o.base > 0 && o.income > 0)).toBe(true)
  })
})

describe('deriveTagStats', () => {
  it('rarer tags are pricier', () => {
    expect(deriveTagStats('wet', 1).base).toBeGreaterThan(deriveTagStats('wet', 50).base)
  })

  it('longer tags are pricier', () => {
    expect(deriveTagStats('thighhighs', 10).base).toBeGreaterThan(deriveTagStats('wet', 10).base)
  })

  it('income and weight are positive', () => {
    const s = deriveTagStats('1girl', 5)
    expect(s.income).toBeGreaterThan(0)
    expect(s.weight).toBeGreaterThan(0)
  })
})

describe('feedQuery (SPEC §3)', () => {
  it('returns top 5 owned tags by level', () => {
    const tags = [
      tag('a', 1), tag('b', 5), tag('c', 3), tag('d', 4), tag('e', 2), tag('f', 6),
    ]
    expect(feedQuery(tags)).toEqual(['f', 'b', 'd', 'c', 'e'])
  })

  it('ignores unowned tags', () => {
    expect(feedQuery([tag('a', 0), tag('b', 2)])).toEqual(['b'])
  })
})
