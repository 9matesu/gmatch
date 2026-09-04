import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../services/booru', () => ({
  fetchPosts: vi.fn(async () => ({ posts: [], source: null, ok: false, offline: true })),
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

import { defaultSave, serialize, SAVE_KEY } from './save'
import { setupTag } from './tags'
import { getUserExcludes } from './tagFilter'
import { fetchPosts } from '../services/booru'
import type { BooruResponse } from '../services/booru'
import { useGame, HISTORY_CAP, GRID_SIZE, shufflePosts } from './store'

beforeEach(() => {
  mem.clear()
  useGame.getState().resetGame()
})

describe('clickImage', () => {
  it('every 25th click is a CRIT and banks g$/XP', () => {
    const g = useGame.getState()
    for (let i = 0; i < 25; i++) g.clickImage()
    const s = useGame.getState()
    expect(s.clicks).toBe(25)
    expect(s.crits).toBe(1)
    expect(s.gc).toBeGreaterThan(30)
    expect(s.totalEarnedGc).toBeCloseTo(s.gc, 6)
    expect(s.xp).toBe(29) // 24 normal + 5 for the crit
    expect(s.achievements).toContain('first_click')
  })

  it('reports crit on the 25th click', () => {
    for (let i = 0; i < 24; i++) expect(useGame.getState().clickImage().crit).toBe(false)
    expect(useGame.getState().clickImage().crit).toBe(true)
  })
})

describe('buyTag', () => {
  it('levels a tag and deducts cost', () => {
    useGame.setState({ gc: 10_000, tags: [setupTag('gangbang')] })
    const before = useGame.getState().gc
    expect(useGame.getState().buyTag('gangbang')).toBe(true)
    const t = useGame.getState().tags.find((x) => x.name === 'gangbang')
    expect(t?.level).toBe(2)
    expect(useGame.getState().gc).toBeLessThan(before)
    expect(useGame.getState().achievements).toContain('first_tag')
  })

  it('refuses when broke', () => {
    useGame.setState({
      gc: 0,
      tags: [{ name: 'gangbang', level: 0, base: 100, income: 5, weight: 2 }],
    })
    expect(useGame.getState().buyTag('gangbang')).toBe(false)
    expect(useGame.getState().tags.find((x) => x.name === 'gangbang')?.level).toBe(0)
  })
})

describe('refreshTagMarket', () => {
  it('keeps the market empty with no owned tags (no hardcoded seeds)', async () => {
    useGame.setState({ tags: [] })
    await useGame.getState().refreshTagMarket()
    expect(useGame.getState().tags).toEqual([])
  })
})

describe('fetchFeed tag rotation', () => {
  const mocked = vi.mocked(fetchPosts)
  const offline: BooruResponse = { posts: [], source: null, ok: false, offline: true }

  it('fetches ONE tag at a time, rotating the pool instead of stacking', async () => {
    mocked.mockClear()
    const post = (id: string) => ({ id, url: `https://x/${id}.jpg`, tags: ['gangbang'] })
    mocked.mockResolvedValue({ posts: [post('r1')], source: 't', ok: true })
    useGame.setState({
      tags: [
        { name: 'aaa', level: 2, base: 10, income: 1, weight: 1 },
        { name: 'bbb', level: 1, base: 10, income: 1, weight: 1 },
      ],
      feedCursor: 0,
    })
    await useGame.getState().fetchFeed()
    const first = mocked.mock.calls[0][0].tags
    mocked.mockClear()
    mocked.mockResolvedValue({ posts: [post('r2')], source: 't', ok: true })
    await useGame.getState().fetchFeed()
    const second = mocked.mock.calls[0][0].tags
    mocked.mockResolvedValue(offline)
    expect(first).toBe('aaa')
    expect(second).toBe('bbb')
    expect(first.split(/\s+/)).toHaveLength(1)
    expect(useGame.getState().current?.id).toBe('r2')
  })
})

