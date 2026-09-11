import { describe, expect, it } from 'vitest'
import {
  MAX_MARKET_OFFERS,
  MAX_TAG_LEVEL,
  buyTag,
  canBuyTag,
  deriveTagStats,
  discoverTags,
  feedQuery,
  isTagSelected,
  mergeTags,
  normalizeCustomTag,
  removeTag,
  setupTag,
  soloTag,
  tagCost,
  toggleTag,
  validateCustomTag,
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
    expect(res!.gc).toBe(50)
  })

  it('refuses when unaffordable', () => {
    expect(buyTag(tag('wet', 0, 100), 99)).toBeNull()
  })
})

describe('setup picks (user spec: no hardcoded default tags)', () => {
  it('setupTag joins owned at level 1, feed-selected', () => {
    const t = setupTag('gangbang')
    expect(t).toMatchObject({ name: 'gangbang', level: 1, selected: true })
    expect(t.base).toBeGreaterThan(0)
    expect(isTagSelected(t)).toBe(true)
    expect(feedQuery([t])).toEqual(['gangbang'])
  })

  it('exports no default tag list', async () => {
    const mod = (await import('./tags')) as Record<string, unknown>
    expect('STARTER_TAGS' in mod).toBe(false)
    expect('starterOffers' in mod).toBe(false)
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

  it('only selected owned tags feed the round-robin', () => {
    const tags = [
      { ...tag('aaa', 3), selected: false },
      tag('bbb', 1),
      { ...tag('ccc', 0), selected: true },
    ]
    expect(feedQuery(tags)).toEqual(['bbb'])
  })
})

describe('buy selects / toggleTag', () => {
  it('first purchase marks the tag selected', () => {
    const res = buyTag({ ...tag('gangbang', 0), selected: false }, 1_000_000)
    expect(res).not.toBeNull()
    expect(res!.tag.level).toBe(1)
    expect(res!.tag.selected).toBe(true)
  })

  it('toggle flips selection on owned tags, refuses unowned offers', () => {
    expect(toggleTag(tag('a', 2))!.selected).toBe(false)
    expect(toggleTag({ ...tag('a', 2), selected: false })!.selected).toBe(true)
    expect(toggleTag(tag('a', 0))).toBeNull()
  })

  it('legacy tags without the flag count as selected when owned', () => {
    expect(isTagSelected(tag('x', 1))).toBe(true)
    expect(isTagSelected(tag('x', 0))).toBe(false)
  })
})

describe('discoverTags (auto-generated as you progress)', () => {
  it('adds unseen foe tags as unselected offers, keeps owned levels', () => {
    const tags = [{ ...tag('gangbang', 2), selected: true }]
    const out = discoverTags(tags, ['gangbang', 'huge_breasts', 'outdoor'])
    expect(out.map((t) => t.name)).toContain('huge_breasts')
    const fresh = out.find((t) => t.name === 'huge_breasts')!
    expect(fresh.level).toBe(0)
    expect(fresh.selected).toBe(false)
    expect(out.find((t) => t.name === 'gangbang')!.level).toBe(2)
  })

  it('adds nothing new returns the same array, drops blocked tags', () => {
    const tags = [{ ...tag('gangbang', 1), selected: true }]
    expect(discoverTags(tags, ['gangbang'])).toBe(tags)
    expect(discoverTags(tags, ['loli']).map((t) => t.name)).not.toContain('loli')
  })

  it('caps unowned offers but always keeps owned tags', () => {
    const tags = [{ ...tag('keeper', 5), selected: true }]
    const many = Array.from({ length: MAX_MARKET_OFFERS + 10 }, (_, i) => `fresh_tag_${i}`)
    const out = discoverTags(tags, many)
    expect(out.map((t) => t.name)).toContain('keeper')
    expect(out.filter((t) => t.level === 0).length).toBeLessThanOrEqual(MAX_MARKET_OFFERS)
  })
})

describe('soloTag (feed only one tag)', () => {
  it('selects only the named owned tag', () => {
    const tags = [
      { ...tag('a', 2), selected: true },
      { ...tag('b', 1), selected: true },
      tag('c', 0),
    ]
    const next = soloTag(tags, 'b')!
    expect(next.find((t) => t.name === 'a')!.selected).toBe(false)
    expect(next.find((t) => t.name === 'b')!.selected).toBe(true)
    expect(next.find((t) => t.name === 'c')!.selected).toBeUndefined()
    expect(feedQuery(next)).toEqual(['b'])
  })

  it('null when target missing or unowned', () => {
    expect(soloTag([tag('a', 1)], 'zzz')).toBeNull()
    expect(soloTag([tag('a', 0)], 'a')).toBeNull()
  })
})

describe('validateCustomTag (custom search tags)', () => {
  it('normalizes free-form input to snake_case', () => {
    expect(normalizeCustomTag('Skylar Vox')).toBe('skylar_vox')
    expect(normalizeCustomTag('  black-cock  ')).toBe('black_cock')
    expect(normalizeCustomTag('BBC!')).toBe('bbc')
  })

  it('accepts real-porn tags the user asked for', () => {
    for (const raw of ['skylar vox', 'BBC', 'black_cock', 'goon caption', 'gooncaps']) {
      expect(validateCustomTag(raw).ok, raw).toBe(true)
    }
  })

  it('rejects empty / too-short / too-long input', () => {
    expect(validateCustomTag('')).toEqual({ ok: false, reason: 'empty' })
    expect(validateCustomTag('x')).toEqual({ ok: false, reason: 'too-short' })
    expect(validateCustomTag('a'.repeat(41))).toEqual({ ok: false, reason: 'too-long' })
  })

  it('rejects blocklisted and noise tags', () => {
    expect(validateCustomTag('loli')).toEqual({ ok: false, reason: 'blocked' })
    expect(validateCustomTag('schoolgirl uniform')).toEqual({ ok: false, reason: 'blocked' })
    expect(validateCustomTag('highres')).toEqual({ ok: false, reason: 'noise' })
  })
})

describe('removeTag (T1: player cleanup)', () => {
  it('drops the owned tag, keeps the rest', () => {
    const tags = [tag('a', 3), tag('b', 1), tag('c', 0)]
    const next = removeTag(tags, 'a')
    expect(next?.map((t) => t.name)).toEqual(['b', 'c'])
  })
  it('refuses to remove unowned/missing', () => {
    const tags = [tag('a', 3), tag('c', 0)]
    expect(removeTag(tags, 'c')).toBeNull()
    expect(removeTag(tags, 'zz')).toBeNull()
  })
  it('refuses when it is the last selected pill', () => {
    const tags = [{ ...tag('a', 3), selected: true }, { ...tag('b', 1), selected: false }]
    expect(removeTag(tags, 'a')).toBeNull()
  })
})

describe('mergeTags (T2: two pills -> combined search)', () => {
  it('merges both levels into one selected tag', () => {
    const tags = [tag('a', 3), tag('b', 2), tag('c', 1)]
    const next = mergeTags(tags, 'a', 'b')
    expect(next?.find((t) => t.name === 'a')).toBeUndefined()
    expect(next?.find((t) => t.name === 'b')).toBeUndefined()
    const m = next?.find((t) => t.name === 'a_b')
    expect(m?.level).toBe(3)
    expect(m?.selected).toBe(true)
  })
  it('caps at MAX_TAG_LEVEL and keeps untouched tags', () => {
    const tags = [tag('x'.repeat(20), MAX_TAG_LEVEL), tag('y'.repeat(20), MAX_TAG_LEVEL)]
    const m = mergeTags(tags, tags[0].name, tags[1].name)?.find((t) => t.level === MAX_TAG_LEVEL)
    expect(m).toBeDefined()
  })
  it('refuses unowned or unknown', () => {
    const tags = [tag('a', 1), tag('c', 0)]
    expect(mergeTags(tags, 'a', 'c')).toBeNull()
    expect(mergeTags(tags, 'a', 'zz')).toBeNull()
  })
})
