import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../services/booru', () => ({
  fetchPosts: vi.fn(async () => ({ posts: [], source: null, ok: false, offline: true })),
}))

import { defaultSave, serialize, SAVE_KEY } from './save'
import { setupTag } from './tags'
import { getUserExcludes } from './tagFilter'
import { fetchPosts } from '../services/booru'
import type { BooruResponse } from '../services/booru'
import { MAX_USER_EXCLUDES, useGame, GRID_SIZE } from './store'
import type { BooruPost } from './types'

const mocked = vi.mocked(fetchPosts)
const offline: BooruResponse = { posts: [], source: null, ok: false, offline: true }
const foe = (id: string): BooruPost => ({ id, url: `https://x/${id}.jpg`, tags: ['gangbang'] })
const post = (id: string) => ({ id, url: `https://x/${id}.jpg`, tags: ['gangbang'] })
const dozen = () => Array.from({ length: 12 }, (_, i) => post(`g${i}`))
const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0))
}

let mem = new Map<string, string>()
function withLocalStorage(): void {
  mem = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => {
      mem.set(k, v)
    },
    removeItem: (k: string) => {
      mem.delete(k)
    },
  })
}

beforeEach(() => {
  withLocalStorage()
  mocked.mockReset()
  mocked.mockResolvedValue(offline)
  useGame.getState().resetGame()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('storage edge paths (saveKey / read / write)', () => {
  it('runs without localStorage at all (browser-in-memory fallback)', async () => {
    vi.unstubAllGlobals() // node env: localStorage is undefined
    expect(() => useGame.getState().save()).not.toThrow()
    useGame.getState().load()
    expect(useGame.getState().loaded).toBe(true)
    expect(useGame.getState().gc).toBe(0)
  })

  it('swallows a throwing localStorage (saveKey/read/write catches)', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('quota')
      },
      setItem: () => {
        throw new Error('quota')
      },
    })
    expect(() => useGame.getState().save()).not.toThrow()
    useGame.getState().load()
    expect(useGame.getState().loaded).toBe(true)
  })

  it('keys the save slot by the active Orbit identity', () => {
    mem.set('orbit_identity', JSON.stringify({ orbitId: 'o1' }))
    useGame.setState({ gc: 991 })
    useGame.getState().save()
    expect(mem.has(`${SAVE_KEY}:o1`)).toBe(true)
    expect(mem.has(SAVE_KEY)).toBe(false)
    useGame.getState().resetGame()
    useGame.getState().load()
    expect(useGame.getState().gc).toBe(991)
  })

  it('falls back to the plain slot when the identity JSON is corrupt', () => {
    mem.set('orbit_identity', '{not json')
    useGame.setState({ gc: 5 })
    useGame.getState().save()
    expect(mem.has(SAVE_KEY)).toBe(true)
  })
})

describe('progress side effects', () => {
  it('announces a tier-up when a click crosses the XP threshold', () => {
    useGame.setState({ xp: 99, clicks: 0, toasts: [] })
    useGame.getState().clickImage()
    const s = useGame.getState()
    expect(s.xp).toBe(100)
    expect(s.toasts.some((t) => t.msg.includes('Pornification up'))).toBe(true)
  })
})

describe('setViewMode transitions', () => {
  it('single -> grid -> single with an empty queue asks the feed once', async () => {
    mocked.mockClear()
    useGame.setState({ viewMode: 'single', queue: [], grid: [], tags: [setupTag('aaa')] })
    useGame.getState().setViewMode('grid')
    await settle()
    // Queue empty -> grid can't fill -> fetchFeed fires (offline mock keeps it at 0).
    expect(mocked).toHaveBeenCalled()
    expect(useGame.getState().viewMode).toBe('grid')
    useGame.getState().setViewMode('single')
    expect(useGame.getState().viewMode).toBe('single')
    // Re-setting the same mode is a no-op (no extra write, no fetch).
    mocked.mockClear()
    useGame.getState().setViewMode('single')
    expect(mocked).not.toHaveBeenCalled()
  })

  it('grid -> grid with a full grid does not refetch', () => {
    mocked.mockClear()
    useGame.setState({ queue: dozen(), grid: [] })
    useGame.getState().setViewMode('grid')
    mocked.mockClear()
    useGame.getState().setViewMode('grid')
    expect(mocked).not.toHaveBeenCalled()
    expect(useGame.getState().grid).toHaveLength(GRID_SIZE)
  })
})