describe('popCap', () => {
  it('charges g$, activates the buff, records usage', () => {
    useGame.setState({ gc: 200 })
    expect(useGame.getState().popCap('blue')).toBe(true)
    const s = useGame.getState()
    expect(s.gc).toBe(50)
    expect(s.caps).toHaveLength(1)
    expect(s.capsUsed).toContain('blue')
  })

  it('refuses when unaffordable', () => {
    useGame.setState({ gc: 10 })
    expect(useGame.getState().popCap('melt')).toBe(false)
    expect(useGame.getState().caps).toHaveLength(0)
  })
})

describe('feed battle', () => {
  const foe = (id: string) => ({ id, url: `https://x/${id}.jpg`, tags: ['gangbang'] })

  it('drains foe HP and sends the KO to the gallery with a bonus', () => {
    useGame.setState({
      current: foe('b1'),
      queue: [foe('b2')],
      foeHp: 8,
      foeMaxHp: 8,
      foeClicks: 0,
      defeated: 0,
      gc: 0,
    })
    let killed = false
    for (let i = 0; i < 20 && !killed; i++) killed = useGame.getState().clickImage().killed
    expect(killed).toBe(true)
    const s = useGame.getState()
    expect(s.gallery).toHaveLength(1)
    expect(s.defeated).toBe(1)
    expect(s.gc).toBeGreaterThan(0) // click g$ + kill bonus
    expect(s.current?.id).toBe('b2') // next foe steps up at full scaled HP
    expect(s.foeMaxHp).toBeGreaterThan(8)
    expect(s.foeHp).toBe(s.foeMaxHp)
  })

  it('KO auto-discovers the foe tags as buyable market offers', () => {
    useGame.setState({
      current: { id: 'd1', url: 'https://x/d1.jpg', tags: ['gangbang', 'huge_breasts'] },
      queue: [],
      foeHp: 8,
      foeMaxHp: 8,
      foeClicks: 0,
      defeated: 0,
      gc: 0,
      tags: [{ name: 'gangbang', level: 1, base: 10, income: 1, weight: 1, selected: true }],
    })
    let killed = false
    for (let i = 0; i < 20 && !killed; i++) killed = useGame.getState().clickImage().killed
    expect(killed).toBe(true)
    const names = useGame.getState().tags.map((t) => t.name)
    expect(names).toContain('huge_breasts')
    expect(names).toContain('gangbang')
  })

  it('toggleTag flips feed selection on owned tags only', () => {
    useGame.setState({
      tags: [
        { name: 'aaa', level: 2, base: 10, income: 1, weight: 1, selected: true },
        { name: 'bbb', level: 0, base: 10, income: 1, weight: 1, selected: false },
      ],
    })
    expect(useGame.getState().toggleTag('aaa')).toBe(true)
    expect(useGame.getState().tags.find((t) => t.name === 'aaa')!.selected).toBe(false)
    expect(useGame.getState().toggleTag('bbb')).toBe(false)
    expect(useGame.getState().toggleTag('nope')).toBe(false)
  })

  it('skip then back restores the skipped foe at full HP, forward intact', () => {
    useGame.setState({
      current: foe('k1'),
      queue: [foe('k2')],
      past: [],
      foeHp: 8,
      foeMaxHp: 8,
      foeClicks: 0,
      defeated: 0,
      gallery: [],
    })
    useGame.getState().advanceFeed()
    expect(useGame.getState().current?.id).toBe('k2')
    expect(useGame.getState().goBack()).toBe(true)
    const s = useGame.getState()
    expect(s.current?.id).toBe('k1')
    expect(s.foeHp).toBe(s.foeMaxHp) // fresh foe, full scaled HP
    expect(s.queue.map((p) => p.id)).toEqual(['k2']) // skip again to go forward
    useGame.getState().advanceFeed()
    expect(useGame.getState().current?.id).toBe('k2')
  })

  it('goBack returns false with empty history', () => {
    useGame.setState({ current: foe('e1'), queue: [], past: [] })
    expect(useGame.getState().goBack()).toBe(false)
    expect(useGame.getState().current?.id).toBe('e1')
  })

  it('back after a KO shows the beaten foe with no battle', () => {
    useGame.setState({
      current: foe('b1'),
      queue: [foe('b2')],
      past: [],
      foeHp: 8,
      foeMaxHp: 8,
      foeClicks: 0,
      defeated: 0,
      gc: 0,
      gallery: [],
    })
    let killed = false
    for (let i = 0; i < 20 && !killed; i++) killed = useGame.getState().clickImage().killed
    expect(killed).toBe(true)
    expect(useGame.getState().current?.id).toBe('b2')
    expect(useGame.getState().goBack()).toBe(true)
    const s = useGame.getState()
    expect(s.current?.id).toBe('b1')
    expect(s.foeMaxHp).toBe(0) // beaten — no battle, like a re-feature
  })

  it('history never grows past HISTORY_CAP', () => {
    const past = Array.from({ length: HISTORY_CAP }, (_, i) => foe(`h${i}`))
    useGame.setState({
      current: foe('cap1'),
      queue: [foe('cap2')],
      past,
      foeHp: 8,
      foeMaxHp: 8,
      foeClicks: 0,
      defeated: 0,
      gallery: [],
    })
    useGame.getState().advanceFeed()
    const s = useGame.getState()
    expect(s.past).toHaveLength(HISTORY_CAP)
    expect(s.past[s.past.length - 1].id).toBe('cap1')
  })

  it('skipping pays nothing and keeps the KO count', () => {
    useGame.setState({
      current: foe('s1'),
      queue: [foe('s2')],
      foeHp: 8,
      foeMaxHp: 8,
      foeClicks: 0,
      defeated: 3,
      gc: 0,
    })
    useGame.getState().advanceFeed()
    const s = useGame.getState()
    expect(s.gallery).toHaveLength(0)
    expect(s.defeated).toBe(3)
    expect(s.gc).toBe(0)
    expect(s.current?.id).toBe('s2')
  })

  it('featured gallery pieces have no battle — clicks just pay g$', () => {
    useGame.setState({
      gc: 100_000,
      current: foe('42'),
      queue: [],
      foeHp: 8,
      foeMaxHp: 8,
      foeClicks: 0,
      defeated: 0,
    })
    // Drain it first so it joins the gallery, then re-feature it.
    for (let i = 0; i < 200 && useGame.getState().gallery.length === 0; i++) {
      useGame.getState().clickImage()
    }
    const id = useGame.getState().gallery[0].id
    useGame.getState().featureImage(id)
    const before = useGame.getState()
    expect(before.foeMaxHp).toBe(0)
    const res = useGame.getState().clickImage()
    expect(res.killed).toBe(false)
    expect(useGame.getState().gallery).toHaveLength(1)
  })

  it('does nothing battle-wise without a current image', () => {
    useGame.setState({ gc: 0, current: null })
    const res = useGame.getState().clickImage()
    expect(res.killed).toBe(false)
    expect(useGame.getState().gallery).toHaveLength(0)
  })
})

