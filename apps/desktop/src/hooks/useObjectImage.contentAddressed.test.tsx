// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook, waitFor } from '@testing-library/react'

/**
 * A peer-replicated post carries the sha256 of its bytes (`contentCid`). The
 * hook must resolve such a row from that content — local verified bytes, then
 * the swarm with the hash attached — and never ask the node's object route:
 * the node may not even have the row, and §12b keeps media with the peers.
 *
 * A row WITHOUT a content hash is the legacy ladder and is asserted here too,
 * so this slice cannot silently change how every other picture loads.
 */
vi.mock('../utils/p2pSwarm', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../utils/p2pSwarm')>()
  return {
    ...mod,
    getLocalObject: vi.fn(async () => null),
    registerLocalObject: vi.fn(),
    requestSwarmObject: vi.fn(),
    // jsdom's Blob has no arrayBuffer(); the resolver only needs a digest that
    // matches the addresses the fixtures use.
    sha256HexBlob: vi.fn(async () => 'a'.repeat(64)),
  }
})
vi.mock('../services/vault', () => ({ vaultProbe: vi.fn(async () => ({ state: 'miss' })) }))
vi.mock('../utils/api', () => ({
  orbitFetch: vi.fn(async () => ({ ok: false, status: 404 }) as Response),
}))

const identity = { orbitId: 'me', publicKeyHex: 'p', privateKeyHex: 'k' }
const CONTENT_HASH = 'a'.repeat(64)

async function modules() {
  const swarm = await import('../utils/p2pSwarm')
  const api = await import('../utils/api')
  const hook = await import('./useObjectImage')
  return {
    getLocalObject: vi.mocked(swarm.getLocalObject),
    requestSwarmObject: vi.mocked(swarm.requestSwarmObject),
    registerLocalObject: vi.mocked(swarm.registerLocalObject),
    orbitFetch: vi.mocked(api.orbitFetch),
    useObjectImage: hook.useObjectImage,
    reset: hook.__resetObjectImageCacheForTests,
  }
}

describe('useObjectImage content-addressed rows (L4)', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const m = await modules()
    m.reset()
    ;(URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => 'blob:peer-picture')
    ;(URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn()
    m.getLocalObject.mockResolvedValue(null)
    m.requestSwarmObject.mockResolvedValue(new Blob(['png'], { type: 'image/png' }))
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('fetches the row by its content hash, verified, and never asks the node', async () => {
    const m = await modules()

    const h = renderHook(() => m.useObjectImage('post-object-1', identity, { contentHash: CONTENT_HASH }))
    await waitFor(() => expect(h.result.current.url).toBe('blob:peer-picture'))

    expect(m.orbitFetch).not.toHaveBeenCalled()
    expect(m.requestSwarmObject).toHaveBeenCalledWith(CONTENT_HASH, 5000, { expectedHash: CONTENT_HASH })
    // The verified bytes are cached under the object alias AND the content key.
    expect(m.registerLocalObject).toHaveBeenCalledWith('post-object-1', expect.any(Blob))
    expect(m.registerLocalObject).toHaveBeenCalledWith(CONTENT_HASH, expect.any(Blob))
    expect(h.result.current.failed).toBe(false)
    h.unmount()
  })

  it('resolves a hash-bearing ref through the content ladder even when the caller passes no contentHash', async () => {
    // Root cause of "peer images never load": every surface that renders a
    // `urn:sha256:` / magnet ref relies on the hook to see the address INSIDE
    // the descriptor. Without this the legacy ladder treats the ref as an
    // unresolvable descriptor and asks nobody for the bytes.
    const m = await modules()

    const h = renderHook(() => m.useObjectImage(`urn:sha256:${CONTENT_HASH}`, identity))
    await waitFor(() => expect(h.result.current.url).toBe('blob:peer-picture'))

    expect(m.orbitFetch).not.toHaveBeenCalled()
    expect(m.requestSwarmObject).toHaveBeenCalledWith(CONTENT_HASH, 5000, { expectedHash: CONTENT_HASH })
    h.unmount()
  })

  it('resolves a legacy 40-hex ref from local bytes (the prefix branch callers used to gate out)', async () => {
    const bytes = new Blob(['legacy-prefix-bytes'], { type: 'image/png' })
    const prefix = CONTENT_HASH.slice(0, 40)
    const m = await modules()
    m.getLocalObject.mockImplementation(async (id: string) => (id === prefix ? bytes : null))

    const h = renderHook(() => m.useObjectImage('legacy-ref-object', identity, { contentHash: prefix }))
    await waitFor(() => expect(h.result.current.url).toBe('blob:peer-picture'))

    expect(m.getLocalObject).toHaveBeenCalledWith(prefix)
    expect(m.requestSwarmObject).not.toHaveBeenCalled()
    expect(m.orbitFetch).not.toHaveBeenCalled()
    expect(h.result.current.failed).toBe(false)
    h.unmount()
  })

  it('reports an honest miss when no peer can prove the bytes', async () => {
    const m = await modules()
    m.requestSwarmObject.mockRejectedValue(new Error('no seeder'))

    const h = renderHook(() => m.useObjectImage('post-object-2', identity, { contentHash: CONTENT_HASH }))
    await waitFor(() => expect(h.result.current.failed).toBe(true))

    expect(m.orbitFetch).not.toHaveBeenCalled()
    expect(m.registerLocalObject).not.toHaveBeenCalled()
    h.unmount()
  })

  it('keeps the legacy ladder for a row that names no content', async () => {
    const m = await modules()
    const h = renderHook(() => m.useObjectImage('legacy-object', identity))

    await waitFor(() => expect(m.orbitFetch).toHaveBeenCalled())
    expect(m.orbitFetch).toHaveBeenCalledWith('/api/objects/legacy-object', { method: 'GET' }, identity)
    h.unmount()
  })

  it('ignores a contentHash that is not a digest and falls back to the node', async () => {
    const m = await modules()
    const h = renderHook(() => m.useObjectImage('legacy-object-2', identity, { contentHash: 'not-a-hash' }))

    await waitFor(() => expect(m.orbitFetch).toHaveBeenCalled())
    expect(m.requestSwarmObject).not.toHaveBeenCalledWith('not-a-hash', expect.anything(), expect.anything())
    h.unmount()
  })
})