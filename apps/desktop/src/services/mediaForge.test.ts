import { describe, it, expect, vi, beforeEach } from 'vitest'
import { hashFileSha256, forgeMediaLocally, httpUrlOrUndefined } from './mediaForge'
import { listOutbox } from './postOutbox'

const mem = new Map<string, string>()
const storageStub = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, v) },
  removeItem: (k: string) => { mem.delete(k) },
  clear: () => { mem.clear() },
}

beforeEach(() => {
  mem.clear()
  vi.stubGlobal('localStorage', storageStub)
})

describe('mediaForge durable publish (Phase 3)', () => {
  it('offline: durable forge does not throw, commits locally, queues outbox', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const identity = { orbitId: 'u1', publicKeyHex: 'a'.repeat(64), privateKeyHex: 'b'.repeat(64) }
    const file = new File(['bytes'], 'p.jpg', { type: 'image/jpeg' })
    const forged = await forgeMediaLocally(file, identity as any, { isPublic: true, durable: true })
    expect(forged.id).toBeDefined()
    const entries = listOutbox()
    expect(entries).toHaveLength(1)
    expect(entries[0].objectId).toBe(forged.id)
    expect(entries[0].state).toBe('local')
    expect(entries[0].gossipInput).not.toBeNull()
    const { getLocalObject } = await import('../utils/p2pSwarm')
    expect(await getLocalObject(forged.id)).not.toBeNull()
  })
})

describe('mediaForge (local-first seeding)', () => {
  it('computes SHA-256 hex digest of a blob using Web Crypto', async () => {
    const text = 'hello world zero media'
    const blob = new Blob([text], { type: 'text/plain' })
    const hash = await hashFileSha256(blob)
    expect(hash).toHaveLength(64)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('pins file locally and registers metadata via /api/objects/register without uploading binary', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'card-obj-456', content_hash: 'abc', magnet_uri: 'magnet:?xt=urn:btih:abc' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const identity = {
      orbitId: 'test-user-id',
      publicKeyHex: 'a'.repeat(64),
      privateKeyHex: 'b'.repeat(64),
      encryptionPubHex: 'c'.repeat(64),
      encryptionPrivHex: 'd'.repeat(64),
    }

    const file = new File(['fake-image-bytes'], 'card.jpg', { type: 'image/jpeg' })
    const result = await forgeMediaLocally(file, identity as any)

    expect(result.id).toBeDefined()
    expect(result.contentHash).toHaveLength(64)
    expect(result.sizeBytes).toBe(file.size)
    expect(result.mimeType).toBe('image/jpeg')

    // Verify /api/objects/register was called with JSON body, NOT FormData binary
    const registerCall = fetchMock.mock.calls.find(([url]) => url.includes('/api/objects/register'))
    expect(registerCall).toBeDefined()
    const [, callInit] = registerCall!
    const headers = callInit.headers instanceof Headers ? callInit.headers : new Headers(callInit.headers)
    expect(headers.get('content-type')).toBe('application/json')
    const parsedBody = JSON.parse(callInit.body)
    expect(parsedBody.content_hash).toBe(result.contentHash)
    expect(parsedBody.size_bytes).toBe(file.size)

    // Verify local swarm registration occurred
    const { getLocalObject } = await import('../utils/p2pSwarm')
    const stored = await getLocalObject(result.id)
    expect(stored).not.toBeNull()
    expect(stored?.size).toBe(file.size)
  })
})

describe('mediaForge content_url guard (no Invalid URL format)', () => {
  it('keeps only http(s) urls', () => {
    expect(httpUrlOrUndefined('https://cdn.test/x.jpg')).toBe('https://cdn.test/x.jpg')
    expect(httpUrlOrUndefined('http://cdn.test/x.jpg')).toBe('http://cdn.test/x.jpg')
    // Descriptors / local schemes the node's URL field rejects:
    expect(httpUrlOrUndefined('vault://f/' + 'a'.repeat(64))).toBeUndefined()
    expect(httpUrlOrUndefined('magnet:?xt=urn:btih:abc')).toBeUndefined()
    expect(httpUrlOrUndefined('urn:sha256:abc')).toBeUndefined()
    expect(httpUrlOrUndefined('/api/objects/abc')).toBeUndefined()
    expect(httpUrlOrUndefined('   ')).toBeUndefined()
    expect(httpUrlOrUndefined(null)).toBeUndefined()
  })

  it('omits a descriptor content_url from the register payload (no 400)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'x', content_hash: 'abc', magnet_uri: 'magnet:?xt=urn:btih:abc' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const identity = { orbitId: 'u', publicKeyHex: 'a'.repeat(64), privateKeyHex: 'b'.repeat(64) }
    const file = new File(['bytes'], 'p.jpg', { type: 'image/jpeg' })
    await forgeMediaLocally(file, identity as any, { contentUrl: 'vault://f/' + 'a'.repeat(64) })
    const call = fetchMock.mock.calls.find(([url]) => url.includes('/api/objects/register'))
    const body = JSON.parse(call![1].body)
    expect(body.content_url).toBeUndefined()
    expect(body.source_url).toBeUndefined()
  })

  it('forwards an http content_url', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'x', content_hash: 'abc', magnet_uri: 'magnet:?xt=urn:btih:abc' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const identity = { orbitId: 'u', publicKeyHex: 'a'.repeat(64), privateKeyHex: 'b'.repeat(64) }
    const file = new File(['bytes'], 'p.jpg', { type: 'image/jpeg' })
    await forgeMediaLocally(file, identity as any, { contentUrl: 'https://cdn.test/x.jpg' })
    const call = fetchMock.mock.calls.find(([url]) => url.includes('/api/objects/register'))
    const body = JSON.parse(call![1].body)
    expect(body.content_url).toBe('https://cdn.test/x.jpg')
  })
})