describe('background backdrop', () => {
  it('sets and clears the gallery backdrop url', () => {
    expect(useGame.getState().backgroundUrl).toBeNull()
    useGame.getState().setBackground('https://x/bg.jpg')
    expect(useGame.getState().backgroundUrl).toBe('https://x/bg.jpg')
    useGame.getState().setBackground(null)
    expect(useGame.getState().backgroundUrl).toBeNull()
  })
})

describe('shufflePosts (never sequential)', () => {
  it('preserves every post, returns a new array', () => {
    const posts = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const out = shufflePosts(posts)
    expect(out).not.toBe(posts)
    expect(out.map((p) => p.id).sort()).toEqual(['a', 'b', 'c'])
    expect(posts.map((p) => p.id)).toEqual(['a', 'b', 'c'])
  })

  it('actually reorders across rounds', () => {
    const posts = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}` }))
    const same = posts.map((p) => p.id).join(',')
    const varied = Array.from({ length: 20 }, () => shufflePosts(posts).map((p) => p.id).join(','))
    expect(varied.some((v) => v !== same)).toBe(true)
  })
})

describe('tick', () => {
  it('pays passive g$/s from owned tags', () => {
    useGame.setState({
      gc: 0,
      tags: [{ name: 'wet', level: 2, base: 10, income: 5, weight: 2 }],
    })
    useGame.getState().tick(1000)
    const s = useGame.getState()
    expect(s.gc).toBeGreaterThanOrEqual(10)
    expect(s.totalEarnedGc).toBeGreaterThanOrEqual(10)
  })

  it('legacy timed caps still prune, permanent pops persist', () => {
    useGame.setState({ caps: [{ capId: 'blue', expiresAt: Date.now() - 1 }] })
    useGame.getState().tick(1000)
    expect(useGame.getState().caps).toHaveLength(0)
    useGame.setState({ caps: [{ capId: 'blue', expiresAt: Number.POSITIVE_INFINITY }] })
    useGame.getState().tick(1000)
    expect(useGame.getState().caps).toHaveLength(1)
  })
})

describe('brainmelt', () => {
  it('resets the run, keeps gallery, grants shards', () => {
    useGame.setState({
      gc: 500,
      xp: 1600,
      totalEarnedGc: 4_000_000,
      tags: [{ name: 'wet', level: 3, base: 10, income: 1, weight: 1 }],
      caps: [{ capId: 'blue', expiresAt: Date.now() + 60_000 }],
      gallery: [{ id: 'g1', url: 'u', tags: ['a'], rarityBase: 10, clicks: 0, rarity: 'Gold' }],
    })
    expect(useGame.getState().brainmelt()).toBe(true)
    const s = useGame.getState()
    expect(s.gc).toBe(0)
    expect(s.xp).toBe(0)
    expect(s.totalEarnedGc).toBe(0)
    expect(s.shards).toBe(2)
    expect(s.prestigeCount).toBe(1)
    expect(s.gallery).toHaveLength(1)
    expect(s.caps).toHaveLength(0)
    expect(s.tags.every((t) => t.level === 0)).toBe(true)
    expect(s.achievements).toContain('first_brainmelt')
  })

  it('blocked below tier 5', () => {
    useGame.setState({ xp: 0, totalEarnedGc: 5_000_000 })
    expect(useGame.getState().brainmelt()).toBe(false)
    expect(useGame.getState().shards).toBe(0)
  })
})

describe('save / load / offline earnings', () => {
  it('round-trips through localStorage', () => {
    useGame.setState({ gc: 777, ageVerified: true })
    useGame.getState().save()
    useGame.getState().resetGame()
    useGame.getState().load()
    expect(useGame.getState().gc).toBe(777)
    expect(useGame.getState().ageVerified).toBe(true)
  })

  it('offers offline earnings on load and collects them', () => {
    const past = Date.now() - 60_000
    mem.set(
      SAVE_KEY,
      serialize({
        ...defaultSave(past),
        gc: 123,
        ageAccepted: true,
        tags: [{ name: 'wet', level: 1, base: 10, income: 5, weight: 1 }],
        lastSeenAt: past,
      }),
    )
    useGame.getState().load()
    const s = useGame.getState()
    expect(s.gc).toBe(123)
    expect(s.offlineGain).toBeCloseTo(150, 0) // 60s * 5 g$/s * 50%
    s.collectOffline()
    expect(useGame.getState().gc).toBeCloseTo(273, 0)
    expect(useGame.getState().collectedOfflineEarnings).toBe(true)
    expect(useGame.getState().achievements).toContain('offline_slut')
  })

  it('load is idempotent (StrictMode-safe)', () => {
    mem.set(SAVE_KEY, serialize({ ...defaultSave(), gc: 42, ageAccepted: true }))
    useGame.getState().load()
    useGame.getState().load()
    expect(useGame.getState().gc).toBe(42)
  })
})

describe('addCustomTag', () => {
  const mocked = vi.mocked(fetchPosts)
  const post = { id: 'c1', url: 'https://x/c1.mp4', tags: ['bimbo'], rating: 'e', kind: 'video' as const }

  it('rejects blocked tags without probing the network', async () => {
    mocked.mockClear()
    const r = await useGame.getState().addCustomTag('loli')
    expect(r.added).toBe(false)
    expect(mocked).not.toHaveBeenCalled()
  })

  it('rejects tags with no live results', async () => {
    mocked.mockClear()
    mocked.mockResolvedValue({ posts: [], source: null, ok: false, offline: true })
    const r = await useGame.getState().addCustomTag('zz_no_such_tag')
    expect(r.added).toBe(false)
    expect(r.message).toContain('No live results')
  })

  it('adds a probed tag owned + selected, dupes are refused', async () => {
    mocked.mockClear()
    mocked.mockResolvedValue({ posts: [post], source: 'redgifs', ok: true })
    const r = await useGame.getState().addCustomTag('Bimbo')
    expect(r.added).toBe(true)
    const tag = useGame.getState().tags.find((t) => t.name === 'bimbo')
    expect(tag?.level).toBe(1)
    expect(tag?.selected).toBe(true)
    const dupe = await useGame.getState().addCustomTag('bimbo')
    expect(dupe.added).toBe(false)
  })
})

describe('shufflePosts (never sequential)', () => {
  it('preserves every post, returns a new array', () => {
    const posts = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const out = shufflePosts(posts)
    expect(out).not.toBe(posts)
    expect(out.map((p) => p.id).sort()).toEqual(['a', 'b', 'c'])
    expect(posts.map((p) => p.id)).toEqual(['a', 'b', 'c'])
  })

  it('actually reorders across rounds', () => {
    const posts = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}` }))
    const same = posts.map((p) => p.id).join(',')
    const varied = Array.from({ length: 20 }, () => shufflePosts(posts).map((p) => p.id).join(','))
    expect(varied.some((v) => v !== same)).toBe(true)
  })
})

