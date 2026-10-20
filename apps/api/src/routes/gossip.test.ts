import { describe, it, expect, beforeEach } from 'vitest'
import app from '../index'
import { createMockEnv, createTestIdentity, signRequestHeaders } from '../test-utils'
import { signMessage, bytesToHex } from '@orbit/crypto'
import {
  gossipSigningMessage,
  type GossipEnvelope,
  type GossipPostPayload,
} from '@orbit/shared'
import { conns } from '../ws-bus'
import { pullGossipUpstream } from '../gossip-pull'

// Plan G1 (self-hosting relay): signed public-post envelopes replicate
// node-to-node through a blind relay; offline hosts catch up via pull.
describe('Gossip relay (self-hosting posts)', () => {
  let env: any

  beforeEach(async () => {
    env = await createMockEnv()
    conns.clear()
  })

  function payloadFor(
    identity: ReturnType<typeof createTestIdentity>,
    overrides: Partial<GossipPostPayload> = {},
  ): GossipPostPayload {
    return {
      id: 'e66d0889-8c2a-4bd3-84d5-a7a29273db0f',
      owner_id: identity.orbitId,
      author_pubkey: identity.publicKeyHex,
      author_name: 'Gossiper',
      mime_type: 'image/jpeg',
      size_bytes: 4321,
      content_url: 'magnet:?xt=urn:btih:abcdef',
      caption: 'federated hello',
      location: null,
      post_tags: 'art, test',
      post_group: null,
      content_hash: 'b'.repeat(64),
      created_at: '2026-09-19T00:00:00.000Z',
      ...overrides,
    }
  }

  function signEnvelope(
    identity: ReturnType<typeof createTestIdentity>,
    payload: GossipPostPayload,
    extra: Partial<GossipEnvelope> = {},
  ): GossipEnvelope {
    const sig = bytesToHex(signMessage(gossipSigningMessage(payload), identity.privateKeyHex))
    return {
      kind: 'post',
      id: payload.id,
      author_id: payload.owner_id,
      payload,
      sig,
      origin_node: 'test-node',
      ...extra,
    }
  }

  async function postEnvelopeOn(
    targetEnv: any,
    identity: ReturnType<typeof createTestIdentity>,
    env: GossipEnvelope,
  ) {
    const path = '/api/gossip/envelopes'
    const bodyStr = JSON.stringify(env)
    const headers = signRequestHeaders(identity, 'POST', path, bodyStr)
    headers['Content-Type'] = 'application/json'
    return app.request(path, { method: 'POST', headers, body: bodyStr }, targetEnv)
  }

  it('stores a valid signed envelope, idempotent on retry', async () => {
    const id = createTestIdentity()
    const envelope = signEnvelope(id, payloadFor(id))
    const r1 = await postEnvelopeOn(env, id, envelope)
    expect(r1.status).toBe(200)
    expect(((await r1.json()) as any).deduped).toBe(false)
    const r2 = await postEnvelopeOn(env, id, envelope)
    expect(r2.status).toBe(200)
    expect(((await r2.json()) as any).deduped).toBe(true)
    conns.clear()
  })

  it('rejects forged signatures and foreign authors', async () => {
    const id = createTestIdentity()
    const other = createTestIdentity()
    const good = payloadFor(id)
    // Tampered caption, original sig.
    const tampered = signEnvelope(id, good)
    tampered.payload = { ...good, caption: 'evil edit' }
    const r1 = await postEnvelopeOn(env, id, tampered)
    expect(r1.status).toBe(401)
    // Claiming another author.
    const stolen = signEnvelope(id, payloadFor(other))
    const r2 = await postEnvelopeOn(env, id, stolen)
    expect(r2.status).toBe(403)
    conns.clear()
  })

  it('rejects envelopes whose claimed author id is not the signing key identity', async () => {
    const signer = createTestIdentity()
    const claimedId = createTestIdentity()
    const payload = payloadFor(signer, { owner_id: claimedId.orbitId })
    const envelope = signEnvelope(signer, payload)
    envelope.author_id = claimedId.orbitId
    const response = await postEnvelopeOn(env, claimedId, envelope)
    expect(response.status).toBe(403)
    conns.clear()
  })

  it('accepts any tags verbatim (filtering is client-side only)', async () => {
    const id = createTestIdentity()
    const envelope = signEnvelope(id, payloadFor(id, { post_tags: 'art, loli' }))
    const res = await postEnvelopeOn(env, id, envelope)
    expect(res.status).toBe(200)
    conns.clear()
  })

  it('serves envelopes via public pull with cursor pagination + expiry sweep', async () => {
    const id = createTestIdentity()
    const e1 = signEnvelope(id, payloadFor(id))
    const e2 = signEnvelope(id, payloadFor(id, {
      id: 'f77e1999-9d3b-5ce4-95e6-b8b30384ec10',
      caption: 'second',
      created_at: '2026-09-19T00:00:01.000Z',
    }))
    expect((await postEnvelopeOn(env, id, e1)).status).toBe(200)
    expect((await postEnvelopeOn(env, id, e2)).status).toBe(200)
    // Plant an expired envelope straight into the store.
    await env.DB.prepare(
      `INSERT INTO GossipEnvelopes (id, author_id, author_pubkey, kind, payload, sig, created_at, expires_at)
       VALUES ('dead-beef-1', ?, ?, 'post', '{}', ?, '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z')`,
    ).bind(id.orbitId, id.publicKeyHex, 'd'.repeat(128)).run()

    const p1 = await app.request('/api/gossip/since?limit=1', {}, env)
    expect(p1.status).toBe(200)
    const j1 = (await p1.json()) as any
    expect(j1.envelopes).toHaveLength(1)
    expect(j1.nextCursor).toBeTruthy()
    const p2 = await app.request(`/api/gossip/since?limit=10&cursor=${encodeURIComponent(j1.nextCursor)}`, {}, env)
    const j2 = (await p2.json()) as any
    // Page 1 consumed the oldest (e1); page 2 holds only e2 — no dupes.
    expect(j1.envelopes.map((e: any) => e.id)).toEqual([e1.id])
    expect(j2.envelopes.map((e: any) => e.id)).toEqual([e2.id])
    // Expired row swept, never served.
    expect(j2.envelopes.some((e: any) => e.id === 'dead-beef-1')).toBe(false)
    const gone = await env.DB.prepare("SELECT id FROM GossipEnvelopes WHERE id = 'dead-beef-1'").first()
    expect(gone).toBeNull()
    conns.clear()
  })

  it('host pull applies envelopes into feed-visible rows, then dedupes', async () => {
    const author = createTestIdentity()
    const posted = signEnvelope(author, payloadFor(author))
    await postEnvelopeOn(env, author, posted)

    const hostEnv = await createMockEnv()
    const upstreamFetch = (async (url: string) => {
      const u = new URL(url)
      const upstreamPath = u.pathname + u.search
      const res = await app.request(upstreamPath, {}, env)
      return new Response(await res.arrayBuffer(), {
        status: res.status,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as typeof fetch

    const r1 = await pullGossipUpstream(hostEnv.DB, 'https://upstream.test', upstreamFetch)
    expect(r1).toMatchObject({ applied: 1, duplicates: 0, rejected: 0 })
    // Replicated row renders in the host feed + author stub exists.
    const feedPath = '/api/posts'
    const feed = await app.request(feedPath, {
      headers: signRequestHeaders(author, 'GET', feedPath),
    }, hostEnv)
    expect(feed.status).toBe(200)
    const posts = ((await feed.json()) as any).posts as any[]
    expect(posts.some((p) => p.id === posted.id && p.caption === 'federated hello')).toBe(true)
    const stub = await hostEnv.DB.prepare('SELECT display_name FROM Users WHERE id = ?').bind(author.orbitId).first<any>()
    expect(stub?.display_name).toBe('Gossiper')
    // Second pull advances nothing (cursor), replays dedupe.
    const r2 = await pullGossipUpstream(hostEnv.DB, 'https://upstream.test', upstreamFetch)
    expect(r2.applied).toBe(0)
    conns.clear()
  })

  it('host pull rejects tampered and key-mismatched envelopes', async () => {
    const author = createTestIdentity()
    const good = signEnvelope(author, payloadFor(author))
    const tampered = { ...good, payload: { ...good.payload, caption: 'evil' } }
    const hostEnv = await createMockEnv()
    // Seed a local user with a DIFFERENT key to trip the binding check.
    await hostEnv.DB.prepare('INSERT INTO Users (id, public_key, display_name) VALUES (?, ?, ?)').bind(
      author.orbitId, 'f'.repeat(64), 'Local',
    ).run()
    const fetchFor = (list: GossipEnvelope[]) =>
      (async () => new Response(JSON.stringify({ envelopes: list, nextCursor: null }), {
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch
    const r1 = await pullGossipUpstream(hostEnv.DB, 'https://u.test', fetchFor([tampered]))
    expect(r1.rejected).toBe(1)
    const r2 = await pullGossipUpstream(hostEnv.DB, 'https://u.test', fetchFor([good]))
    expect(r2.rejected).toBe(1)
    expect(r2.applied).toBe(0)
    conns.clear()
  })

  it('host pull rejects a valid signature with an author id unrelated to its key', async () => {
    const signer = createTestIdentity()
    const claimed = createTestIdentity()
    const payload = payloadFor(signer, { owner_id: claimed.orbitId })
    const envelope = signEnvelope(signer, payload)
    envelope.author_id = claimed.orbitId
    const hostEnv = await createMockEnv()
    const fetchFor = (async () => new Response(JSON.stringify({ envelopes: [envelope], nextCursor: null }), {
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch
    const result = await pullGossipUpstream(hostEnv.DB, 'https://u.test', fetchFor)
    expect(result).toMatchObject({ applied: 0, rejected: 1 })
  })
})
