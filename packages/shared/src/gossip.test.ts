import { describe, it, expect } from 'vitest'
import {
  stableStringify,
  gossipSigningMessage,
  gossipWellFormed,
  MAX_GOSSIP_TTL_DAYS,
  type GossipEnvelope,
} from './gossip'

function validEnvelope(): GossipEnvelope {
  const payload = {
    id: 'e66d0889-8c2a-4bd3-84d5-a7a29273db0f',
    owner_id: 'author-1',
    author_pubkey: 'a'.repeat(64),
    author_name: 'Poster',
    mime_type: 'image/jpeg',
    size_bytes: 1234,
    content_url: 'magnet:?xt=urn:btih:abc',
    caption: 'hi',
    location: null,
    post_tags: 'a, b',
    post_group: null,
    content_hash: 'b'.repeat(64),
    created_at: '2026-09-19T00:00:00.000Z',
  }
  return {
    kind: 'post',
    id: payload.id,
    author_id: payload.owner_id,
    payload,
    sig: 'c'.repeat(128),
  }
}

describe('gossip envelopes (self-hosting relay)', () => {
  it('stableStringify is key-order independent', () => {
    const a = stableStringify({ z: 1, a: { d: [3, 2], b: 'x' } })
    const b = stableStringify({ a: { b: 'x', d: [3, 2] }, z: 1 })
    expect(a).toBe(b)
    // Arrays keep order (chunk order matters), undefined drops like JSON.
    expect(stableStringify({ a: [2, 1], u: undefined })).toBe('{"a":[2,1]}')
  })

  it('signing message pins domain, author, and canonical payload', () => {
    const env = validEnvelope()
    const msg = new TextDecoder().decode(gossipSigningMessage(env.payload))
    expect(msg.startsWith('gossip-v1|author-1|')).toBe(true)
    expect(msg).toContain('"content_url":"magnet:?xt=urn:btih:abc"')
    // Mutating any signed field changes the message.
    const tampered = { ...env.payload, caption: 'evil' }
    expect(new TextDecoder().decode(gossipSigningMessage(tampered)) === msg).toBe(false)
  })

  it('accepts a well-formed public-post envelope', () => {
    expect(gossipWellFormed(validEnvelope())).toBeNull()
  })

  it('rejects malformed envelopes without inspecting content', () => {
    const base = validEnvelope()
    expect(gossipWellFormed(null)).toBeTruthy()
    expect(gossipWellFormed({ ...base, kind: 'dm' })).toBeTruthy()
    expect(gossipWellFormed({ ...base, id: 'x', payload: { ...base.payload, id: 'x' } })).toBeTruthy()
    expect(gossipWellFormed({ ...base, author_id: 'other' })).toBeTruthy()
    expect(gossipWellFormed({ ...base, sig: 'zz' })).toBeTruthy()
    expect(gossipWellFormed({ ...base, payload: { ...base.payload, author_pubkey: 'nope' } })).toBeTruthy()
    expect(gossipWellFormed({ ...base, payload: { ...base.payload, content_url: '' } })).toBeTruthy()
    expect(gossipWellFormed({ ...base, payload: { ...base.payload, created_at: 'yesterday' } })).toBeTruthy()
    expect(gossipWellFormed({ ...base, ttl_days: MAX_GOSSIP_TTL_DAYS + 1 })).toBeTruthy()
    expect(
      gossipWellFormed({ ...base, payload: { ...base.payload, caption: 'x'.repeat(1001) } }),
    ).toBeTruthy()
  })
})