describe('soloTag', () => {
  it('selects only the target owned tag; refuses unknown/unowned', () => {
    useGame.setState({
      tags: [
        { name: 'aaa', level: 2, base: 10, income: 1, weight: 1, selected: true },
        { name: 'bbb', level: 1, base: 10, income: 1, weight: 1, selected: true },
        { name: 'ccc', level: 0, base: 10, income: 1, weight: 1, selected: false },
      ],
    })
    expect(useGame.getState().soloTag('aaa')).toBe(true)
    const s = useGame.getState()
    expect(s.tags.find((t) => t.name === 'aaa')?.selected).toBe(true)
    expect(s.tags.find((t) => t.name === 'bbb')?.selected).toBe(false)
    // Unowned offers are left alone by solo.
    expect(s.tags.find((t) => t.name === 'ccc')?.selected).toBe(false)
    expect(useGame.getState().soloTag('nope')).toBe(false)
    expect(useGame.getState().soloTag('ccc')).toBe(false)
  })
})

describe('addCustomTag validation messages', () => {
  it('maps every rejection reason to its own copy', async () => {
    mocked.mockClear()
    expect((await useGame.getState().addCustomTag('   ')).message).toBe('Type a tag first.')
    expect((await useGame.getState().addCustomTag('a')).message).toBe('Tag too short.')
    expect((await useGame.getState().addCustomTag('x'.repeat(41))).message).toBe(
      'Tag too long (40 max).',
    )
    expect((await useGame.getState().addCustomTag('highres')).message).toBe(
      'That tag carries no content — try another.',
    )
    expect((await useGame.getState().addCustomTag('loli')).message).toBe(
      'That tag is blocked — try another.',
    )
    expect(mocked).not.toHaveBeenCalled()
  })

  it('refuses while the feed is busy', async () => {
    useGame.setState({ fetching: true })
    const r = await useGame.getState().addCustomTag('fresh_tag')
    expect(r).toEqual({ added: false, message: 'Hold on — feed is busy.' })
    expect(useGame.getState().fetching).toBe(true)
  })
})

describe('refreshTagMarket', () => {
  const ownedTag = (name: string, level: number) => ({
    name,
    level,
    base: 10,
    income: 1,
    weight: 1,
    selected: level > 0,
  })

  it('skips while a fetch is in flight', async () => {
    useGame.setState({ fetching: true, tags: [ownedTag('aaa', 1)] })
    mocked.mockClear()
    await useGame.getState().refreshTagMarket()
    expect(mocked).not.toHaveBeenCalled()
  })

  it('rebuilds offers from live posts and keeps owned levels', async () => {
    mocked.mockResolvedValue({
      posts: [
        { id: 'm1', url: 'https://x/m1.jpg', tags: ['gangbang', 'creampie', 'gangbang'] },
        { id: 'm2', url: 'https://x/m2.jpg', tags: ['gangbang'] },
      ],
      source: 't',
      ok: true,
    })
    useGame.setState({
      tags: [ownedTag('gangbang', 3), ownedTag('stale_offer', 0), ownedTag('kept_owned', 2)],
    })
    await useGame.getState().refreshTagMarket()
    const s = useGame.getState()
    const gb = s.tags.find((t) => t.name === 'gangbang')
    expect(gb?.level).toBe(3) // old level preserved
    expect(gb?.base).toBeGreaterThan(0) // stats re-derived from live frequency
    expect(s.tags.map((t) => t.name)).toEqual(['gangbang', 'creampie', 'kept_owned'])
    expect(s.tags.some((t) => t.name === 'stale_offer')).toBe(false) // unowned offer dropped
    expect(s.fetching).toBe(false)
  })

  it('keeps the current unowned offers when the feed is down', async () => {
    mocked.mockResolvedValue(offline)
    useGame.setState({ tags: [ownedTag('gangbang', 1), ownedTag('offer_x', 0)] })
    await useGame.getState().refreshTagMarket()
    const s = useGame.getState()
    expect(s.tags.map((t) => t.name)).toEqual(['offer_x', 'gangbang'])
    expect(s.fetching).toBe(false)
  })
})

