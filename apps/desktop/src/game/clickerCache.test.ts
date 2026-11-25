// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../services/booru', () => ({
  fetchPosts: vi.fn(async () => ({ posts: [], source: null, ok: false, offline: true })),
  fetchPostsMulti: vi.fn(async () => ({ posts: [], source: null, ok: false, offline: true })),
  clearMirrorCooldowns: vi.fn(),
  clearSeenMemory: vi.fn(),
  matchesQuery: () => true,
}))

// The picture cache is the observable here: the store used to EVICT the
// picture it had just cached, so the cache never held anything and the BACK
// arrow re-downloaded the very picture the player had just seen.
const { evictImage } = vi.hoisted(() => ({ evictImage: vi.fn(async () => {}) }))
vi.mock('../services/imageCache', () => ({
  evictImage,
  clearFeedCache: vi.fn(async () => {}),
}))

const mem = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => {
    mem.set(k, v)
  },
  removeItem: (k: string) => {
    mem.delete(k)
  },
})

import { useGame } from './store'

beforeEach(() => {
  mem.clear()
  evictImage.mockClear()
  useGame.getState().resetGame()
})

describe('the clicker cache keeps the pictures you already saw', () => {
  it('does NOT evict the picture when you move on to the next foe', () => {
    useGame.setState({
      current: { id: 'c1', url: 'https://x/c1.jpg', tags: ['blonde'] },
      queue: [{ id: 'q1', url: 'https://x/q1.jpg', tags: ['blonde'] }],
    })
    useGame.getState().advanceFeed()
    // The old code evicted here: the picture was written to the cache and
    // deleted a moment later, so the cache never held anything.
    expect(evictImage).not.toHaveBeenCalled()
  })

  it('does NOT evict the skipped grid squares (the undo stack needs them)', () => {
    useGame.setState({
      viewMode: 'grid',
      grid: [
        { post: { id: 'g1', url: 'https://x/g1.jpg', tags: [] }, hp: 1, maxHp: 1, clicks: 0 },
        { post: { id: 'g2', url: 'https://x/g2.jpg', tags: [] }, hp: 1, maxHp: 1, clicks: 0 },
      ],
    })
    useGame.getState().skipGrid()
    expect(evictImage).not.toHaveBeenCalled()
  })

  it('still evicts a BROKEN grid square (no reward, no bytes worth keeping)', () => {
    useGame.setState({
      viewMode: 'grid',
      grid: [{ post: { id: 'g1', url: 'https://x/g1.jpg', tags: [] }, hp: 1, maxHp: 1, clicks: 0 }],
    })
    useGame.getState().dropCell(0)
    expect(evictImage).toHaveBeenCalledWith('https://x/g1.jpg')
  })

  it('the BACK arrow brings the picture back without evicting it', () => {
    useGame.setState({
      current: { id: 'c1', url: 'https://x/c1.jpg', tags: ['blonde'] },
      queue: [{ id: 'q1', url: 'https://x/q1.jpg', tags: ['blonde'] }],
    })
    useGame.getState().advanceFeed()
    expect(useGame.getState().current?.id).toBe('q1')
    expect(useGame.getState().past.map((p) => p.id)).toEqual(['c1'])
    // Back: the picture comes back — and its bytes were never thrown away.
    expect(useGame.getState().goBack()).toBe(true)
    expect(useGame.getState().current?.id).toBe('c1')
    expect(evictImage).not.toHaveBeenCalled()
  })
})

describe('addGalleryImage — save a cached picture to the gallery', () => {
  it('adds the picture to the gallery and persists its bytes', () => {
    const before = useGame.getState().gallery.length
    const ok = useGame.getState().addGalleryImage('https://x/c1.jpg', ['blonde'])
    expect(ok).toBe(true)
    const g = useGame.getState().gallery
    expect(g.length).toBe(before + 1)
    expect(g[g.length - 1].url).toBe('https://x/c1.jpg')
    expect(g[g.length - 1].tags).toEqual(['blonde'])
    expect(g[g.length - 1].saveState).toBe('downloading')
  })

  it('refuses a picture that is already in the gallery', () => {
    useGame.getState().addGalleryImage('https://x/c1.jpg')
    expect(useGame.getState().addGalleryImage('https://x/c1.jpg')).toBe(false)
    expect(useGame.getState().gallery.filter((g) => g.url === 'https://x/c1.jpg').length).toBe(1)
  })

  it('refuses an empty url', () => {
    expect(useGame.getState().addGalleryImage('')).toBe(false)
  })

  it('takes the tags from the clicker history when the caller has none', () => {
    useGame.setState({
      past: [{ id: 'c1', url: 'https://x/c1.jpg', tags: ['blonde', 'tall'] }],
    })
    useGame.getState().addGalleryImage('https://x/c1.jpg')
    const g = useGame.getState().gallery
    expect(g[g.length - 1].tags).toEqual(['blonde', 'tall'])
  })
})
