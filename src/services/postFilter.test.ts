import { describe, expect, it } from 'vitest'
import { allowOnly, isPostAllowed } from './postFilter'
import type { BooruPost } from '../game/types'

function post(overrides: Partial<BooruPost> = {}): BooruPost {
  return {
    id: '1',
    url: 'https://x/1.jpg',
    tags: ['gangbang', 'creampie', 'humans'],
    rating: 'e',
    ...overrides,
  }
}

describe('isPostAllowed (feed quality gate)', () => {
  it('keeps explicit human posts', () => {
    expect(isPostAllowed(post())).toBe(true)
  })

  it('rejects non-explicit ratings (SPEC §8)', () => {
    expect(isPostAllowed(post({ rating: 's' }))).toBe(false)
    expect(isPostAllowed(post({ rating: 'q' }))).toBe(false)
    expect(isPostAllowed(post({ rating: 'safe' }))).toBe(false)
  })

  it('rejects AI-generated slop', () => {
    expect(isPostAllowed(post({ tags: ['ai_generated', 'gangbang'] }))).toBe(false)
    expect(isPostAllowed(post({ tags: ['ai-generated'] }))).toBe(false)
  })

  it('rejects furry / anthro / scalie / feral', () => {
    for (const t of ['furry', 'anthro', 'scalie', 'feral', 'animal_ears', 'horse_cock']) {
      expect(isPostAllowed(post({ tags: [t] })), t).toBe(false)
    }
  })

  it('rejects monochrome / sketch / comic / 3d media', () => {
    for (const t of ['monochrome', 'greyscale', 'sketch', 'comic', '3d']) {
      expect(isPostAllowed(post({ tags: [t] })), t).toBe(false)
    }
  })

  it('allows motion urls (gif/mp4/webm) — kind is inferred at render', () => {
    expect(isPostAllowed(post({ url: 'https://x/1.webm' }))).toBe(true)
    expect(isPostAllowed(post({ url: 'https://x/1.gif' }))).toBe(true)
    expect(isPostAllowed(post({ url: 'https://x/1.mp4' }))).toBe(true)
    expect(isPostAllowed(post({ url: 'https://x/1.png' }))).toBe(true)
    expect(isPostAllowed(post({ url: 'https://x/1.swf' }))).toBe(false)
  })

  it('drops text-overlay tags unless it is a caption hunt', () => {
    const captioned = post({ tags: ['goon_caption', 'english_text', 'speech_bubble'] })
    expect(isPostAllowed(captioned)).toBe(false)
    expect(isPostAllowed(captioned, { captions: true })).toBe(true)
  })
})

describe('allowOnly', () => {
  it('filters in place, preserving order', () => {
    const posts = [
      post({ id: 'a' }),
      post({ id: 'b', tags: ['furry'] }),
      post({ id: 'c', rating: 's' }),
      post({ id: 'd' }),
    ]
    expect(allowOnly(posts).map((p) => p.id)).toEqual(['a', 'd'])
  })

  it('returns empty for all-blocked input', () => {
    expect(allowOnly([post({ tags: ['ai_generated'] })])).toEqual([])
  })
})