describe('3x3 grid mode', () => {
  const mocked = vi.mocked(fetchPosts)
  const offline: BooruResponse = { posts: [], source: null, ok: false, offline: true }
  const post = (id: string) => ({ id, url: `https://x/${id}.jpg`, tags: ['gangbang'] })
  const dozen = () => Array.from({ length: 12 }, (_, i) => post(`g${i}`))

  it('setViewMode fills 9 squares from the queue with full HP', () => {
    mocked.mockResolvedValue(offline)
    useGame.setState({ queue: dozen(), grid: [] })
    useGame.getState().setViewMode('grid')
    const s = useGame.getState()
    expect(s.viewMode).toBe('grid')
    expect(s.grid).toHaveLength(GRID_SIZE)
    expect(s.queue).toHaveLength(3)
    for (const c of s.grid) expect(c.hp).toBe(c.maxHp)
  })

  it('clickCell damages a square and banks g$', () => {
    useGame.setState({ queue: dozen(), grid: [] })
    useGame.getState().setViewMode('grid')
    const before = useGame.getState().grid[0].hp
    const r = useGame.getState().clickCell(0)
    expect(r.killed).toBe(false)
    expect(r.gain).toBeGreaterThan(0)
    expect(useGame.getState().grid[0].hp).toBeLessThan(before)
  })

  it('clickCell KO keeps the gallery, counts the KO, slides a fresh foe in', () => {
    useGame.setState({ queue: dozen(), grid: [] })
    useGame.getState().setViewMode('grid')
    let killed = false
    for (let i = 0; i < 50 && !killed; i++) killed = useGame.getState().clickCell(0).killed
    expect(killed).toBe(true)
    const s = useGame.getState()
    expect(s.gallery).toHaveLength(1)
    expect(s.defeated).toBe(1)
    expect(s.grid).toHaveLength(GRID_SIZE)
  })

  it('skipGrid swaps the board for a fresh one and stacks history; undoGrid restores it', () => {
    mocked.mockResolvedValue({ posts: dozen(), source: 'x', ok: false } as unknown as BooruResponse)
    useGame.setState({ queue: dozen(), grid: [], gridPast: [] })
    useGame.getState().setViewMode('grid')
    const first = useGame.getState().grid.map((g) => g.post.id)
    useGame.getState().skipGrid()
    const s = useGame.getState()
    expect(s.gridPast).toHaveLength(1)
    // fresh squares came from the queue head (different ids than the first board)
    expect(s.grid.map((g) => g.post.id)).not.toEqual(first)
    expect(useGame.getState().undoGrid()).toBe(true)
    expect(useGame.getState().grid.map((g) => g.post.id)).toEqual(first)
    expect(useGame.getState().gridPast).toHaveLength(0)
    expect(useGame.getState().undoGrid()).toBe(false)
  })

  it('skipGrid is a no-op outside grid mode / on an empty board', () => {
    useGame.setState({ viewMode: 'single', grid: [], gridPast: [] })
    useGame.getState().skipGrid()
    expect(useGame.getState().gridPast).toHaveLength(0)
  })

  it('clickCell on an empty square is a dead click', () => {
    useGame.setState({ grid: [], queue: [] })
    const clicks = useGame.getState().clicks
    const r = useGame.getState().clickCell(4)
    expect(r).toEqual({ gain: 0, crit: false, killed: false, heat: 1 })
    expect(useGame.getState().clicks).toBe(clicks)
  })

  it('dropCell swaps a broken square with no reward', () => {
    useGame.setState({ queue: dozen(), grid: [] })
    useGame.getState().setViewMode('grid')
    const gc = useGame.getState().gc
    const firstId = useGame.getState().grid[0].post.id
    useGame.getState().dropCell(0)
    const s = useGame.getState()
    expect(s.gc).toBe(gc)
    expect(s.defeated).toBe(0)
    expect(s.grid).toHaveLength(GRID_SIZE)
    expect(s.grid.some((c) => c.post.id === firstId)).toBe(false)
  })

  it('fetchFeed in grid mode appends to the queue and tops up squares', async () => {
    mocked.mockClear()
    mocked.mockResolvedValue({ posts: [post('n1'), post('n2')], source: 't', ok: true })
    useGame.setState({
      tags: [{ name: 'aaa', level: 1, base: 10, income: 1, weight: 1 }],
      feedCursor: 0,
      viewMode: 'grid',
      grid: [],
      queue: [],
    })
    await useGame.getState().fetchFeed()
    const s = useGame.getState()
    expect(s.grid).toHaveLength(2)
    expect(s.current).toBeNull()
  })

  it('tick auto-clicks batter the first square in grid mode', () => {
    useGame.setState({ queue: dozen(), grid: [] })
    useGame.getState().setViewMode('grid')
    // Braceface (filter cap): permanent 1 auto-click/s.
    useGame.setState({ caps: [{ capId: 'filter', expiresAt: Number.POSITIVE_INFINITY }] })
    const before = useGame.getState().grid[0].hp
    useGame.getState().tick(1000)
    expect(useGame.getState().grid[0].hp).toBeLessThan(before)
  })
})

