import { describe, it, expect, vi, afterEach } from 'vitest'
import { generateIdentity, verifySignature, hexToBytes } from '@orbit/crypto'
import { gossipSigningMessage } from '@orbit/shared'
import { buildGossipPayload, signGossipPayload, gossipOwnPost } from './gossip'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('gossip client (self-hosting relay)', () => {
  it('builds a well-formed payload from forged upload data', () => {
    const identity = generateIdentity()
    const payload = buildGossipPayload(identity, {
      id: 'e66d0889-8c2a-4bd3-84d5-a7a29273db0f',
      contentHash: 'b'.repeat(64),
      mimeType: 'image/jpeg',
      sizeBytes: 10,
      magnetUri: 'magnet:?xt=urn:btih:abc',
      caption: 'hi',
      tags: 'a',
      postGroup: null,
      authorName: 'Tester',
    })
    expect(payload.owner_id).toBe(identity.orbitId)
    expect(payload.author_pubkey).toBe(identity.publicKeyHex)
    expect(payload.author_name).toBe('Tester')
    expect(payload.content_url).toBe('magnet:?xt=urn:btih:abc')
    // Signature verifies against the author's key (what relays check).
    const sig = signGossipPayload(payload, identity.privateKeyHex)
    expect(
      verifySignature(hexToBytes(sig), gossipSigningMessage(payload), identity.publicKeyHex),
    ).toBe(true)
  })

  it('POSTs the signed envelope to our own node relay, false on failure', async () => {
    const identity = generateIdentity()
    const seen: Array<{ url: string; body: any }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: any, init: any) => {
      seen.push({ url: String(url), body: JSON.parse(init.body) })
      return { ok: true, json: async () => ({ id: 'x', deduped: false }) } as Response
    }))
    const ok = await gossipOwnPost(identity, {
      id: 'e66d0889-8c2a-4bd3-84d5-a7a29273db0f',
      contentHash: 'b'.repeat(64),
      mimeType: 'image/jpeg',
      sizeBytes: 10,
      magnetUri: 'magnet:?xt=urn:btih:abc',
    })
    expect(ok).toBe(true)
    expect(seen).toHaveLength(1)
    expect(seen[0].url).toContain('/api/gossip/envelopes')
    expect(seen[0].body.kind).toBe('post')
    expect(seen[0].body.author_id).toBe(identity.orbitId)

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 }) as Response))
    expect(await gossipOwnPost(identity, {
      id: 'e66d0889-8c2a-4bd3-84d5-a7a29273db0f',
      contentHash: 'b'.repeat(64),
      mimeType: 'image/jpeg',
      sizeBytes: 10,
      magnetUri: 'magnet:?xt=urn:btih:abc',
    })).toBe(false)
  })
})
