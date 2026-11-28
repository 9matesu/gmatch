import { describe, it, expect } from 'vitest'
import { displayMedia, hasMedia, isTextOnlyPost, readPostContent } from './postModel'
import type { FeedPost } from './GMatchFeed'

function row(over: Partial<FeedPost> = {}): FeedPost {
  return {
    id: 'p-1',
    author_id: 'a-1',
    author_name: 'Author',
    url: '',
    caption: '',
    created_at: '2026-01-01T00:00:00.000Z',
    like_count: 0,
    comment_count: 0,
    ...over,
  } as FeedPost
}

describe('post model · { text, media? }', () => {
  it('reads a text-only row as words with no media', () => {
    const content = readPostContent(row({ caption: 'only words', url: '' }))
    expect(content.text).toBe('only words')
    expect(content.media).toBeUndefined()
    expect(isTextOnlyPost(row({ caption: 'only words', url: '' }))).toBe(true)
  })

  it('reads the single url as media addressed by the post id', () => {
    const post = row({ url: '/api/objects/obj-1', mime_type: 'image/png' })
    const content = readPostContent(post)
    expect(content.media).toEqual([{ id: 'p-1', url: '/api/objects/obj-1', mimeType: 'image/png' }])
    expect(hasMedia(post)).toBe(true)
    expect(displayMedia(post, content)?.id).toBe('p-1')
  })

  it('prefers the session preview for a freshly published post', () => {
    const post = row({ url: '/api/objects/obj-1', localPreviewUrl: 'blob:preview' })
    expect(displayMedia(post, readPostContent(post))?.url).toBe('blob:preview')
  })

  it('keeps per-item mime types on a carousel and dedupes legacy mediaUrls', () => {
    const post = row({
      caption: 'carousel',
      media: [
        { id: 'm1', url: 'https://cdn.test/one', mime_type: 'image/jpeg' },
        { id: 'm2', url: 'https://cdn.test/two', mime_type: 'video/mp4' },
      ],
      mediaUrls: ['https://cdn.test/one', 'https://cdn.test/three'],
    })
    const content = readPostContent(post)
    expect(content.media?.map((m) => m.mimeType)).toEqual(['image/jpeg', 'video/mp4', undefined])
    expect(displayMedia(post, content)?.url).toBe('https://cdn.test/one')
  })

  it('pages at most 10 media items, no matter how many the row carries', () => {
    const post = row({
      caption: 'long carousel',
      media: Array.from({ length: 14 }, (_, i) => ({ id: `m${i}`, url: `https://cdn.test/${i}`, mime_type: 'image/jpeg' })),
    })
    const content = readPostContent(post)
    expect(content.media).toHaveLength(10)
    expect(content.media?.[9].url).toBe('https://cdn.test/9')
  })

  it('does not invent media for a blank row', () => {
    const content = readPostContent(null)
    expect(content).toEqual({ text: '', media: undefined })
    expect(hasMedia(row())).toBe(false)
  })
})
