import { beforeEach, describe, expect, it } from 'vitest'
import {
  BLOCKLIST,
  __resetUserExcludes,
  filterTags,
  getUserExcludes,
  isNoise,
  isQueryBlocked,
  isRatingAllowed,
  isTagBlocked,
  isUserExcluded,
  parseTagField,
  rankTags,
  setUserExcludes,
} from './tagFilter'

describe('hard blocklist (SPEC §8)', () => {
  it('rejects minor-related tags', () => {
    for (const tag of [
      'loli',
      'loli_ta',
      'shota',
      'schoolgirl',
      'kindergarten',
      'underage',
      'preteen',
      'child',
      'childhood_friends',
      'kid',
      'infant',
      'baby',
      'toddler',
      'minor',
      'juvenile',
    ]) {
      expect(isTagBlocked(tag), tag).toBe(true)
    }
  })

  it('rejects prohibited-content tags', () => {
    for (const tag of [
      'ageplay',
      'age_play',
      'bestiality',
      'zoo_philia',
      'necrophilia',
      'rape',
      'non-con',
      'noncon',
      'non_consensual',
    ]) {
      expect(isTagBlocked(tag), tag).toBe(true)
    }
  })

  it('is case-insensitive', () => {
    expect(isTagBlocked('LOLI')).toBe(true)
    expect(isTagBlocked('Schoolgirl_KINDERGARTEN')).toBe(true)
    expect(isTagBlocked('Bestiality')).toBe(true)
  })

  it('passes normal adult tags', () => {
    for (const tag of [
      'wet',
      'long_hair',
      'closed_eyes',
      'thighhighs',
      'cleavage',
      'navel',
      'spread_legs',
      'nude',
      'nipples',
      'orgasm',
      'gangbang',
      'creampie',
      'ahegao',
      'pregnant',
      'veiny_penis',
      'bulge',
    ]) {
      expect(isTagBlocked(tag), tag).toBe(false)
    }
  })

  it('blocklist covers every illegal-core term (SPEC §8 child-safety line)', () => {
    for (const term of [
      'loli', 'shota', 'child', 'kid', 'infant', 'baby', 'toddler',
      'minor', 'underage', 'juvenile', 'preteen', 'schoolgirl',
      'ageplay', 'bestiality', 'zoo', 'necro', 'rape', 'noncon',
      'non_consensual',
    ]) {
      expect(BLOCKLIST.some((b) => term.includes(b) || b.includes(term)), term).toBe(true)
    }
  })

  it('allows legal kinks by default — the player owns these choices', () => {
    for (const tag of [
      'feet', 'futanari', 'yuri', 'yaoi', 'tentacle', 'kissing', 'solo',
      '1girl', 'incest', 'gore', 'netorare', 'crossdressing', 'school_uniform',
    ]) {
      expect(isTagBlocked(tag), tag).toBe(false)
    }
  })

  it('blocks suggested categories only after the player adds them', () => {
    setUserExcludes(['feet', 'incest'])
    expect(isTagBlocked('feet_worship')).toBe(true)
    expect(isTagBlocked('incest')).toBe(true)
    expect(isUserExcluded('incest')).toBe(true)
    expect(isTagBlocked('loli')).toBe(true) // hard line unaffected by user list
    __resetUserExcludes()
  })
})

describe('ratings', () => {
  it('allows explicit/adult, rejects everything else', () => {
    expect(isRatingAllowed('e')).toBe(true)
    expect(isRatingAllowed('explicit')).toBe(true)
    expect(isRatingAllowed('adult')).toBe(true)
    expect(isRatingAllowed('q')).toBe(false)
    expect(isRatingAllowed('questionable')).toBe(false)
    expect(isRatingAllowed('s')).toBe(false)
    expect(isRatingAllowed('safe')).toBe(false)
  })

  it('allows posts with no rating field (danbooru-style sources)', () => {
    expect(isRatingAllowed(undefined)).toBe(true)
    expect(isRatingAllowed('')).toBe(true)
  })
})

describe('noise filtering', () => {
  it('flags meta/quality tags as noise', () => {
    expect(isNoise('highres')).toBe(true)
    expect(isNoise('watermark')).toBe(true)
    expect(isNoise('rating_explicit')).toBe(true)
    expect(isNoise('1girl')).toBe(false)
  })
})

describe('filterTags', () => {
  it('drops blocked, noise, empty and duplicate tags', () => {
    const out = filterTags([
      'gangbang', 'loli', 'wet', 'highres', 'gangbang', '', 'pregnant', 'schoolboy',
    ])
    expect(out).toEqual(['gangbang', 'wet', 'pregnant'])
  })

  it('never returns a blocked tag even if mixed case', () => {
    const out = filterTags(['LOLI', 'Shota', 'Bestiality', 'creampie'])
    expect(out).toEqual(['creampie'])
  })
})

describe('parseTagField / rankTags', () => {
  it('splits whitespace- and comma-separated tag fields', () => {
    expect(parseTagField('1girl wet, lingerie')).toEqual(['1girl', 'wet', 'lingerie'])
  })

  it('ranks by frequency then name, excluding blocked', () => {
    const ranked = rankTags(['wet', 'gangbang', 'wet', 'loli', 'gangbang', 'gangbang'])
    expect(ranked).toEqual([
      { name: 'gangbang', frequency: 3 },
      { name: 'wet', frequency: 2 },
    ])
  })
})

describe('isQueryBlocked', () => {
  it('rejects whole queries containing a blocked term', () => {
    expect(isQueryBlocked('gangbang loli')).toBe(true)
    expect(isQueryBlocked('gangbang wet')).toBe(false)
  })
})

describe('user excludes (setup screen / config tab)', () => {
  beforeEach(() => __resetUserExcludes())

  it('normalizes, dedupes and exposes the list', () => {
    setUserExcludes([' Feet ', 'FEET', '', '  ', 'latex'])
    expect(getUserExcludes()).toEqual(['feet', 'latex'])
    expect(isUserExcluded('feet')).toBe(true)
    expect(isUserExcluded('soles')).toBe(false)
  })

  it('excluded terms block tags, queries, ranking and filtering', () => {
    setUserExcludes(['feet'])
    expect(isTagBlocked('feet')).toBe(true)
    expect(isTagBlocked('foot_fetish')).toBe(false)
    expect(isTagBlocked('bare_feet')).toBe(true)
    expect(isQueryBlocked('gangbang feet')).toBe(true)
    expect(filterTags(['feet', 'wet'])).toEqual(['wet'])
    expect(rankTags(['feet', 'wet', 'feet']).map((r) => r.name)).toEqual(['wet'])
  })

  it('hard blocklist still applies with no excludes set', () => {
    expect(isTagBlocked('loli')).toBe(true)
    expect(isTagBlocked('gangbang')).toBe(false)
  })
})