describe('fetchFeed guards + offline shapes', () => {
  it('skips while a fetch is in flight', async () => {
    useGame.setState({ fetching: true, tags: [setupTag('aaa')] })
    mocked.mockClear()
    await useGame.getState().fetchFeed()
    expect(mocked).not.toHaveBeenCalled()
  })

  it('grid mode keeps live squares when the feed goes offline', async () => {
    useGame.setState({ tags: [setupTag('aaa')], queue: dozen(), grid: [] })
    useGame.getState().setViewMode('grid')
    const before = useGame.getState().grid
    mocked.mockResolvedValue(offline)
    await useGame.getState().fetchFeed()
    const s = useGame.getState()
    expect(s.feedOffline).toBe(true)
    expect(s.grid).toBe(before) // squares untouched
    expect(s.current).toBeNull()
  })

  it('single mode clears the board when the feed goes offline', async () => {
    useGame.setState({
      tags: [setupTag('aaa')],
      current: foe('old'),
      queue: [foe('q')],
      foeHp: 5,
      foeMaxHp: 5,
    })
    mocked.mockResolvedValue(offline)
    await useGame.getState().fetchFeed()
    const s = useGame.getState()
    expect(s.current).toBeNull()
    expect(s.queue).toEqual([])
    expect(s.feedOffline).toBe(true)
  })

  it('retries once with the NEXT tag on a flaky round', async () => {
    mocked.mockReset()
    mocked
      .mockResolvedValueOnce(offline)
      .mockResolvedValueOnce({ posts: [post('retry')], source: 't', ok: true })
    useGame.setState({
      tags: [setupTag('aaa'), setupTag('bbb')],
      feedCursor: 0,
    })
    await useGame.getState().fetchFeed()
    const calls = mocked.mock.calls.map((c) => c[0].tags)
    expect(calls).toEqual(['aaa', 'bbb'])
    const s = useGame.getState()
    expect(s.current?.id).toBe('retry')
    expect(s.feedCursor).toBe(2)
  })
})

describe('advanceFeed / goBack / featureImage edges', () => {
  it('advanceFeed with an empty queue pushes history and refetches', async () => {
    useGame.setState({ tags: [setupTag('aaa')], current: foe('a1'), queue: [], past: [] })
    mocked.mockClear()
    useGame.getState().advanceFeed()
    await settle()
    const s = useGame.getState()
    expect(s.past.map((p) => p.id)).toEqual(['a1'])
    expect(mocked).toHaveBeenCalled()
  })

  it('advanceFeed with nothing at all just refetches', async () => {
    useGame.setState({ tags: [setupTag('aaa')], current: null, queue: [], past: [] })
    mocked.mockClear()
    useGame.getState().advanceFeed()
    await settle()
    expect(mocked).toHaveBeenCalled()
    expect(useGame.getState().past).toEqual([])
  })

  it('goBack with no current image keeps the queue as-is', () => {
    useGame.setState({ current: null, queue: [foe('q1')], past: [foe('p1')] })
    expect(useGame.getState().goBack()).toBe(true)
    const s = useGame.getState()
    expect(s.current?.id).toBe('p1')
    expect(s.queue.map((p) => p.id)).toEqual(['q1'])
  })

  it('featureImage ignores unknown ids', () => {
    useGame.setState({ gallery: [], current: foe('keep') })
    useGame.getState().featureImage('nope')
    expect(useGame.getState().current?.id).toBe('keep')
  })
})

describe('popCap stacking', () => {
  it('repeat pops compound without duplicating capsUsed', () => {
    useGame.setState({ gc: 1000 })
    expect(useGame.getState().popCap('blue')).toBe(true)
    expect(useGame.getState().popCap('blue')).toBe(true)
    const s = useGame.getState()
    expect(s.caps).toHaveLength(2)
    expect(s.capsUsed).toEqual(['blue'])
  })
})

