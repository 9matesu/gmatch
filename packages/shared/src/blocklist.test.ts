import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BLOCKLIST,
  hitsAtTokenStart,
  isBlacklistedTag,
  normalizeTagText,
  tagHitsAnyTerm,
} from './index'

/**
 * The blocklist rule (SPEC §8) lives in @orbit/shared now — one canonical
 * implementation for the renderer, the API and the protocol. These tests pin
 * the rule itself, because it is the safety line of the whole app: a term
 * matches when it starts a token, and may be a PREFIX of that token.
 */

describe('normalizeTagText', () => {
  it('lowercases and folds spaces and hyphens into the underscore boundary', () => {
    expect(normalizeTagText('Big-Ass')).toBe('big_ass')
    expect(normalizeTagText('big  ass')).toBe('big_ass')
    expect(normalizeTagText('NON_CONSENT')).toBe('non_consent')
  })
})

describe('hitsAtTokenStart', () => {
  it('matches a term that starts a token', () => {
    expect(hitsAtTokenStart('loli', 'loli')).toBe(true)
    expect(hitsAtTokenStart('x_loli_y', 'loli')).toBe(true)
    expect(hitsAtTokenStart('sweet_teen', 'teen')).toBe(true)
  })

  it('matches a term that is a PREFIX of its token (real compounds stay blocked)', () => {
    expect(hitsAtTokenStart('lolicon', 'loli')).toBe(true)
    expect(hitsAtTokenStart('teenager', 'teen')).toBe(true)
    expect(hitsAtTokenStart('childhood_friends', 'child')).toBe(true)
    expect(hitsAtTokenStart('necrophilia', 'necro')).toBe(true)
    expect(hitsAtTokenStart('zoom', 'zoo')).toBe(true)
  })

  it('ignores a mid-token hit (the accidental case)', () => {
    expect(hitsAtTokenStart('fifteen', 'teen')).toBe(false)
    expect(hitsAtTokenStart('grape', 'rape')).toBe(false)
    expect(hitsAtTokenStart('sweet_sixteen', 'teen')).toBe(false)
  })

  it('is false for an empty input', () => {
    expect(hitsAtTokenStart('', 'loli')).toBe(false)
    expect(hitsAtTokenStart('loli', '')).toBe(false)
  })
})

describe('tagHitsAnyTerm', () => {
  it('is false for an empty tag or an empty list', () => {
    expect(tagHitsAnyTerm('', ['loli'])).toBe(false)
    expect(tagHitsAnyTerm('loli', [])).toBe(false)
  })
})

describe('isBlacklistedTag (the live gate)', () => {
  it('blocks the hard line', () => {
    for (const tag of ['loli', 'LOLI', 'lolicon', 'shota', 'child', 'teenager', 'bestiality', 'zoo_philia']) {
      expect(isBlacklistedTag(tag), tag).toBe(true)
    }
  })

  it('does not block legal tags that merely contain a banned substring', () => {
    // The bug the token-boundary rule replaced: a raw substring test starved
    // the feed of legal tags ('fifteen' via 'teen', 'grape' via 'rape').
    for (const tag of ['fifteen', 'grape', 'scrape', 'nineteen', 'sweet_sixteen', 'scrapbook', 'candid']) {
      expect(isBlacklistedTag(tag), tag).toBe(false)
    }
  })

  it('keeps blocking a term that is a PREFIX of the tag (policy, not an accident)', () => {
    // 'zoom' (zoo) and 'babydoll' (baby) are still blocked: letting them
    // through would mean dropping the 'zoo'/'baby' terms, which would leak
    // 'zoophilia' and 'baby'-prefixed terms. SPEC §8 calls this out.
    expect(isBlacklistedTag('zoom')).toBe(true)
    expect(isBlacklistedTag('babydoll')).toBe(true)
    expect(isBlacklistedTag('childless')).toBe(true)
  })
})

describe('the shipped blocklist file', () => {
  it('covers every illegal-core term (SPEC §8 child-safety line)', () => {
    for (const term of [
      'loli', 'shota', 'child', 'kid', 'infant', 'baby', 'toddler',
      'minor', 'underage', 'juvenile', 'preteen', 'schoolgirl',
      'ageplay', 'bestiality', 'zoo', 'necro', 'rape', 'noncon',
      'non_consensual',
    ]) {
      expect(DEFAULT_BLOCKLIST.some((b) => term.includes(b) || b.includes(term)), term).toBe(true)
    }
  })
})
