// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GalleryImage } from '../game/types'
import { getObject } from './storage'
import {
  _resetPermanentMedia,
  ensurePermanentMedia,
  isPermanentlySaved,
  permanentRefFor,
  rememberUploadedMediaKeep,
  type PermanentMediaDeps,
} from './mediaVault'

const HASH = 'b'.repeat(64)
const LEGACY = 'a'.repeat(40)

/** The gallery store is a test seam here: the helper owns the decision, the
 *  store only holds the resulting keep. */
const galleryState = { gallery: [] as GalleryImage[], totalGallerySaved: 0, save: vi.fn() }
vi.mock('../game/store', () => ({
  useGame: {
    getState: () => galleryState,
    setState: (updater: (s: typeof galleryState) => Partial<typeof galleryState>) => {
      Object.assign(galleryState, updater(galleryState))
    },
  },
}))
vi.mock('./storage', () => ({ getObject: vi.fn(async () => null) }))

function deps(over: Partial<PermanentMediaDeps> = {}): PermanentMediaDeps & {
  probe: ReturnType<typeof vi.fn>
  persist: ReturnType<typeof vi.fn>
} {
  return {
    probe: vi.fn(async () => null),
    verify: vi.fn(async () => null),
    persist: vi.fn(async () => ({ status: 'local' as const, ref: HASH, via: 'vault' as const })),
    ...over,
  } as PermanentMediaDeps & { probe: ReturnType<typeof vi.fn>; persist: ReturnType<typeof vi.fn> }
}

beforeEach(() => {
  _resetPermanentMedia()
  galleryState.gallery = []
  galleryState.totalGallerySaved = 0
  galleryState.save.mockClear()
  vi.mocked(getObject).mockReset()
  vi.mocked(getObject).mockResolvedValue(null)
})

const forged = { id: 'upload-1', contentHash: HASH, mimeType: 'image/png' }

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

  it('marks a keep permanent only after the vault verifies the bytes', async () => {
    const verify = vi.fn(async (_ref: string): Promise<string | null> => null)
    const g = window as unknown as { gmatch?: unknown }
    const prev = g.gmatch
    g.gmatch = { vaultGet: async () => null, vaultPin: async () => null }
    try {
      const unverified = deps({
        persist: vi.fn(async () => ({ status: 'local' as const, ref: HASH, via: 'idb' as const })),
        verify,
      })
      expect(await ensurePermanentMedia('https://cdn.example/unverified.jpg', 'image', unverified))
        .toEqual({ state: 'failed', reason: 'vault-unverified' })
      // A verified read-back is the ONLY way to claim the permanent vault.
      verify.mockResolvedValueOnce(`vault://f/${HASH}`)
      const verified = deps({
        persist: vi.fn(async () => ({ status: 'local' as const, ref: HASH, via: 'idb' as const })),
        verify,
      })
      expect(await ensurePermanentMedia('https://cdn.example/verified.jpg', 'image', verified))
        .toEqual({ state: 'permanent', ref: HASH, via: 'vault', reused: false })
    } finally {
      g.gmatch = prev
    }
  })
})

describe('rememberUploadedMediaKeep', () => {
  it('records an uploaded image as one verified Vault keep — never a card', async () => {
    const keep = await rememberUploadedMediaKeep(forged, {
      tags: ['sunset'],
      deps: { probe: vi.fn(async (key: string) => (key === HASH ? `vault://f/${HASH}` : null)) },
    })
    expect(keep).toMatchObject({
      id: 'upload:upload-1',
      url: HASH,
      localRef: HASH,
      saveState: 'persisted',
      kind: 'image',
      tags: ['sunset'],
    })
    expect(keep).not.toHaveProperty('card_id')
    expect(galleryState.gallery).toEqual([keep])
    expect(galleryState.totalGallerySaved).toBe(1)
    expect(galleryState.save).toHaveBeenCalledTimes(1)
    // A repeat never duplicates the keep or the lifetime counter.
    await rememberUploadedMediaKeep(forged, {
      deps: { probe: vi.fn(async () => `vault://f/${HASH}`) },
    })
    expect(galleryState.gallery).toHaveLength(1)
    expect(galleryState.totalGallerySaved).toBe(1)
  })

  it('infers video from the forged MIME', async () => {
    const keep = await rememberUploadedMediaKeep(
      { ...forged, mimeType: 'video/mp4' },
      { deps: { probe: vi.fn(async () => `vault://f/${HASH}`) } },
    )
    expect(keep?.kind).toBe('video')
  })

  it('accepts the browser dev durable copy when there is no vault bridge', async () => {
    vi.mocked(getObject).mockResolvedValue({ id: HASH, data: new ArrayBuffer(4) } as never)
    const keep = await rememberUploadedMediaKeep(forged)
    expect(keep).toMatchObject({ saveState: 'persisted', localRef: HASH })
    expect(keep?.kind).toBe('image')
  })

  it('reports no keep when the upload bytes cannot be found anywhere', async () => {
    const keep = await rememberUploadedMediaKeep(forged)
    expect(keep).toBeNull()
    expect(galleryState.gallery).toEqual([])
  })

  it('refuses an object with no content address instead of minting a fake keep', async () => {
    expect(await rememberUploadedMediaKeep({ ...forged, contentHash: '' })).toBeNull()
    expect(galleryState.gallery).toEqual([])
  })
})
