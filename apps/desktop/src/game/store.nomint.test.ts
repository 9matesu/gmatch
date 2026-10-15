import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../services/booru', () => ({
  fetchPosts: vi.fn(async () => ({ posts: [], source: null, ok: false, offline: true })),
  fetchPostsMulti: vi.fn(async () => ({ posts: [], source: null, ok: false, offline: true })),
  clearMirrorCooldowns: vi.fn(),
  clearSeenMemory: vi.fn(),
  matchesQuery: () => true,
}))

const mem = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, v) },
  removeItem: (k: string) => { mem.delete(k) },
})

const fetchCalls: string[] = []
vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
  fetchCalls.push(String(url))
  return { ok: false, status: 404, json: async () => ({}) }
}))

import { useGame } from './store'

beforeEach(() => {
  mem.clear()
  fetchCalls.length = 0
  useGame.getState().resetGame()
})

const mintCalls = () => fetchCalls.filter((u) => u.includes('/api/cards') || u.includes('/api/objects'))

describe('clicker KO never mints cards (Phase 2)', () => {
  it('1x1 KO saves a keepsake with zero card/object network traffic', () => {
    useGame.setState({
      current: { id: 'ko1', url: 'https://x/ko1.jpg', tags: ['a'] },
      imageReady: true,
      foeHp: 1,
      foeMaxHp: 1,
    })
    const before = useGame.getState().gallery.length
    useGame.getState().clickImage()
    const s = useGame.getState()
    expect(s.gallery.length).toBe(before + 1)
    expect(s.gallery[s.gallery.length - 1].url).toBe('https://x/ko1.jpg')
    expect(mintCalls()).toEqual([])
  })

  it('grid KO saves a keepsake with zero card/object network traffic', () => {
    const post = (id: string) => ({ id, url: `https://x/${id}.jpg`, tags: ['a'] })
    useGame.setState({
      queue: Array.from({ length: 12 }, (_, i) => post(`g${i}`)),
      grid: [],
    })
    useGame.getState().setViewMode('grid')
    const before = useGame.getState().gallery.length
    let killed = false
    for (let i = 0; i < 200 && !killed; i++) killed = useGame.getState().clickCell(0).killed
    expect(killed).toBe(true)
    expect(useGame.getState().gallery.length).toBeGreaterThan(before)
    expect(mintCalls()).toEqual([])
  })
})
