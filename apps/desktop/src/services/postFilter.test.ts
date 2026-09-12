import { beforeEach, describe, expect, it } from 'vitest'
import { allowOnly, isPostAllowed } from './postFilter'
import type { BooruPost } from '../game/types'
import {
  __resetBlocklist,
  updateActiveBlocklist,
  setUserExcludes,
  __resetUserExcludes,
} from '../game/tagFilter'

function post(overrides: Partial<BooruPost> = {}): BooruPost {
  return {
    id: '1',
    url: 'https://x/1.jpg',
    tags: ['gangbang', 'creampie', 'humans'],
    rating: 'e',
    ...overrides,
  }
}

describe('isPostAllowed (single source of truth blocklist gate)', () => {
  beforeEach(() => {
    __resetBlocklist()
    __resetUserExcludes()
  })

  it('keeps explicit posts', () => {
    expect(isPostAllowed(post())).toBe(true)
  })

  it('rejects non-explicit ratings (SPEC §8)', () => {
    expect(isPostAllowed(post({ rating: 's' }))).toBe(false)
    expect(isPostAllowed(post({ rating: 'q' }))).toBe(false)
    expect(isPostAllowed(post({ rating: 'safe' }))).toBe(false)
  })

  it('rejects posts containing blocklisted tags', () => {
    expect(isPostAllowed(post({ tags: ['loli', 'gangbang'] }))).toBe(false)
    expect(isPostAllowed(post({ tags: ['rape'] }))).toBe(false)
    expect(isPostAllowed(post({ tags: ['bestiality'] }))).toBe(false)
  })

  it('dynamically allows or blocks based strictly on blocklist.json (no hard blocks in code)', () => {
    // By default, 'furry' or 'ai_generated' are not in default hard blocklist
    expect(isPostAllowed(post({ tags: ['furry'] }))).toBe(true)
    expect(isPostAllowed(post({ tags: ['ai_generated'] }))).toBe(true)

    // When the user/config adds them to the blocklist JSON, they are immediately blocked
    updateActiveBlocklist({ blocklist: ['furry', 'ai_generated'] })
    expect(isPostAllowed(post({ tags: ['furry'] }))).toBe(false)
    expect(isPostAllowed(post({ tags: ['ai_generated'] }))).toBe(false)

    // When removed from blocklist, they are allowed again
    updateActiveBlocklist({ blocklist: [] })
    expect(isPostAllowed(post({ tags: ['furry'] }))).toBe(true)
    expect(isPostAllowed(post({ tags: ['ai_generated'] }))).toBe(true)
  })

  it('honors user excludes if configured', () => {
    setUserExcludes(['tentacles'])
    expect(isPostAllowed(post({ tags: ['tentacles'] }))).toBe(false)
  })

  it('allows motion urls (gif/mp4/webm)', () => {
    expect(isPostAllowed(post({ url: 'https://x/1.webm' }))).toBe(true)
    expect(isPostAllowed(post({ url: 'https://x/1.gif' }))).toBe(true)
    expect(isPostAllowed(post({ url: 'https://x/1.mp4' }))).toBe(true)
    expect(isPostAllowed(post({ url: 'https://x/1.png' }))).toBe(true)
    expect(isPostAllowed(post({ url: 'https://x/1.swf' }))).toBe(false)
  })
})

describe('allowOnly', () => {
  beforeEach(() => {
    __resetBlocklist()
    __resetUserExcludes()
  })

  it('filters in place, preserving order', () => {
    updateActiveBlocklist({ blocklist: ['blocked_tag'] })
    const posts = [
      post({ id: 'a' }),
      post({ id: 'b', tags: ['blocked_tag'] }),
      post({ id: 'c', rating: 's' }),
      post({ id: 'd' }),
    ]
    expect(allowOnly(posts).map((p) => p.id)).toEqual(['a', 'd'])
  })

  it('returns empty for all-blocked input', () => {
    updateActiveBlocklist({ blocklist: ['blocked_term'] })
    expect(allowOnly([post({ tags: ['blocked_term'] })])).toEqual([])
  })
})
