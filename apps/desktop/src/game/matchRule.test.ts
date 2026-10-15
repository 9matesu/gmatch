import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { matchesQuery as tsMatches, parseQuery as tsParse, normalizeTag as tsNormalize } from './matchRule'

/**
 * The matching rule is implemented twice on purpose: electron/matchRule.cjs is
 * authoritative (main.cjs cannot import TS) and matchRule.ts is the renderer
 * mirror. These tests pin BOTH against the same fixtures so they cannot drift
 * — the packaged app and a browser dev session must answer a query identically.
 */
const require = createRequire(import.meta.url)
const cjs = require('../../electron/matchRule.cjs') as {
  matchesQuery: (t: readonly string[], q: unknown, o?: { trustUntagged?: boolean }) => boolean
  parseQuery: (q: unknown) => { required: string[]; negated: string[] }
  normalizeTag: (r: unknown) => string
}

const POSTS = {
  both: ['large_breasts', 'solo', '1girl'],
  onlyFirst: ['large_breasts', '1girl'],
  onlySecond: ['solo', '1girl'],
  none: ['1girl', 'rating_explicit'],
  spaces: ['Large Breasts', '1girl'],
  hyphen: ['big-ass', '1girl'],
  untagged: [] as string[],
}

describe('strict AND tag matching', () => {
  it('rejects a post matching only one of two required tags', () => {
    // This is the exact defect that made results meaningless: the old rule
    // returned OR-of-substrings, so this post used to PASS.
    expect(tsMatches(POSTS.onlyFirst, 'large_breasts solo')).toBe(false)
    expect(tsMatches(POSTS.onlySecond, 'large_breasts solo')).toBe(false)
    expect(tsMatches(POSTS.both, 'large_breasts solo')).toBe(true)
  })

  it('does not match a multi-word tag against one of its words', () => {
    // Old rule split `large_breasts` on `_` and substring-matched `large`.
    expect(tsMatches(['large', '1girl'], 'large_breasts')).toBe(false)
    expect(tsMatches(['breasts', '1girl'], 'large_breasts')).toBe(false)
    expect(tsMatches(['large_breasts'], 'large_breasts')).toBe(true)
  })

  it('normalizes case, spaces and hyphens on both sides', () => {
    expect(tsMatches(POSTS.spaces, 'large_breasts')).toBe(true)
    expect(tsMatches(POSTS.hyphen, 'big_ass')).toBe(true)
    expect(tsMatches(['big_ass'], 'big-ass')).toBe(true)
  })

  it('still enforces negated tokens', () => {
    expect(tsMatches(['solo', '1girl'], '1girl -solo')).toBe(false)
    expect(tsMatches(['solo', '1girl'], '1girl')).toBe(true)
  })

  it('an empty query matches everything (market refresh, custom sources)', () => {
    expect(tsMatches(POSTS.none, '')).toBe(true)
    expect(tsMatches(POSTS.none, '   ')).toBe(true)
  })

  it('trusts untagged posts only when the caller opts in', () => {
    expect(tsMatches(POSTS.untagged, 'large_breasts')).toBe(false)
    expect(tsMatches(POSTS.untagged, 'large_breasts', { trustUntagged: true })).toBe(true)
  })

  it('trustUntagged cannot widen a strict AND query on a TAGGED post', () => {
    expect(tsMatches(POSTS.onlyFirst, 'large_breasts solo', { trustUntagged: true })).toBe(false)
  })

  it('caption queries stay unvalidated (caption hunts keep text overlays)', () => {
    expect(tsMatches(POSTS.none, 'caption')).toBe(true)
  })
})

describe('query parsing', () => {
  it('separates required from negated and normalizes', () => {
    expect(tsParse('large_breasts solo -rating_explicit -ai_generated')).toEqual({
      required: ['large_breasts', 'solo'],
      negated: ['rating_explicit', 'ai_generated'],
    })
  })

  it('normalizes hyphens and whitespace to underscores', () => {
    expect(tsNormalize(' Big-Ass ')).toBe('big_ass')
    expect(tsNormalize('big  ass')).toBe('big_ass')
  })
})

describe('renderer/main parity (matchRule.cjs vs matchRule.ts)', () => {
  const QUERIES = [
    '',
    'large_breasts',
    'large_breasts solo',
    'large_breasts solo -rating_explicit',
    'solo',
    'caption',
    'big-ass',
    'Large Breasts solo',
    'nonexistent_tag',
  ]
  const TAGS = Object.values(POSTS)

  it.each(QUERIES)('same verdict for query %j across every fixture', (q) => {
    for (const tags of TAGS) {
      expect(tsMatches(tags, q), `ts(${tags.join(',')}, ${q})`).toBe(cjs.matchesQuery(tags, q))
    }
  })

  it.each(QUERIES)('same verdict with trustUntagged for query %j', (q) => {
    for (const tags of TAGS) {
      expect(tsMatches(tags, q, { trustUntagged: true }), `ts untagged(${q})`).toBe(
        cjs.matchesQuery(tags, q, { trustUntagged: true }),
      )
    }
  })

  it('parses queries identically', () => {
    for (const q of QUERIES) expect(tsParse(q)).toEqual(cjs.parseQuery(q))
  })
})
