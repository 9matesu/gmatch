import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../services/booru', () => ({
  fetchPosts: vi.fn(async () => ({ posts: [], source: null, ok: false, offline: true })),
  fetchPostsMulti: vi.fn(async () => ({ posts: [], source: null, ok: false, offline: true })),
  clearMirrorCooldowns: vi.fn(),
  clearSeenMemory: vi.fn(),
  matchesQuery: () => true,
}))
vi.mock('../services/keepsake', () => ({
  persistKeepsake: vi.fn(async () => ({ status: 'local', ref: 'c'.repeat(64) })),
}))
vi.mock('../services/vault', () => ({
  vaultUnpin: vi.fn(),
  vaultRemove: vi.fn(),
}))

const mem = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, v) },
  removeItem: (k: string) => { mem.delete(k) },
})

import { useGame } from './store'

beforeEach(() => {
  mem.clear()
  useGame.getState().resetGame()
})

/**
 * The BadgeShelf reads LIFETIME counters (`totalGallerySaved`,
 * `totalShardsEarned`), not the deletable gallery or the spendable shard
 * balance — so a deletion or a redemption can never take a badge back
 * (SPEC §10a). These pin the store's side of that contract.
 */
describe('lifetime counters never go down (a badge must not relock)', () => {
  it('saving a keepsake raises both gallery.length and totalGallerySaved', () => {
    const ok = useGame.getState().addGalleryImage('https://x/new.jpg')
    expect(ok).toBe(true)
    const s = useGame.getState()
    expect(s.gallery).toHaveLength(1)
    expect(s.totalGallerySaved).toBe(1)
  })

  it('deleting a keepsake lowers gallery.length but not totalGallerySaved', () => {
    useGame.setState({
      gallery: [{ id: 'g1', url: 'https://x/g1.jpg', tags: [], rarityBase: 2, clicks: 0, rarity: 'Common' }],
      totalGallerySaved: 1,
    })
    expect(useGame.getState().removeGalleryImage('g1')).toBe(true)
    const s = useGame.getState()
    expect(s.gallery).toHaveLength(0)
    expect(s.totalGallerySaved).toBe(1)
  })

  it('spending shards lowers the balance but not totalShardsEarned', () => {
    useGame.setState({ shards: 100, totalShardsEarned: 100 })
    expect(useGame.getState().spendShards(100)).toBe(true)
    const s = useGame.getState()
    expect(s.shards).toBe(0)
    expect(s.totalShardsEarned).toBe(100)
  })
})
