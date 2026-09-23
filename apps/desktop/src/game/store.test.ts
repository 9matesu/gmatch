import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../services/booru', () => ({
  fetchPosts: vi.fn(async () => ({ posts: [], source: null, ok: false, offline: true })),
  fetchPostsMulti: vi.fn(async () => ({ posts: [], source: null, ok: false, offline: true })),
  clearMirrorCooldowns: vi.fn(),
  clearSeenMemory: vi.fn(),
  // Faithful mirror of the real token matcher (single/multi-token intents).
  matchesQuery: (post: { tags: string[] }, query?: string) => {
    if (!query || post.tags.length === 0) return true
    const toks = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const tags = post.tags.map((t) => t.toLowerCase())
    return toks.some((tok) => tags.some((t) => t === tok || t.includes(tok) || tok.includes(t)))
  },
}))

import { clearSeenMemory } from '../services/booru'

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
import { fetchPosts, fetchPostsMulti } from '../services/booru'
import type { BooruResponse } from '../services/booru'
import { useGame, HISTORY_CAP, GRID_SIZE, gridSizeForMode, shufflePosts, __resetFeedRetryForTests, lastFeedRetryMs } from './store'

beforeEach(() => {
  mem.clear()
  useGame.getState().resetGame()
  __resetFeedRetryForTests()
})

describe('clickImage', () => {
  const stageReady = () => useGame.setState({
    current: { id: 't1', url: 'https://x/t1.jpg', tags: [] },
    imageReady: true,
    foeHp: 0,
    foeMaxHp: 0,
  })
  it('every 25th click is a CRIT and banks pts/XP', () => {
    stageReady()
    const g = useGame.getState()
    for (let i = 0; i < 25; i++) g.clickImage()
    const s = useGame.getState()
    expect(s.clicks).toBe(25)
    expect(s.crits).toBe(1)
    expect(s.points).toBeGreaterThan(30)
    expect(s.totalEarned).toBeCloseTo(s.points, 6)
    expect(s.xp).toBe(29) // 24 normal + 5 for the crit
    expect(s.achievements).toContain('first_click')
  })

  it('reports crit on the 25th click', () => {
    stageReady()
    for (let i = 0; i < 24; i++) expect(useGame.getState().clickImage().crit).toBe(false)
    expect(useGame.getState().clickImage().crit).toBe(true)
  })

  it('pays nothing while the stage image is not loaded (no blind clicks)', () => {
    useGame.setState({
      current: { id: 't2', url: 'https://x/t2.jpg', tags: [] },
      imageReady: false,
      points: 0,
    })
    expect(useGame.getState().clickImage().gain).toBe(0)
    expect(useGame.getState().points).toBe(0)
    expect(useGame.getState().clicks).toBe(0)
  })

  it('pays nothing with no current post at all', () => {
    useGame.setState({ current: null, imageReady: true, points: 0 })
    expect(useGame.getState().clickImage().gain).toBe(0)
    expect(useGame.getState().points).toBe(0)
  })
})

