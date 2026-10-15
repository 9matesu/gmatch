import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Local-first save lifecycle. The audited defect: a KO wrote the gallery record
 * and fired `void vaultPin(url)` without awaiting it, so an item existed as
 * "kept" before any byte was downloaded, and a refused download was swallowed —
 * leaving a remote URL in the gallery masquerading as a saved asset.
 */

const vaultPin = vi.fn()
const vaultGet = vi.fn()
vi.mock('../services/vault', () => ({
  vaultPin: (u: string) => vaultPin(u),
  vaultGet: (u: string) => vaultGet(u),
  vaultUnpin: vi.fn(),
  vaultRemove: vi.fn(),
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

import { useGame, __resetFeedRetryForTests } from './store'

const drainFoe = () => {
  let killed = false
  for (let i = 0; i < 30 && !killed; i++) killed = useGame.getState().clickImage().killed
  return killed
}

const armFoe = () =>
  useGame.setState({
    current: { id: 'p1', url: 'https://x/p1.jpg', tags: ['gangbang'] },
    imageReady: true,
    queue: [],
    foeHp: 8,
    foeMaxHp: 8,
    foeClicks: 0,
    defeated: 0,
    points: 0,
  } as never)

const settle = () => new Promise((r) => setTimeout(r, 0))

describe('gallery save is verified before it is called saved', () => {
  beforeEach(() => {
    mem.clear()
    vaultPin.mockReset()
    vaultGet.mockReset()
    useGame.getState().resetGame()
    __resetFeedRetryForTests()
  })

  it('marks a keep persisted only after the bytes are readable', async () => {
    vaultPin.mockResolvedValue('vault://f/p1.jpg')
    vaultGet.mockResolvedValue('vault://f/p1.jpg')
    armFoe()
    expect(drainFoe()).toBe(true)
    await settle()

    const [kept] = useGame.getState().gallery
    expect(kept.saveState).toBe('persisted')
    expect(kept.localRef).toBe('vault://f/p1.jpg')
    // Provenance is kept apart from where the bytes live.
    expect(kept.sourceRef?.postId).toBe('p1')
  })

  it('never reports persisted when the download fails', async () => {
    vaultPin.mockResolvedValue(null)
    vaultGet.mockResolvedValue(null)
    armFoe()
    expect(drainFoe()).toBe(true)
    await settle()

    const [kept] = useGame.getState().gallery
    expect(kept.saveState).toBe('failed')
    expect(kept.localRef).toBeUndefined()
    // The record still exists (the KO happened) but makes no persistence claim.
    expect(kept.url).toBe('https://x/p1.jpg')
  })

  it('rejects a pin that reports a path it cannot read back', async () => {
    // The classic half-written state: pin says yes, read-back says no.
    vaultPin.mockResolvedValue('vault://f/gone.jpg')
    vaultGet.mockResolvedValue(null)
    armFoe()
    expect(drainFoe()).toBe(true)
    await settle()

    const [kept] = useGame.getState().gallery
    expect(kept.saveState).toBe('failed')
    expect(kept.localRef).toBeUndefined()
  })

  it('starts a keep as downloading, never as saved up front', () => {
    vaultPin.mockResolvedValue(null)
    armFoe()
    // Read synchronously: the record exists before the pin resolves, and must
    // not already claim persistence.
    drainFoe()
    expect(useGame.getState().gallery[0].saveState).toBe('downloading')
  })
})

describe('legacy gallery records', () => {
  beforeEach(() => {
    mem.clear()
    useGame.getState().resetGame()
    __resetFeedRetryForTests()
  })

  it('loads a pre-existing save whose records have no save fields', () => {
    // Old saves carry only url/tags/rarity fields. They must load untouched —
    // no migration, no rewriting, no dropped keeps.
    const legacy = [
      { id: 'old-1', url: 'https://x/old.jpg', tags: ['t'], rarityBase: 1, clicks: 0, rarity: 'Common' },
    ]
    useGame.setState({ gallery: legacy as never })
    const g = useGame.getState().gallery
    expect(g).toHaveLength(1)
    expect(g[0].url).toBe('https://x/old.jpg')
    expect(g[0].saveState).toBeUndefined()
  })
})
