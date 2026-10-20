import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The idle run is identity-scoped (`gmatch.save.v1:<orbitId>`). Before plan A1
// the slot was recomputed on every read AND write, so an identity that appeared
// mid-session (login) silently redirected the next autosave into another
// wallet's slot — and a logout wrote the account's run back into the plain
// pre-login slot. From the player's side that read as "my keepsakes are gone".
// Now the slot is pinned when the run is loaded and only
// `syncIdleSaveSlotToIdentity` moves it.

vi.mock('../services/booru', () => ({
  fetchPosts: vi.fn(async () => ({ posts: [], source: null, ok: false, offline: true })),
  fetchPostsMulti: vi.fn(async () => ({ posts: [], source: null, ok: false, offline: true })),
  clearMirrorCooldowns: vi.fn(),
  clearSeenMemory: vi.fn(),
  matchesQuery: () => true,
}))

import { defaultSave, serialize, SAVE_KEY, type SaveData } from './save'
import { useGame, syncIdleSaveSlotToIdentity, __resetSaveSlotForTests } from './store'
import type { GalleryImage } from './types'

let mem = new Map<string, string>()

const keep = (id: string): GalleryImage => ({
  id,
  url: `https://x/${id}.jpg`,
  tags: ['gangbang'],
  rarityBase: 50,
  clicks: 1,
  rarity: 'Common',
  boughtAt: 1,
  saveState: 'persisted',
})

const slot = (orbitId: string) => `${SAVE_KEY}:${orbitId}`

function seedSlot(key: string, patch: Partial<SaveData>): void {
  mem.set(key, serialize({ ...defaultSave(1000), ageAccepted: true, lastSeenAt: Date.now(), ...patch }))
}

beforeEach(() => {
  mem = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, v) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => mem.clear(),
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() { return mem.size },
  })
  __resetSaveSlotForTests()
  useGame.getState().resetGame()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('idle save slot follows the identity explicitly', () => {
  it('loads and saves in the identity-scoped slot when an identity exists', () => {
    mem.set('orbit_identity', JSON.stringify({ orbitId: 'alice' }))
    seedSlot(slot('alice'), { points: 42, gallery: [keep('k1')] })

    useGame.getState().load()
    expect(useGame.getState().points).toBe(42)
    expect(useGame.getState().gallery).toHaveLength(1)

    useGame.setState({ points: 1234 })
    useGame.getState().save()
    expect(JSON.parse(mem.get(slot('alice'))!).points).toBe(1234)
    expect(mem.has(SAVE_KEY)).toBe(false)
  })

  it('does not leak a login into another wallet: the run keeps its slot until re-keyed', () => {
    // Boot anonymous: the run lives in the plain slot.
    seedSlot(SAVE_KEY, { points: 77, gallery: [keep('anon')] })
    useGame.getState().load()
    expect(useGame.getState().points).toBe(77)

    // Identity appears mid-session (login). An autosave BEFORE the shell
    // re-keys must still write to the slot the run came from.
    mem.set('orbit_identity', JSON.stringify({ orbitId: 'alice' }))
    useGame.setState({ points: 78 })
    useGame.getState().save()
    expect(mem.has(slot('alice'))).toBe(false)
    expect(JSON.parse(mem.get(SAVE_KEY)!).points).toBe(78)

    // The explicit re-key moves it: pre-login play joins the empty slot.
    syncIdleSaveSlotToIdentity()
    expect(JSON.parse(mem.get(slot('alice'))!).points).toBe(78)
    expect(useGame.getState().points).toBe(78)
    expect(useGame.getState().gallery.map((g) => g.id)).toEqual(['anon'])
  })

  it('never overwrites an account save with the anonymous run', () => {
    seedSlot(SAVE_KEY, { points: 5, gallery: [keep('anon')] })
    seedSlot(slot('alice'), { points: 900, gallery: [keep('alice-keep')] })
    useGame.getState().load() // anonymous slot pinned

    mem.set('orbit_identity', JSON.stringify({ orbitId: 'alice' }))
    syncIdleSaveSlotToIdentity()

    // The account's own run wins and is what the player sees.
    expect(useGame.getState().points).toBe(900)
    expect(useGame.getState().gallery.map((g) => g.id)).toEqual(['alice-keep'])
    expect(JSON.parse(mem.get(slot('alice'))!).points).toBe(900)
    // The pre-login run is untouched in its own slot.
    expect(JSON.parse(mem.get(SAVE_KEY)!).points).toBe(5)
  })

  it('logout keeps the account run in its own slot and does not write it to the plain slot', () => {
    mem.set('orbit_identity', JSON.stringify({ orbitId: 'alice' }))
    seedSlot(slot('alice'), { points: 321, gallery: [keep('alice-keep')] })
    useGame.getState().load()

    // Logout: identity key gone.
    mem.delete('orbit_identity')
    syncIdleSaveSlotToIdentity()

    expect(mem.has(SAVE_KEY)).toBe(false)
    expect(JSON.parse(mem.get(slot('alice'))!).points).toBe(321)
    // The plain slot was empty, so the player starts a fresh pre-login run.
    expect(useGame.getState().points).toBe(0)
    expect(useGame.getState().gallery).toHaveLength(0)
  })

  it('restores the account run after a restart (identity present at load)', () => {
    mem.set('orbit_identity', JSON.stringify({ orbitId: 'alice' }))
    seedSlot(slot('alice'), { points: 555, gallery: [keep('k2'), keep('k3')] })
    __resetSaveSlotForTests()
    useGame.getState().resetGame()

    useGame.getState().load()
    expect(useGame.getState().points).toBe(555)
    expect(useGame.getState().gallery.map((g) => g.id)).toEqual(['k2', 'k3'])
  })

  it('is a no-op when nothing has been loaded yet', () => {
    mem.set('orbit_identity', JSON.stringify({ orbitId: 'alice' }))
    expect(() => syncIdleSaveSlotToIdentity()).not.toThrow()
    expect(mem.has(slot('alice'))).toBe(false)
  })
})
