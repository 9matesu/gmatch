// Priority 4 (media resolution order) — the local-first ladder shared by the
// zoom modal and the wallpaper resolver. It must match useObjectImage's own
// order exactly (vault → swarm store), never touch the network, and refuse
// descriptors (magnet/urn) instead of firing a doomed probe.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const vaultProbe = vi.hoisted(() => vi.fn(async (): Promise<{ state: 'local' | 'missing'; local: string | null; mime: string | null }> => ({ state: 'missing', local: null, mime: null })))
const getLocalObject = vi.hoisted(() => vi.fn(async () => null as Blob | null))

vi.mock('../services/vault', () => ({ vaultProbe }))
vi.mock('./p2pSwarm', () => ({ getLocalObject, PEER_ONLINE_EVENT: 'orbit-peer-online' }))

const { localHeldMediaUrl } = await import('./localMedia')

const URL_OF = (id: string) => `/api/objects/${id}`
const ID = 'a1b2c3d4-e5f6-4a1b-8c2d-9e0f1a2b3c4d'

beforeEach(() => {
  vaultProbe.mockClear()
  getLocalObject.mockClear()
})

describe('localHeldMediaUrl — the local-first media ladder', () => {
  it('serves a vault hit first (loopback URL, no second probe)', async () => {
    vaultProbe.mockResolvedValueOnce({ state: 'local', local: 'http://127.0.0.1:8791/vault/x', mime: 'video/mp4' })
    const url = await localHeldMediaUrl(URL_OF(ID))
    expect(url).toBe('http://127.0.0.1:8791/vault/x')
    expect(getLocalObject).not.toHaveBeenCalled()
  })

  it('falls through to the swarm store when the vault has no bytes', async () => {
    getLocalObject.mockResolvedValueOnce(new Blob(['held']))
    const url = await localHeldMediaUrl(ID)
    expect(vaultProbe).toHaveBeenCalledWith(ID)
    expect(getLocalObject).toHaveBeenCalledWith(ID)
    expect(url).toMatch(/^blob:/)
  })

  it('normalizes /api/objects/<id> and bare ids to the same lookup', async () => {
    await localHeldMediaUrl(URL_OF(ID))
    await localHeldMediaUrl(ID)
    expect(vaultProbe).toHaveBeenNthCalledWith(1, ID)
    expect(vaultProbe).toHaveBeenNthCalledWith(2, ID)
  })

  it('accepts a urn:sha256 descriptor by resolving it onto its object id', async () => {
    await localHeldMediaUrl(`urn:sha256:${ID}`)
    expect(vaultProbe).toHaveBeenCalledWith(ID)
  })

  it('refuses a magnet descriptor without touching any store', async () => {
    const url = await localHeldMediaUrl('magnet:?xt=urn:btih:abc')
    expect(url).toBeNull()
    expect(vaultProbe).not.toHaveBeenCalled()
    expect(getLocalObject).not.toHaveBeenCalled()
  })

  it('answers null on an honest miss — no network, no fabricated URL', async () => {
    const url = await localHeldMediaUrl(ID)
    expect(url).toBeNull()
  })

  it('survives a broken vault bridge (browser dev) and still reaches the store', async () => {
    vaultProbe.mockRejectedValueOnce(new Error('no IPC'))
    getLocalObject.mockResolvedValueOnce(new Blob(['still-here']))
    expect(await localHeldMediaUrl(ID)).toMatch(/^blob:/)
  })
})
