import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../services/booru', () => ({
  fetchPosts: vi.fn(async () => ({ posts: [], source: null, ok: false, offline: true })),
  fetchPostsMulti: vi.fn(async () => ({ posts: [], source: null, ok: false, offline: true })),
  clearMirrorCooldowns: vi.fn(),
  clearSeenMemory: vi.fn(),
  matchesQuery: () => true,
}))
vi.mock('../services/keepsake', () => ({
  persistKeepsake: vi.fn(async () => ({ status: 'local', hash: 'c'.repeat(64) })),
}))

const mem = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, v) },
  removeItem: (k: string) => { mem.delete(k) },
})

import { useGame } from './store'
import { persistKeepsake } from '../services/keepsake'

beforeEach(() => {
  mem.clear()
  useGame.getState().resetGame()
  vi.mocked(persistKeepsake).mockClear()
})

describe('clicker keep persists bytes before "saved" (Phase 5)', () => {
  it('KO kicks byte persistence and flips the keep to local on success', async () => {
    useGame.setState({
      current: { id: 'k1', url: 'https://x/k1.jpg', tags: ['a'] },
      imageReady: true,
      foeHp: 1,
      foeMaxHp: 1,
    })
    useGame.getState().clickImage()
    const keep = useGame.getState().gallery.at(-1)!
    expect(keep.localStatus).toBe('pending')
    await vi.waitFor(() => {
      const calls = vi.mocked(persistKeepsake).mock.calls as unknown[][]
      expect(calls.length).toBeGreaterThan(0)
      // Full payload: the keep's kind must ride along (video takes the
      // streaming route), not just the url.
      expect(calls[0]).toEqual(['https://x/k1.jpg', {}, undefined])
    })
    // Wait for the dynamic import + status reconciliation.
    await vi.waitFor(() => {
      expect(useGame.getState().gallery.find((g) => g.id === keep.id)?.localStatus).toBe('local')
    })
  })

  it('failed persistence marks the keep failed (source kept for retry)', async () => {
    vi.mocked(persistKeepsake).mockResolvedValueOnce({ status: 'failed', reason: 'fetch' })
    useGame.setState({
      current: { id: 'k2', url: 'https://x/k2.jpg', tags: ['a'] },
      imageReady: true,
      foeHp: 1,
      foeMaxHp: 1,
    })
    useGame.getState().clickImage()
    const keep = useGame.getState().gallery.at(-1)!
    await vi.waitFor(() => {
      const g = useGame.getState().gallery.find((x) => x.id === keep.id)
      expect(g?.localStatus).toBe('failed')
    })
    expect(useGame.getState().gallery.find((x) => x.id === keep.id)?.url).toBe('https://x/k2.jpg')
  })
})
