import { describe, it, expect, beforeEach } from 'vitest'
import app from '../index'
import { createMockEnv, createTestIdentity, signRequestHeaders } from '../test-utils'
import { signMessage, bytesToHex } from '@orbit/crypto'
import {
  gossipSigningMessage,
  type GossipEnvelope,
  type GossipPostPayload,
} from '@orbit/shared'
import { pullGossipUpstream } from '../gossip-pull'

// Phase 2: replicating a post (gossip ingest, incl. retries/repulls) must
// never create cards and never duplicate objects.
describe('Gossip ingest entity boundaries', () => {
  let env: any

  beforeEach(async () => {
    env = await createMockEnv()
  })

  function payloadFor(
    identity: ReturnType<typeof createTestIdentity>,
    overrides: Partial<GossipPostPayload> = {},
  ): GossipPostPayload {
    return {
      id: 'a11ce000-0000-4000-8000-000000000001',
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
      content_hash: 'c'.repeat(64),
      created_at: '2026-09-19T00:00:00.000Z',
      ...overrides,
    }
  }

  function signEnvelope(
    identity: ReturnType<typeof createTestIdentity>,
    payload: GossipPostPayload,
  ): GossipEnvelope {
    const sig = bytesToHex(signMessage(gossipSigningMessage(payload), identity.privateKeyHex))
    return {
      kind: 'post',
      id: payload.id,
      author_id: payload.owner_id,
      payload,
      sig,
      origin_node: 'test-node',
    }
  }

  async function postEnvelope(identity: ReturnType<typeof createTestIdentity>, e: GossipEnvelope) {
    const path = '/api/gossip/envelopes'
    const bodyStr = JSON.stringify(e)
    const headers = signRequestHeaders(identity, 'POST', path, bodyStr)
    headers['Content-Type'] = 'application/json'
    return app.request(path, { method: 'POST', headers, body: bodyStr }, env)
  }

  async function counts(targetEnv: any) {
    const objects = (await targetEnv.DB.prepare('SELECT COUNT(*) AS n FROM Objects').first()) as any
    const cards = (await targetEnv.DB.prepare('SELECT COUNT(*) AS n FROM Cards').first()) as any
    const ownership = (await targetEnv.DB.prepare('SELECT COUNT(*) AS n FROM CardOwnership').first()) as any
    return { objects: objects.n, cards: cards.n, ownership: ownership.n }
  }

  it('replicating a post (post + repull) yields one object and zero cards', async () => {
    const id = createTestIdentity()
    const envelope = signEnvelope(id, payloadFor(id))
    // Retry / redelivery of the same envelope to the upstream.
    expect((await postEnvelope(id, envelope)).status).toBe(200)
    expect((await postEnvelope(id, envelope)).status).toBe(200)

    const hostEnv = await createMockEnv()
    const upstreamFetch = (async (url: string) => {
      const u = new URL(url)
      const res = await app.request(u.pathname + u.search, {}, env)
      return new Response(await res.arrayBuffer(), {
        status: res.status,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as typeof fetch

    const r1 = await pullGossipUpstream(hostEnv.DB, 'https://upstream.test', upstreamFetch)
    expect(r1.applied).toBe(1)
    // Second pull replays nothing (cursor + INSERT OR IGNORE).
    const r2 = await pullGossipUpstream(hostEnv.DB, 'https://upstream.test', upstreamFetch)
    expect(r2.applied).toBe(0)
    expect(await counts(hostEnv)).toEqual({ objects: 1, cards: 0, ownership: 0 })
    expect(await counts(env)).toEqual({ objects: 0, cards: 0, ownership: 0 })
  })
})
