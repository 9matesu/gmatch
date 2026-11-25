// @vitest-environment jsdom
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
  setItem: (k: string, v: string) => {
    mem.set(k, v)
  },
  removeItem: (k: string) => {
    mem.delete(k)
  },
})

import { MAX_USER_EXCLUDES, useGame } from './store'
import { __resetBlocklist, __resetUserExcludes, getActiveBlocklistData } from './tagFilter'

/**
 * The MAIN PROCESS owns the user's blocklist.json. It merges the term into
 * the authoritative list and hands the result back — the renderer never sends
 * its own (possibly stale) full list.
 */
const blocklistBan = vi.fn(async (terms: string[]) => ({
  ok: true,
  data: {
    blocklist: [...getActiveBlocklistData().blocklist, ...terms],
    suggested: [],
    noise: [],
  },
  added: terms,
}))

beforeEach(() => {
  mem.clear()
  blocklistBan.mockClear()
  ;(window as unknown as { gmatch: unknown }).gmatch = { blocklistBan }
  __resetBlocklist()
  __resetUserExcludes()
  useGame.getState().resetGame()
})

describe('banTag — a ban is DURABLE', () => {
  it('lands the term in the user blocklist.json (main owns the write)', async () => {
    const ok = await useGame.getState().banTag('yaoi')
    expect(ok).toBe(true)
    expect(blocklistBan).toHaveBeenCalledWith(['yaoi'])
    expect(getActiveBlocklistData().blocklist).toContain('yaoi')
  })

  it('bans even when the term is ALREADY in the runtime exclude list', async () => {
    useGame.setState({ userExcludes: ['yaoi'] })
    // The old code early-returned here: addUserExclude refuses a duplicate,
    // so the ban never reached the blocklist and the tag came back.
    expect(await useGame.getState().banTag('yaoi')).toBe(true)
    expect(getActiveBlocklistData().blocklist).toContain('yaoi')
  })

  it('bans even when the 100-term runtime exclude list is full', async () => {
    useGame.setState({
      userExcludes: Array.from({ length: MAX_USER_EXCLUDES }, (_, i) => `t${i}`),
    })
    expect(await useGame.getState().banTag('yaoi')).toBe(true)
    expect(getActiveBlocklistData().blocklist).toContain('yaoi')
  })

  it('reports a failed durable write instead of swallowing it', async () => {
    blocklistBan.mockResolvedValueOnce({ ok: false, error: 'disk full' } as never)
    const ok = await useGame.getState().banTag('yaoi')
    expect(ok).toBe(false)
    expect(getActiveBlocklistData().blocklist).not.toContain('yaoi')
    expect(useGame.getState().toasts.map((t) => t.msg).join(' ')).toMatch(/yaoi/)
  })
})

describe('banTag — the feed reacts to the ban', () => {
  it('drops queued foes that carry the banned tag', async () => {
    useGame.setState({
      current: { id: 'c1', url: 'https://x/c1.jpg', tags: ['blonde'] },
      queue: [
        { id: 'q1', url: 'https://x/q1.jpg', tags: ['yaoi'] },
        { id: 'q2', url: 'https://x/q2.jpg', tags: ['blonde'] },
      ],
      grid: [],
    })
    await useGame.getState().banTag('yaoi')
    expect(useGame.getState().queue.map((p) => p.id)).toEqual(['q2'])
  })

  it('drops grid squares that carry the banned tag', async () => {
    useGame.setState({
      grid: [
        { post: { id: 'g1', url: 'https://x/g1.jpg', tags: ['yaoi'] }, hp: 1, maxHp: 1, clicks: 0 },
        { post: { id: 'g2', url: 'https://x/g2.jpg', tags: ['blonde'] }, hp: 1, maxHp: 1, clicks: 0 },
      ],
    })
    await useGame.getState().banTag('yaoi')
    expect(useGame.getState().grid.map((c) => c.post.id)).toEqual(['g2'])
  })
})

describe('claimDropAntiTag — the tray only advances on a landed ban', () => {
  it('bans durably and removes the tag from the tray', async () => {
    useGame.setState({
      pendingDrops: [{ id: 'd1', foeTitle: 'x', tags: ['yaoi', 'blonde'], timestamp: Date.now() }],
    })
    expect(await useGame.getState().claimDropAntiTag('d1', 'yaoi')).toBe(true)
    expect(getActiveBlocklistData().blocklist).toContain('yaoi')
    expect(useGame.getState().pendingDrops[0].tags).toEqual(['blonde'])
    expect(useGame.getState().userExcludes).toContain('yaoi')
  })

  it('keeps the tag in the tray when the durable write failed', async () => {
    blocklistBan.mockResolvedValueOnce({ ok: false, error: 'nope' } as never)
    useGame.setState({
      pendingDrops: [{ id: 'd1', foeTitle: 'x', tags: ['yaoi'], timestamp: Date.now() }],
    })
    expect(await useGame.getState().claimDropAntiTag('d1', 'yaoi')).toBe(false)
    expect(useGame.getState().pendingDrops[0].tags).toContain('yaoi')
  })
})