describe('clickCell / dropCell edges', () => {
  it('a crit click on a square lands x10 damage', () => {
    useGame.setState({ queue: dozen(), grid: [], clicks: 24 })
    useGame.getState().setViewMode('grid')
    // Toughen the first square so the x10 crit damages instead of KOs.
    useGame.setState({
      grid: useGame.getState().grid.map((c, i) => (i === 0 ? { ...c, hp: 100, maxHp: 100 } : c)),
    })
    const before = useGame.getState().grid[0].hp
    const r = useGame.getState().clickCell(0)
    expect(r.crit).toBe(true)
    expect(useGame.getState().crits).toBe(1)
    expect(before - useGame.getState().grid[0].hp).toBe(r.gain)
    expect(r.gain).toBe(10)
  })

  it('a crit click that KOs a square pays the kill bonus', () => {
    useGame.setState({ queue: dozen(), grid: [], clicks: 24 })
    useGame.getState().setViewMode('grid')
    useGame.setState({ grid: useGame.getState().grid.map((c, i) => (i === 0 ? { ...c, hp: 1 } : c)) })
    const r = useGame.getState().clickCell(0)
    expect(r).toEqual({ gain: expect.any(Number), crit: true, killed: true, heat: expect.any(Number) })
    const s = useGame.getState()
    expect(s.gallery).toHaveLength(1)
    expect(s.crits).toBe(1)
  })

  it('KO with an empty queue refills via fetchFeed', async () => {
    mocked.mockClear()
    useGame.setState({
      tags: [setupTag('aaa')],
      grid: [{ post: foe('solo'), hp: 1, maxHp: 8, clicks: 0 }],
      queue: [],
      viewMode: 'grid',
    })
    const r = useGame.getState().clickCell(0)
    expect(r.killed).toBe(true)
    await settle()
    expect(mocked).toHaveBeenCalled()
  })

  it('dropCell on an empty square is a no-op', () => {
    useGame.setState({ grid: [], queue: [] })
    mocked.mockClear()
    expect(() => useGame.getState().dropCell(3)).not.toThrow()
    expect(mocked).not.toHaveBeenCalled()
  })

  it('dropCell with no refill asks the feed', async () => {
    mocked.mockClear()
    useGame.setState({
      tags: [setupTag('aaa')],
      grid: [{ post: foe('broken'), hp: 5, maxHp: 8, clicks: 0 }],
      queue: [],
      viewMode: 'grid',
    })
    useGame.getState().dropCell(0)
    await settle()
    const s = useGame.getState()
    expect(s.grid).toHaveLength(0)
    expect(s.past.map((p) => p.id)).toEqual(['broken'])
    expect(mocked).toHaveBeenCalled()
  })
})

describe('tick auto-battle paths', () => {
  const filterCap = [{ capId: 'filter' as const, expiresAt: Number.POSITIVE_INFINITY }]

  it('grid mode: an auto-click KOs the first square and slides in a fresh foe', () => {
    useGame.setState({ queue: dozen(), grid: [] })
    useGame.getState().setViewMode('grid')
    useGame.setState({
      caps: filterCap,
      grid: useGame.getState().grid.map((c, i) => (i === 0 ? { ...c, hp: 1 } : c)),
    })
    const gc = useGame.getState().gc
    useGame.getState().tick(1000)
    const s = useGame.getState()
    expect(s.defeated).toBe(1)
    expect(s.gallery).toHaveLength(1)
    expect(s.gc).toBeGreaterThan(gc)
    expect(s.grid).toHaveLength(GRID_SIZE)
    expect(s.toasts.some((t) => t.msg.includes('Auto-drained'))).toBe(true)
  })

  it('grid mode without auto-clicks just banks passive income', () => {
    useGame.setState({
      viewMode: 'grid',
      grid: [{ post: foe('g'), hp: 5, maxHp: 8, clicks: 0 }],
      queue: [],
      tags: [{ name: 'wet', level: 2, base: 10, income: 5, weight: 2 }],
      caps: [],
    })
    const before = useGame.getState().gc
    useGame.getState().tick(1000)
    const s = useGame.getState()
    expect(s.gc).toBeGreaterThan(before)
    expect(s.grid[0].hp).toBe(5) // untouched
  })

  it('single mode: an auto-click KOs the live foe and steps the queue up', async () => {
    mocked.mockClear()
    useGame.setState({
      tags: [setupTag('aaa')],
      caps: filterCap,
      current: foe('t1'),
      queue: [],
      foeHp: 1,
      foeMaxHp: 8,
      defeated: 0,
      gc: 0,
    })
    useGame.getState().tick(1000)
    const s = useGame.getState()
    expect(s.defeated).toBe(1)
    expect(s.gallery).toHaveLength(1)
    expect(s.current).toBeNull()
    expect(s.toasts.some((t) => t.msg.includes('Auto-drained'))).toBe(true)
    await settle()
    expect(mocked).toHaveBeenCalled() // empty queue -> refetch
  })

  it('single mode: auto-clicks chip a tough foe without a KO', () => {
    useGame.setState({
      caps: filterCap,
      current: foe('t2'),
      foeHp: 100,
      foeMaxHp: 100,
      defeated: 0,
    })
    useGame.getState().tick(1000)
    const s = useGame.getState()
    expect(s.foeHp).toBeLessThan(100)
    expect(s.foeHp).toBeGreaterThan(0)
    expect(s.defeated).toBe(0)
  })
})