describe('buyTag', () => {
  it('levels a tag and deducts cost', () => {
    useGame.setState({ points: 10_000, tags: [setupTag('gangbang')] })
    const before = useGame.getState().points
    expect(useGame.getState().buyTag('gangbang')).toBe(true)
    const t = useGame.getState().tags.find((x) => x.name === 'gangbang')
    expect(t?.level).toBe(2)
    expect(useGame.getState().points).toBeLessThan(before)
    expect(useGame.getState().achievements).toContain('first_tag')
  })

  it('refuses when broke', () => {
    useGame.setState({
      points: 0,
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

describe('fetchFeed tag fan-out', () => {
  const mocked = vi.mocked(fetchPostsMulti)
  const offline: BooruResponse = { posts: [], source: null, ok: false, offline: true }

  it('queries a random single-pill subset each round (rotation, never full fan-out)', async () => {
    mocked.mockClear()
    const post = (id: string) => ({ id, url: `https://x/${id}.jpg`, tags: ['gangbang'] })
    mocked.mockResolvedValue({ posts: [post('r1'), post('r2')], source: 't', ok: true })
    useGame.setState({
      tags: [
        { name: 'aaa', level: 2, base: 10, income: 1, weight: 1 },
        { name: 'bbb', level: 1, base: 10, income: 1, weight: 1 },
        { name: 'ccc', level: 1, base: 10, income: 1, weight: 1 },
        { name: 'ddd', level: 1, base: 10, income: 1, weight: 1 },
      ],
      feedCursor: 0,
      recentQueryKeys: [],
    })
    await useGame.getState().fetchFeed()
    expect(mocked.mock.calls).toHaveLength(1)
    const arg = mocked.mock.calls[0][0]
    // One pill per query, at most PILLS_PER_ROUND pills, all from the pool.
    expect(arg.tags.length).toBeLessThanOrEqual(2)
    for (const t of arg.tags) expect(['aaa', 'bbb', 'ccc', 'ddd']).toContain(t)
    for (const t of arg.tags) expect(t).not.toContain(' ')
    // fetchFeed shuffles the batch — assert the set, not the order.
    const ids = [useGame.getState().current?.id, ...useGame.getState().queue.map((p) => p.id)].sort()
    expect(ids).toEqual(['r1', 'r2'])
  })

  it('never repeats the previous round key while alternatives exist', async () => {
    mocked.mockClear()
    mocked.mockResolvedValue(offline)
    // 5 pills → 10 possible pairs: history can never cover every
    // alternative, so each round must differ from the previous one.
    const names = ['w1', 'w2', 'w3', 'w4', 'w5']
    useGame.setState({
      tags: names.map((name, i) => ({ name, level: i + 1, base: 10, income: 1, weight: 1 })),
      feedCursor: 0,
      current: null,
      queue: [],
      recentQueryKeys: [],
    })
    const keys: string[] = []
    for (let i = 0; i < 6; i++) {
      await useGame.getState().fetchFeed()
      keys.push([...mocked.mock.calls[i][0].tags].sort().join(' '))
    }
    for (let i = 1; i < keys.length; i++) {
      expect(keys[i]).not.toBe(keys[i - 1])
    }
    expect(useGame.getState().recentQueryKeys.length).toBeGreaterThan(0)
  })

  it('steers the round with priorityTag, then clears it', async () => {
    mocked.mockClear()
    mocked.mockResolvedValue({ posts: [], source: null, ok: false, offline: true })
    useGame.setState({
      tags: [
        { name: 'aaa', level: 2, base: 10, income: 1, weight: 1 },
        { name: 'bbb', level: 1, base: 10, income: 1, weight: 1 },
      ],
      priorityTag: 'bbb',
      feedCursor: 0,
      current: null,
      queue: [],
    })
    await useGame.getState().fetchFeed()
    expect(mocked.mock.calls[0][0].priority).toBe('bbb')
  })

  it('does not advance the cursor on total failure', async () => {
    mocked.mockClear()
    mocked.mockResolvedValue(offline)
    useGame.setState({
      tags: [{ name: 'aaa', level: 2, base: 10, income: 1, weight: 1 }],
      feedCursor: 0,
      current: null,
      queue: [],
    })
    await useGame.getState().fetchFeed()
    expect(useGame.getState().feedCursor).toBe(0)
    expect(useGame.getState().feedOffline).toBe(true)
  })

  it('does not double-fetch a single-tag pool', async () => {
    mocked.mockClear()
    mocked.mockResolvedValue(offline)
    useGame.setState({
      tags: [{ name: 'aaa', level: 2, base: 10, income: 1, weight: 1 }],
      feedCursor: 0,
      current: null,
      queue: [],
    })
    await useGame.getState().fetchFeed()
    expect(mocked.mock.calls).toHaveLength(1)
  })

  it('marks seen-exhaustion gently without going offline when content remains', async () => {
    mocked.mockClear()
    const post = { id: 'k1', url: 'https://x/k1.jpg', tags: ['gangbang'] }
    mocked.mockResolvedValue({ posts: [], source: null, ok: false, emptyFresh: true })
    useGame.setState({
      tags: [{ name: 'aaa', level: 2, base: 10, income: 1, weight: 1 }],
      feedCursor: 0,
      current: post,
      queue: [],
    })
    await useGame.getState().fetchFeed()
    // single-tag pool: first + no duplicate second fetch
    expect(mocked.mock.calls).toHaveLength(1)
    const s = useGame.getState()
    expect(s.feedEmptyFresh).toBe(true)
    expect(s.feedOffline).toBe(false)
    expect(s.current?.id).toBe('k1')
  })

  it('retryFeedManual clears cooldowns and refetches', async () => {
    const { clearMirrorCooldowns } = await import('../services/booru')
    mocked.mockClear()
    mocked.mockResolvedValue(offline)
    useGame.setState({
      tags: [{ name: 'aaa', level: 2, base: 10, income: 1, weight: 1 }],
      feedCursor: 0,
      current: null,
      queue: [],
    })
    useGame.getState().retryFeedManual()
    await vi.waitFor(() => expect(mocked.mock.calls.length).toBeGreaterThan(0))
    expect(vi.mocked(clearMirrorCooldowns)).toHaveBeenCalled()
  })
})

describe('popCap', () => {
  it('charges pts, activates the buff, records usage', () => {
    useGame.setState({ points: 200 })
    expect(useGame.getState().popCap('blue')).toBe(true)
    const s = useGame.getState()
    expect(s.points).toBe(50)
    expect(s.caps).toHaveLength(1)
    expect(s.capsUsed).toContain('blue')
  })

  it('refuses when unaffordable', () => {
    useGame.setState({ points: 10 })
    expect(useGame.getState().popCap('melt')).toBe(false)
    expect(useGame.getState().caps).toHaveLength(0)
  })
})

describe('feed battle', () => {
  const foe = (id: string) => ({ id, url: `https://x/${id}.jpg`, tags: ['gangbang'] })

  it('drains foe HP and sends the KO to the gallery with a bonus', () => {
    useGame.setState({
      current: foe('b1'),
      imageReady: true,
      queue: [foe('b2')],
      foeHp: 8,
      foeMaxHp: 8,
      foeClicks: 0,
      defeated: 0,
      points: 0,
    })
    let killed = false
    for (let i = 0; i < 20 && !killed; i++) killed = useGame.getState().clickImage().killed
    expect(killed).toBe(true)
    const s = useGame.getState()
    expect(s.gallery).toHaveLength(1)
    expect(s.defeated).toBe(1)
    expect(s.points).toBeGreaterThan(0) // click pts + kill bonus
    expect(s.current?.id).toBe('b2') // next foe steps up at full scaled HP
    expect(s.foeMaxHp).toBeGreaterThan(8)
    expect(s.foeHp).toBe(s.foeMaxHp)
  })

  it('KO auto-discovers the foe tags as buyable market offers', () => {
    useGame.setState({
      current: { id: 'd1', url: 'https://x/d1.jpg', tags: ['gangbang', 'huge_breasts'] }, imageReady: true,
      queue: [],
      foeHp: 8,
      foeMaxHp: 8,
      foeClicks: 0,
      defeated: 0,
      points: 0,
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
      imageReady: true,
      queue: [foe('b2')],
      past: [],
      foeHp: 8,
      foeMaxHp: 8,
      foeClicks: 0,
      defeated: 0,
      points: 0,
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
      points: 0,
    })
    useGame.getState().advanceFeed()
    const s = useGame.getState()
    expect(s.gallery).toHaveLength(0)
    expect(s.defeated).toBe(3)
    expect(s.points).toBe(0)
    expect(s.current?.id).toBe('s2')
  })

  it('featured gallery pieces have no battle — clicks just pay pts', () => {
    useGame.setState({
      points: 100_000,
      current: foe('42'),
      imageReady: true,
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
    useGame.setState({ points: 0, current: null })
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

  it('removeGalleryImage deletes permanently and clears a matching backdrop', () => {
    useGame.setState({
      gallery: [
        { id: 'g1', url: 'https://x/g1.jpg', tags: ['a'], rarityBase: 10, clicks: 0, rarity: 'Gold' },
        { id: 'g2', url: 'https://x/g2.jpg', tags: ['b'], rarityBase: 5, clicks: 0, rarity: 'Silver' },
      ],
      backgroundUrl: 'https://x/g1.jpg',
    })
    expect(useGame.getState().removeGalleryImage('nope')).toBe(false)
    expect(useGame.getState().removeGalleryImage('g1')).toBe(true)
    const s = useGame.getState()
    expect(s.gallery.map((g) => g.id)).toEqual(['g2'])
    expect(s.backgroundUrl).toBeNull()
    expect(useGame.getState().removeGalleryImage('g2')).toBe(true)
    expect(useGame.getState().gallery).toHaveLength(0)
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
  it('pays passive pts/s from owned tags (quartered)', () => {
    useGame.setState({
      points: 0,
      tags: [{ name: 'wet', level: 2, base: 10, income: 5, weight: 2 }],
    })
    useGame.getState().tick(1000)
    const s = useGame.getState()
    expect(s.points).toBeGreaterThanOrEqual(2.5)
    expect(s.totalEarned).toBeGreaterThanOrEqual(2.5)
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
      points: 500,
      xp: 1600,
      totalEarned: 4_000_000,
      tags: [{ name: 'wet', level: 3, base: 10, income: 1, weight: 1 }],
      caps: [{ capId: 'blue', expiresAt: Date.now() + 60_000 }],
      gallery: [{ id: 'g1', url: 'u', tags: ['a'], rarityBase: 10, clicks: 0, rarity: 'Gold' }],
    })
    expect(useGame.getState().brainmelt()).toBe(true)
    const s = useGame.getState()
    expect(s.points).toBe(0)
    expect(s.xp).toBe(0)
    expect(s.totalEarned).toBe(0)
    expect(s.shards).toBe(2)
    expect(s.prestigeCount).toBe(1)
    expect(s.gallery).toHaveLength(1)
    expect(s.caps).toHaveLength(0)
    expect(s.tags.every((t) => t.level === 0)).toBe(true)
    expect(s.achievements).toContain('first_brainmelt')
  })

  it('blocked below tier 5', () => {
    useGame.setState({ xp: 0, totalEarned: 5_000_000 })
    expect(useGame.getState().brainmelt()).toBe(false)
    expect(useGame.getState().shards).toBe(0)
  })
})

describe('save / load / offline earnings', () => {
  it('round-trips through localStorage', () => {
    useGame.setState({ points: 777, ageVerified: true })
    useGame.getState().save()
    useGame.getState().resetGame()
    useGame.getState().load()
    expect(useGame.getState().points).toBe(777)
    expect(useGame.getState().ageVerified).toBe(true)
  })

  it('offers offline earnings on load and collects them', () => {
    const past = Date.now() - 60_000
    mem.set(
      SAVE_KEY,
      serialize({
        ...defaultSave(past),
        points: 123,
        ageAccepted: true,
        tags: [{ name: 'wet', level: 1, base: 10, income: 5, weight: 1 }],
        lastSeenAt: past,
      }),
    )
    useGame.getState().load()
    const s = useGame.getState()
    expect(s.points).toBe(123)
    expect(s.offlineGain).toBeCloseTo(18.75, 0) // 60s * 1.25 gps * 25% (passive+offline quartered)
    s.collectOffline()
    expect(useGame.getState().points).toBeCloseTo(141.75, 0)
    expect(useGame.getState().collectedOfflineEarnings).toBe(true)
    expect(useGame.getState().achievements).toContain('offline_slut')
  })

  it('load is idempotent (StrictMode-safe)', () => {
    mem.set(SAVE_KEY, serialize({ ...defaultSave(), points: 42, ageAccepted: true }))
    useGame.getState().load()
    useGame.getState().load()
    expect(useGame.getState().points).toBe(42)
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

  it('steers feed immediately with priorityTag when custom tag is added', async () => {
    mocked.mockClear()
    mocked.mockResolvedValue({ posts: [post], source: 'redgifs', ok: true })
    await useGame.getState().addCustomTag('Gooner')
    expect(useGame.getState().priorityTag).toBe('gooner')
    // fetchFeed honors priorityTag first even with other owned tags in the pool
    const multi = vi.mocked(fetchPostsMulti)
    multi.mockClear()
    multi.mockResolvedValue({ posts: [post], source: 'redgifs', ok: true })
    await useGame.getState().fetchFeed()
    expect(multi).toHaveBeenCalledWith(expect.objectContaining({ priority: 'gooner' }))
    expect(useGame.getState().priorityTag).toBeNull()
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
  const mocked = vi.mocked(fetchPostsMulti)
  const offline: BooruResponse = { posts: [], source: null, ok: false, offline: true }
  const post = (id: string) => ({ id, url: `https://x/${id}.jpg`, tags: ['gangbang'] })
  const dozen = () => Array.from({ length: 12 }, (_, i) => post(`pts${i}`))

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

  it('clickCell damages a square and banks pts', () => {
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
    const points = useGame.getState().points
    const firstId = useGame.getState().grid[0].post.id
    useGame.getState().dropCell(0)
    const s = useGame.getState()
    expect(s.points).toBe(points)
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

  it('tick generates points passively but does not damage squares without player clicking', () => {
    useGame.setState({ queue: dozen(), grid: [] })
    useGame.getState().setViewMode('grid')
    // Braceface (filter cap): permanent 1 auto-click/s.
    useGame.setState({ caps: [{ capId: 'filter', expiresAt: Number.POSITIVE_INFINITY }] })
    const before = useGame.getState().grid[0].hp
    const ptsBefore = useGame.getState().points
    useGame.getState().tick(1000)
    expect(useGame.getState().grid[0].hp).toBe(before)
    expect(useGame.getState().points).toBeGreaterThan(ptsBefore)
  })

  it('KO on single foe queues a non-blocking KoDrop from foe tags', () => {
    const post = { id: 'p1', url: 'u1', tags: ['milf', 'solo', 'smile'], rating: 'e' }
    useGame.setState({
      current: post,
      queue: [],
      foeHp: 1,
      foeMaxHp: 8,
      foeClicks: 0,
      tags: [],
      imageReady: true,
      pendingDrops: [],
    })
    const r = useGame.getState().clickImage()
    expect(r.killed).toBe(true)
    const s = useGame.getState()
    expect(s.pendingDrops.length).toBeGreaterThanOrEqual(1)
  })

  it('claimDropTag adopts the suggested tag, claimDropAntiTag adds the exclude', () => {
    useGame.setState({
      tags: [],
      userExcludes: [],
      pendingDrops: [
        { id: 'd1', foeTitle: 'milf', suggestedTag: 'milf', suggestedAntiTag: 'feet', timestamp: Date.now() },
      ],
    })
    expect(useGame.getState().claimDropTag('d1')).toBe(true)
    expect(useGame.getState().tags.map((t) => t.name)).toContain('milf')
    useGame.setState({
      pendingDrops: [
        { id: 'd2', foeTitle: 'x', suggestedAntiTag: 'feet', timestamp: Date.now() },
      ],
    })
    expect(useGame.getState().claimDropAntiTag('d2')).toBe(true)
    expect(useGame.getState().userExcludes).toContain('feet')
  })

  it('gridSizeForMode sizes layouts and reorderGrid swaps tiles', () => {
    expect(gridSizeForMode('1x1')).toBe(1)
    expect(gridSizeForMode('1x2')).toBe(2)
    expect(gridSizeForMode('2x2')).toBe(4)
    expect(gridSizeForMode('3x3')).toBe(9)
    useGame.setState({ queue: dozen(), grid: [] })
    useGame.getState().setViewMode('1x2')
    const s = useGame.getState()
    expect(s.grid).toHaveLength(2)
    const firstId = s.grid[0].post.id
    useGame.getState().reorderGrid(0, 1)
    expect(useGame.getState().grid[1].post.id).toBe(firstId)
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

describe('silent feed retry (never offline)', () => {
  it('schedules backoff on failure without stacking timers', async () => {
    const { fetchPostsMulti } = await import('../services/booru')
    const mocked = vi.mocked(fetchPostsMulti)
    mocked.mockReset()
    mocked.mockResolvedValue({ posts: [], source: null, ok: false, offline: true })
    useGame.setState({
      tags: [setupTag('aaa')],
      current: { id: 'live', url: 'https://x/live.jpg', tags: ['aaa'] },
      foeHp: 5,
      foeMaxHp: 5,
      past: [],
    })
    await useGame.getState().fetchFeed()
    expect(lastFeedRetryMs).toBe(5000)
    // Immediate refetch must not pile a second timer.
    await useGame.getState().fetchFeed()
    expect(lastFeedRetryMs).toBe(5000)
    // Game stays playable: last foe alive, no offline flag.
    const s = useGame.getState()
    expect(s.current?.id).toBe('live')
    expect(s.feedOffline).toBe(false)
  })

  it('never recycles past images into queue or grid on offline failure', async () => {
    const { fetchPostsMulti } = await import('../services/booru')
    const mocked = vi.mocked(fetchPostsMulti)
    mocked.mockReset()
    mocked.mockResolvedValue({ posts: [], source: null, ok: false, offline: true })
    const pastPost = { id: 'old-1', url: 'https://x/old-1.jpg', tags: ['aaa'] }
    useGame.setState({
      tags: [setupTag('aaa')],
      current: { id: 'live', url: 'https://x/live.jpg', tags: ['aaa'] },
      queue: [],
      past: [pastPost],
      gallery: [{ id: 'old-1', url: 'https://x/old-1.jpg', tags: ['aaa'], rarity: 'Common', rarityBase: 1, clicks: 2 }],
    })
    await useGame.getState().fetchFeed()
    const s = useGame.getState()
    expect(s.queue).toEqual([])
    expect(s.queue.some((p) => p.url === pastPost.url)).toBe(false)
  })
})

describe('purgePost (T3)', () => {
  it('learns up to 3 non-noise, non-feed excludes and saves', () => {
    useGame.setState({
      tags: [{ name: 'skylar_vox', level: 3, base: 10, income: 1, weight: 1, selected: true }],
      userExcludes: [],
      current: { id: 'p1', url: 'https://x/p1.jpg', tags: ['skylar_vox', 'blonde_hair', 'big_breasts', '1girl', 'close-up'], preview: '', rating: 'explicit', source: 'x' } as never,
      queue: [],
      past: [],
    })
    useGame.getState().purgePost(useGame.getState().current as never)
    const ex = useGame.getState().userExcludes
    expect(ex.length).toBeGreaterThan(0)
    expect(ex.length).toBeLessThanOrEqual(3)
    expect(ex).not.toContain('skylar_vox') // active feed tag is intent-protected
    expect(ex).not.toContain('close-up') // noise never becomes an exclude
    expect(useGame.getState().current).toBeNull() // advanced off-screen
    // 2+ learned tags leave a count-1 co-occurrence pair behind (T4)
    expect(useGame.getState().coRules.length).toBeGreaterThan(0)
    expect(useGame.getState().coRules[0].count).toBe(1)
  })
})

describe('toggleFeedCategory (REAL / HENTAI)', () => {
  it('toggles categories but keeps at least one active', () => {
    useGame.setState({ allowReal: true, allowHentai: true })
    useGame.getState().toggleFeedCategory('real')
    expect(useGame.getState().allowReal).toBe(false)
    expect(useGame.getState().allowHentai).toBe(true)

    // Attempting to turn off hentai when real is false should keep hentai active
    useGame.getState().toggleFeedCategory('hentai')
    expect(useGame.getState().allowHentai).toBe(true)
    expect(useGame.getState().allowReal).toBe(false)

    // Turning real back on
    useGame.getState().toggleFeedCategory('real')
    expect(useGame.getState().allowReal).toBe(true)
    expect(useGame.getState().allowHentai).toBe(true)
  })

  it('passes allowReal and allowHentai to fetchPostsMulti', async () => {
    vi.mocked(fetchPostsMulti).mockClear()
    vi.mocked(fetchPostsMulti).mockResolvedValue({ posts: [{ id: 'p1', url: 'https://x/p1.jpg', tags: ['aaa'] }], source: 't', ok: true })
    useGame.setState({
      tags: [setupTag('aaa')],
      allowReal: false,
      allowHentai: true,
      current: null,
      queue: [],
    })
    await useGame.getState().fetchFeed()
    expect(fetchPostsMulti).toHaveBeenCalled()
    const callArg = vi.mocked(fetchPostsMulti).mock.calls[0][0]
    expect(callArg.allowReal).toBe(false)
    expect(callArg.allowHentai).toBe(true)
  })
})

describe('resetGame fresh start', () => {
  it('wipes the never-repeat memory (fresh start = fresh pool)', () => {
    vi.mocked(clearSeenMemory).mockClear()
    useGame.getState().resetGame()
    expect(clearSeenMemory).toHaveBeenCalled()
  })
})

describe('tag-intent cache flush (solo/remove = no old-tag images)', () => {
  const other = { id: 'o1', url: 'https://x/o1.jpg', tags: ['bbb'] }
  const mine = { id: 's1', url: 'https://x/s1.jpg', tags: ['aaa'] }
  const untagged = { id: 'u1', url: 'https://x/u1.jpg', tags: [] }
  const owned = () => [
    { name: 'aaa', level: 2, base: 10, income: 1, weight: 1, selected: true },
    { name: 'bbb', level: 1, base: 10, income: 1, weight: 1, selected: true },
  ]

  it('soloTag flushes other-tag unseen posts and refills from the solo tag', async () => {
    const mocked = vi.mocked(fetchPostsMulti)
    mocked.mockClear()
    mocked.mockResolvedValue({ posts: [], source: null, ok: false, offline: true })
    useGame.setState({
      tags: owned(),
      queue: [other, mine, untagged],
      current: other,
      grid: [],
      priorityTag: null,
      recentQueryKeys: [],
      fetching: false,
    })
    expect(useGame.getState().soloTag('aaa')).toBe(true)
    const s = useGame.getState()
    expect(s.queue.map((p) => p.id).sort()).toEqual(['s1', 'u1'])
    expect(s.current).toBeNull()
    expect(s.priorityTag).toBe('aaa')
    // Solo refills immediately, steered by the solo tag.
    expect(mocked).toHaveBeenCalled()
    const arg = mocked.mock.calls[0][0]
    expect(arg.tags).toContain('aaa')
    expect(arg.priority).toBe('aaa')
  })

  it('deleteTag drops the removed tag unseen posts, keeps the rest', () => {
    useGame.setState({
      tags: owned(),
      queue: [other, mine, untagged],
      current: other,
      grid: [],
    })
    expect(useGame.getState().deleteTag('bbb')).toBe(true)
    const s = useGame.getState()
    expect(s.queue.map((p) => p.id).sort()).toEqual(['s1', 'u1'])
    expect(s.current).toBeNull()
  })

  it('deselecting a tag drops its unseen posts; reselecting keeps them', () => {
    useGame.setState({
      tags: owned(),
      queue: [other, mine],
      current: null,
      grid: [],
    })
    expect(useGame.getState().toggleTag('bbb')).toBe(true)
    expect(useGame.getState().queue.map((p) => p.id)).toEqual(['s1'])
  })
})
