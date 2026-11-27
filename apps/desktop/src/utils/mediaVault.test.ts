import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _resetPermanentMedia,
  ensurePermanentMedia,
  isPermanentlySaved,
  permanentRefFor,
  type PermanentMediaDeps,
} from './mediaVault'

const HASH = 'b'.repeat(64)
const LEGACY = 'a'.repeat(40)

function deps(over: Partial<PermanentMediaDeps> = {}): PermanentMediaDeps & {
  probe: ReturnType<typeof vi.fn>
  persist: ReturnType<typeof vi.fn>
} {
  return {
    probe: vi.fn(async () => null),
    persist: vi.fn(async () => ({ status: 'local' as const, ref: HASH, via: 'vault' as const })),
    ...over,
  } as PermanentMediaDeps & { probe: ReturnType<typeof vi.fn>; persist: ReturnType<typeof vi.fn> }
}

beforeEach(() => _resetPermanentMedia())

describe('permanentRefFor', () => {
  it('finds the address inside legacy urn/magnet rows and bare hashes', () => {
    expect(permanentRefFor(`urn:sha256:${HASH}`)).toBe(HASH)
    expect(permanentRefFor(`magnet:?xt=urn:btih:${LEGACY}`)).toBe(LEGACY)
    expect(permanentRefFor(HASH.toUpperCase())).toBe(HASH)
  })

  it('does not invent an address for a provider url or junk', () => {
    expect(permanentRefFor('https://cdn.example/a.mp4')).toBeNull()
    expect(permanentRefFor('urn:sha256:not-a-hash')).toBeNull()
    expect(permanentRefFor('')).toBeNull()
  })
})

describe('isPermanentlySaved', () => {
  it('requires both the persisted flag and a content ref', () => {
    expect(isPermanentlySaved({ saveState: 'persisted', localRef: HASH })).toBe(true)
    expect(isPermanentlySaved({ saveState: 'persisted' })).toBe(false)
    expect(isPermanentlySaved({ saveState: 'failed', localRef: HASH })).toBe(false)
  })
})

describe('ensurePermanentMedia', () => {
  it('reuses vault bytes for a legacy 40-hex row without fetching', async () => {
    const d = deps({ probe: vi.fn(async (key: string) => (key === LEGACY ? `vault://f/${LEGACY}` : null)) })
    const out = await ensurePermanentMedia(`magnet:?xt=urn:btih:${LEGACY}`, 'video', d)
    expect(out).toEqual({ state: 'permanent', ref: LEGACY, via: 'vault', reused: true })
    expect(d.persist).not.toHaveBeenCalled()
  })

  it('writes once, keyed by content hash, and reuses it on a repeat view', async () => {
    const d = deps()
    const first = await ensurePermanentMedia('https://cdn.example/clip.mp4', 'video', d)
    expect(first).toEqual({ state: 'permanent', ref: HASH, via: 'vault', reused: false })
    expect(d.persist).toHaveBeenCalledTimes(1)
    expect(d.persist).toHaveBeenCalledWith('https://cdn.example/clip.mp4', 'video')

    const second = await ensurePermanentMedia('https://cdn.example/clip.mp4', 'video', d)
    expect(second).toEqual(first)
    expect(d.persist).toHaveBeenCalledTimes(1)
  })

  it('never uses a provider url as the content ref when a url probe hits', async () => {
    const url = 'https://cdn.example/clip.mp4'
    const d = deps({ probe: vi.fn(async (k: string) => (k === url ? `vault://f/${url}` : null)) })
    const out = await ensurePermanentMedia(url, 'video', d)
    expect(out.state).toBe('permanent')
    // The ref is the verified hash returned by the persist step, never the URL.
    if (out.state === 'permanent') expect(out.ref).toBe(HASH)
    expect(d.persist).toHaveBeenCalledTimes(1)
  })

  it('reports the real failure and stays retryable', async () => {
    const d = deps({ persist: vi.fn(async () => ({ status: 'failed' as const, reason: 'quota' })) })
    expect(await ensurePermanentMedia('https://cdn.example/a.jpg', 'image', d))
      .toEqual({ state: 'failed', reason: 'quota' })
    expect(await ensurePermanentMedia('https://cdn.example/a.jpg', 'image', deps()))
      .toEqual({ state: 'permanent', ref: HASH, via: 'vault', reused: false })
  })

  it('never claims permanence for a local result with no content address', async () => {
    const d = deps({ persist: vi.fn(async () => ({ status: 'local' as const })) })
    expect(await ensurePermanentMedia('https://cdn.example/a.jpg', 'image', d))
      .toEqual({ state: 'failed', reason: 'not-saved' })
  })
})