describe('load edges', () => {
  it('restores permanent caps whose Infinity became null in JSON', () => {
    const raw = JSON.stringify({
      ...defaultSave(),
      version: 3,
      ageAccepted: true,
      caps: [{ capId: 'blue', expiresAt: null }],
    })
    mem.set(SAVE_KEY, raw)
    useGame.getState().load()
    const s = useGame.getState()
    expect(s.caps).toHaveLength(1)
    expect(s.caps[0].expiresAt).toBe(Number.POSITIVE_INFINITY)
  })

  it('grants no offline earnings before age acceptance', () => {
    const past = Date.now() - 60_000
    mem.set(
      SAVE_KEY,
      serialize({
        ...defaultSave(past),
        ageAccepted: false,
        tags: [{ name: 'wet', level: 1, base: 10, income: 5, weight: 1 }],
        lastSeenAt: past,
      }),
    )
    useGame.getState().load()
    expect(useGame.getState().offlineGain).toBe(0)
  })

  it('collectOffline is a no-op without a pending gain', () => {
    useGame.setState({ offlineGain: 0, gc: 7 })
    useGame.getState().collectOffline()
    expect(useGame.getState().gc).toBe(7)
    expect(useGame.getState().collectedOfflineEarnings).toBe(false)
  })
})

describe('setup / excludes / wallet edges', () => {
  it('verifyAge flips the gate and persists immediately', () => {
    useGame.getState().verifyAge()
    expect(useGame.getState().ageVerified).toBe(true)
    expect(mem.has(SAVE_KEY)).toBe(true)
  })

  it('completeSetup refuses a second time', () => {
    expect(
      useGame.getState().completeSetup(['bimbo', 'creampie', 'ahegao', 'doggystyle'], []).ok,
    ).toBe(true)
    const again = useGame.getState().completeSetup(['a', 'b', 'c', 'd'], [])
    expect(again).toEqual({ ok: false, message: 'Setup already done.' })
  })

  it('addUserExclude rejects blanks and over-long terms', () => {
    expect(useGame.getState().addUserExclude('   ')).toBe(false)
    expect(useGame.getState().addUserExclude('x'.repeat(41))).toBe(false)
    expect(useGame.getState().userExcludes).toEqual([])
  })

  it('addUserExclude refuses past the cap and removeUserExclude clears it', () => {
    useGame.setState({ userExcludes: Array.from({ length: MAX_USER_EXCLUDES }, (_, i) => `t${i}`) })
    expect(useGame.getState().addUserExclude('one_more')).toBe(false)
    expect(useGame.getState().removeUserExclude('t0')).toBe(true)
    expect(useGame.getState().addUserExclude('one_more')).toBe(true)
  })

  it('resetGame wipes user excludes everywhere', () => {
    useGame.getState().addUserExclude('feet')
    expect(getUserExcludes()).toEqual(['feet'])
    useGame.getState().resetGame()
    expect(useGame.getState().userExcludes).toEqual([])
    expect(getUserExcludes()).toEqual([])
  })

  it('setWallet writes markers with and without a gc override', () => {
    useGame.setState({ gc: 10 })
    useGame.getState().setWallet({ credited: 3, debited: 1 })
    expect(useGame.getState().gc).toBe(10) // gc untouched when omitted
    useGame.getState().setWallet({ gc: 42, credited: 5, debited: 2 })
    const s = useGame.getState()
    expect(s.gc).toBe(42)
    expect(s.credited).toBe(5)
    expect(s.debited).toBe(2)
  })

  it('toast log caps at 50 entries', () => {
    useGame.setState({ gc: 100_000 })
    for (let i = 0; i < 60; i++) useGame.getState().popCap('blue')
    expect(useGame.getState().toasts.length).toBeLessThanOrEqual(50)
    useGame.getState().dismissToast(useGame.getState().toasts[0].id)
    expect(useGame.getState().toasts.length).toBeLessThan(50)
    useGame.getState().clearToasts()
    expect(useGame.getState().toasts).toEqual([])
  })
})