describe('setup + user excludes (no hardcoded tags)', () => {
  it('completeSetup commits 4 picks owned+selected and syncs excludes', () => {
    const r = useGame
      .getState()
      .completeSetup(['bimbo', 'creampie', 'ahegao', 'doggystyle'], ['feet'])
    expect(r.ok).toBe(true)
    const s = useGame.getState()
    expect(s.setupComplete).toBe(true)
    expect(s.tags.map((t) => t.name)).toEqual(['bimbo', 'creampie', 'ahegao', 'doggystyle'])
    expect(s.tags.every((t) => t.level === 1 && t.selected === true)).toBe(true)
    expect(s.userExcludes).toEqual(['feet'])
    expect(getUserExcludes()).toEqual(['feet'])
  })

  it('completeSetup rejects wrong counts, dupes and blocked tags', () => {
    expect(useGame.getState().completeSetup(['bimbo', 'creampie'], []).ok).toBe(false)
    expect(
      useGame.getState().completeSetup(['bimbo', 'bimbo', 'creampie', 'ahegao'], []).ok,
    ).toBe(false)
    expect(
      useGame.getState().completeSetup(['bimbo', 'creampie', 'ahegao', 'loli'], []).ok,
    ).toBe(false)
    expect(useGame.getState().setupComplete).toBe(false)
  })

  it('add/removeUserExclude round-trips, dupes refused', () => {
    expect(useGame.getState().addUserExclude(' Feet ')).toBe(true)
    expect(useGame.getState().addUserExclude('feet')).toBe(false)
    expect(useGame.getState().userExcludes).toEqual(['feet'])
    expect(useGame.getState().removeUserExclude('FEET')).toBe(true)
    expect(useGame.getState().removeUserExclude('feet')).toBe(false)
    expect(useGame.getState().userExcludes).toEqual([])
  })
})
