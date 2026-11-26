import { describe, expect, it, vi } from 'vitest'
import { sha256HexBlob } from './p2pSwarm'
import {
  PEER_MEDIA_TIMEOUT_MS,
  isContentHash,
  resolveContentAddressedMedia,
  type ContentAddressedDeps,
} from './contentAddressedMedia'

/**
 * A peer post names its bytes by sha256 (`contentCid`). These tests pin the
 * one rule that makes that address useful: bytes are returned ONLY when they
 * hash to it, whether they came from disk or from a peer, and the node's
 * object route is never consulted.
 */

const BYTES = new Blob(['the peer picture'], { type: 'image/png' })

function deps(overrides: Partial<ContentAddressedDeps> = {}): ContentAddressedDeps & {
  readLocal: ReturnType<typeof vi.fn>
  requestSwarm: ReturnType<typeof vi.fn>
} {
  return {
    readLocal: vi.fn(async () => null),
    requestSwarm: vi.fn(async () => { throw new Error('timeout') }),
    hash: (blob) => sha256HexBlob(blob),
    ...overrides,
  } as ContentAddressedDeps & {
    readLocal: ReturnType<typeof vi.fn>
    requestSwarm: ReturnType<typeof vi.fn>
  }
}

describe('isContentHash', () => {
  it('accepts a sha256 hex digest and nothing else', () => {
    expect(isContentHash('a'.repeat(64))).toBe(true)
    expect(isContentHash('A'.repeat(64))).toBe(true)
    expect(isContentHash('a'.repeat(40))).toBe(false)
    expect(isContentHash('z'.repeat(64))).toBe(false)
    expect(isContentHash(null)).toBe(false)
  })
})

describe('resolveContentAddressedMedia', () => {
  it('serves locally held bytes that hash to the address, without the swarm', async () => {
    const hash = await sha256HexBlob(BYTES)
    const d = deps({
      readLocal: vi.fn(async (id: string) => (id === 'object-1' ? BYTES : null)),
    })

    const got = await resolveContentAddressedMedia('object-1', hash, { deps: d })

    expect(got).toBe(BYTES)
    expect(d.requestSwarm).not.toHaveBeenCalled()
    // The object id alias was tried; the hash key was not needed.
    expect(d.readLocal).toHaveBeenCalledWith('object-1')
    expect(d.readLocal).not.toHaveBeenCalledWith(hash)
  })

  it('finds bytes kept only under the content hash', async () => {
    const hash = await sha256HexBlob(BYTES)
    const d = deps({
      readLocal: vi.fn(async (id: string) => (id === hash ? BYTES : null)),
    })

    expect(await resolveContentAddressedMedia(null, hash, { deps: d })).toBe(BYTES)
    expect(d.requestSwarm).not.toHaveBeenCalled()
  })

  it('never returns local bytes that fail the hash', async () => {
    const hash = await sha256HexBlob(BYTES)
    const d = deps({
      // A stale/corrupt alias: bytes exist, but not the ones addressed.
      readLocal: vi.fn(async () => new Blob(['someone else'])),
    })

    expect(await resolveContentAddressedMedia('object-1', hash, { deps: d })).toBeNull()
    expect(d.requestSwarm).toHaveBeenCalled()
  })

  it('asks the swarm for the content hash with the expectation attached', async () => {
    const hash = await sha256HexBlob(BYTES)
    const d = deps({ requestSwarm: vi.fn(async () => BYTES) })

    expect(await resolveContentAddressedMedia('object-1', hash, { deps: d })).toBe(BYTES)
    expect(d.requestSwarm).toHaveBeenCalledTimes(1)
    expect(d.requestSwarm).toHaveBeenCalledWith(hash, PEER_MEDIA_TIMEOUT_MS, { expectedHash: hash })
  })

  it('falls back to the object-id alias, still verified against the hash', async () => {
    const hash = await sha256HexBlob(BYTES)
    const requestSwarm = vi.fn(async (id: string) => {
      if (id === hash) throw new Error('no seeder under the hash')
      return id === 'object-1' ? BYTES : new Blob(['x'])
    })
    const d = deps({ requestSwarm })

    expect(await resolveContentAddressedMedia('object-1', hash, { deps: d })).toBe(BYTES)
    expect(requestSwarm).toHaveBeenCalledWith(hash, PEER_MEDIA_TIMEOUT_MS, { expectedHash: hash })
    expect(requestSwarm).toHaveBeenCalledWith('object-1', PEER_MEDIA_TIMEOUT_MS, { expectedHash: hash })
  })

  it('reports an honest miss when no peer can prove the bytes', async () => {
    const hash = await sha256HexBlob(BYTES)
    const d = deps()

    expect(await resolveContentAddressedMedia('object-1', hash, { deps: d })).toBeNull()
    expect(d.requestSwarm).toHaveBeenCalledTimes(2)
  })

  it('normalizes the digest to lowercase before every lookup', async () => {
    const hash = await sha256HexBlob(BYTES)
    const d = deps({ requestSwarm: vi.fn(async () => BYTES) })

    await resolveContentAddressedMedia('object-1', hash.toUpperCase(), { deps: d })
    expect(d.requestSwarm).toHaveBeenCalledWith(hash, PEER_MEDIA_TIMEOUT_MS, { expectedHash: hash })
  })

  it('does nothing at all for a value that is not a content hash', async () => {
    const d = deps()
    expect(await resolveContentAddressedMedia('object-1', 'not-a-hash', { deps: d })).toBeNull()
    expect(d.readLocal).not.toHaveBeenCalled()
    expect(d.requestSwarm).not.toHaveBeenCalled()
  })
})