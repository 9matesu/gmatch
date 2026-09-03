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
import { starterOffers } from './tags'
import { useGame } from './store'

beforeEach(() => {
  mem.clear()
  useGame.getState().resetGame()
})

describe('clickImage', () => {
  it('every 25th click is a CRIT and banks GP/XP', () => {
    const g = useGame.getState()
    for (let i = 0; i < 25; i++) g.clickImage()
    const s = useGame.getState()
    expect(s.clicks).toBe(25)
    expect(s.crits).toBe(1)
    expect(s.gp).toBeGreaterThan(30)
    expect(s.totalEarnedGP).toBeCloseTo(s.gp, 6)
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
    useGame.setState({ gp: 10_000, tags: starterOffers() })
    const before = useGame.getState().gp
    expect(useGame.getState().buyTag('1girl')).toBe(true)
    const t = useGame.getState().tags.find((x) => x.name === '1girl')
    expect(t?.level).toBe(1)
    expect(useGame.getState().gp).toBeLessThan(before)
    expect(useGame.getState().achievements).toContain('first_tag')
  })

  it('refuses when broke', () => {
    useGame.setState({ gp: 0, tags: starterOffers() })
    expect(useGame.getState().buyTag('1girl')).toBe(false)
    expect(useGame.getState().tags.find((x) => x.name === '1girl')?.level).toBe(0)
  })
})

describe('refreshTagMarket', () => {
  it('falls back to starter tags when the feed is offline', async () => {
    useGame.setState({ tags: [] })
    await useGame.getState().refreshTagMarket()
    const names = useGame.getState().tags.map((t) => t.name)
    expect(names).toContain('1girl')
    expect(names).toContain('cosplay')
  })
})

describe('popCap', () => {
  it('charges GP, activates the buff, records usage', () => {
    useGame.setState({ gp: 200 })
    expect(useGame.getState().popCap('blue')).toBe(true)
    const s = useGame.getState()
    expect(s.gp).toBe(50)
    expect(s.caps).toHaveLength(1)
    expect(s.capsUsed).toContain('blue')
  })

  it('refuses when unaffordable', () => {
    useGame.setState({ gp: 10 })
    expect(useGame.getState().popCap('melt')).toBe(false)
    expect(useGame.getState().caps).toHaveLength(0)
  })
})

describe('buyCurrentImage', () => {
  it('adds a gallery entry at the computed price', () => {
    useGame.setState({
      gp: 100_000,
      current: { id: '42', url: 'https://x/42.jpg', tags: ['1girl'] },
    })
    expect(useGame.getState().buyCurrentImage()).toBe(true)
    const s = useGame.getState()
    expect(s.gallery).toHaveLength(1)
    expect(s.gallery[0].boughtAt).toBeTypeOf('number')
    expect(s.gp).toBeLessThan(100_000)
  })

  it('does nothing without a current image', () => {
    useGame.setState({ gp: 100_000 })
    expect(useGame.getState().buyCurrentImage()).toBe(false)
  })
})

describe('tick', () => {
  it('pays passive GP/s from owned tags', () => {
    useGame.setState({
      gp: 0,
      tags: [{ name: 'wet', level: 2, base: 10, income: 5, weight: 2 }],
    })
    useGame.getState().tick(1000)
    const s = useGame.getState()
    expect(s.gp).toBeGreaterThanOrEqual(10)
    expect(s.totalEarnedGP).toBeGreaterThanOrEqual(10)
  })

  it('expires spent caps', () => {
    useGame.setState({ caps: [{ capId: 'blue', expiresAt: Date.now() - 1 }] })
    useGame.getState().tick(1000)
    expect(useGame.getState().caps).toHaveLength(0)
  })
})

describe('brainmelt', () => {
  it('resets the run, keeps gallery, grants shards', () => {
    useGame.setState({
      gp: 500,
      xp: 1600,
      totalEarnedGP: 4_000_000,
      tags: [{ name: 'wet', level: 3, base: 10, income: 1, weight: 1 }],
      caps: [{ capId: 'blue', expiresAt: Date.now() + 60_000 }],
      gallery: [{ id: 'g1', url: 'u', tags: ['a'], rarityBase: 10, clicks: 0, rarity: 'Gold' }],
    })
    expect(useGame.getState().brainmelt()).toBe(true)
    const s = useGame.getState()
    expect(s.gp).toBe(0)
    expect(s.xp).toBe(0)
    expect(s.totalEarnedGP).toBe(0)
    expect(s.shards).toBe(2)
    expect(s.prestigeCount).toBe(1)
    expect(s.gallery).toHaveLength(1)
    expect(s.caps).toHaveLength(0)
    expect(s.tags.every((t) => t.level === 0)).toBe(true)
    expect(s.achievements).toContain('first_brainmelt')
  })

  it('blocked below tier 5', () => {
    useGame.setState({ xp: 0, totalEarnedGP: 5_000_000 })
    expect(useGame.getState().brainmelt()).toBe(false)
    expect(useGame.getState().shards).toBe(0)
  })
})

describe('save / load / offline earnings', () => {
  it('round-trips through localStorage', () => {
    useGame.setState({ gp: 777, ageVerified: true })
    useGame.getState().save()
    useGame.getState().resetGame()
    useGame.getState().load()
    expect(useGame.getState().gp).toBe(777)
    expect(useGame.getState().ageVerified).toBe(true)
  })

  it('offers offline earnings on load and collects them', () => {
    const past = Date.now() - 60_000
    mem.set(
      SAVE_KEY,
      serialize({
        ...defaultSave(past),
        gp: 123,
        ageAccepted: true,
        tags: [{ name: 'wet', level: 1, base: 10, income: 5, weight: 1 }],
        lastSeenAt: past,
      }),
    )
    useGame.getState().load()
    const s = useGame.getState()
    expect(s.gp).toBe(123)
    expect(s.offlineGain).toBeCloseTo(150, 0) // 60s * 5 GP/s * 50%
    s.collectOffline()
    expect(useGame.getState().gp).toBeCloseTo(273, 0)
    expect(useGame.getState().collectedOfflineEarnings).toBe(true)
    expect(useGame.getState().achievements).toContain('offline_slut')
  })

  it('load is idempotent (StrictMode-safe)', () => {
    mem.set(SAVE_KEY, serialize({ ...defaultSave(), gp: 42, ageAccepted: true }))
    useGame.getState().load()
    useGame.getState().load()
    expect(useGame.getState().gp).toBe(42)
  })
})
