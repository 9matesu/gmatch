import { describe, expect, it } from 'vitest'
import { browseQuery, dedupePosts, provenanceLabel } from './tagBrowse'
import type { BooruPost } from './types'

const post = (id: string, tags: string[] = []): BooruPost => ({ id, url: `https://e.test/${id}.jpg`, tags })

describe('browseQuery', () => {
  it('AND-joins picked tags with a space', () => {
    expect(browseQuery(['wet_ass', 'blonde'])).toBe('wet_ass blonde')
  })

  it('drops blanks and trims so a stray empty pick cannot widen the query', () => {
    expect(browseQuery(['  blonde ', '', 'wet_ass'])).toBe('blonde wet_ass')
  })

  it('is empty for no picks (the caller treats empty as "do not fetch")', () => {
    expect(browseQuery([])).toBe('')
    expect(browseQuery(['', '  '])).toBe('')
  })
})

describe('dedupePosts', () => {
  it('keeps the first occurrence of each id (order is the provider relevance order)', () => {
    const out = dedupePosts([post('a'), post('b'), post('a')])
    expect(out.map((p) => p.id)).toEqual(['a', 'b'])
  })

  it('drops posts with no id rather than collapsing them all into one tile', () => {
    const out = dedupePosts([post(''), post('a'), { ...post('x'), id: undefined as unknown as string }])
    expect(out.map((p) => p.id)).toEqual(['a'])
  })

  it('is a no-op on an empty or already-unique list', () => {
    expect(dedupePosts([])).toEqual([])
    expect(dedupePosts([post('a'), post('b')]).map((p) => p.id)).toEqual(['a', 'b'])
  })
})

describe('provenanceLabel', () => {
  it('says offline plainly instead of showing a silent empty grid', () => {
    expect(provenanceLabel({ source: null, ok: false, offline: true }, 0)).toMatch(/offline/i)
  })

  it('names the source that answered', () => {
    expect(provenanceLabel({ source: 'tbib', ok: true }, 24)).toBe('24 from tbib')
  })

  it('distinguishes a cache hit from a live source', () => {
    expect(provenanceLabel({ source: 'tbib', ok: true, cached: true }, 10)).toBe('10 from cache')
  })

  it('separates "nothing new" (pool exhausted) from "no results"', () => {
    expect(provenanceLabel({ source: 'xbooru', ok: true, emptyFresh: true }, 0)).toMatch(/nothing new/i)
    expect(provenanceLabel({ source: 'xbooru', ok: true }, 0)).toMatch(/no results/i)
  })
})
