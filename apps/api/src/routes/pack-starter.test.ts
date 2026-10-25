import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import app from '../index'
import { createTestIdentity, signRequestHeaders, createMockEnv } from '../test-utils'
import { CardService } from '../cards'
import { saveBotConfig } from '../bot-image-api'

function authHeaders(identity: ReturnType<typeof createTestIdentity>, method: string, url: string, body?: string) {
  return signRequestHeaders(identity, method, url, body)
}

async function grantPack(db: any, userId: string, itemId: string, qty: number) {
  await db
    .prepare('INSERT INTO UserInventory (user_id, item_id, quantity) VALUES (?, ?, ?) ON CONFLICT(user_id, item_id) DO UPDATE SET quantity = quantity + ?')
    .bind(userId, itemId, qty, qty)
    .run()
}

describe('open-pack canonical mint', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>
  const user = createTestIdentity()

  beforeEach(async () => {
    env = await createMockEnv()
    await app.request('/api/users', { headers: authHeaders(user, 'GET', '/api/users') }, env)
  })

  it('mints canonical cards and decrements inventory atomically', async () => {
    await grantPack(env.DB, user.orbitId, 'item-pack-rare', 1)
    const body = JSON.stringify({ item_id: 'item-pack-rare', idempotency_key: 'open-pack-0001' })
    const res = await app.request('/api/users/store/open-pack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(user, 'POST', '/api/users/store/open-pack', body) },
      body,
    }, env)
    expect(res.status).toBe(200)
    const data: any = await res.json()
    expect(data.cards).toHaveLength(3)

    const inv = await env.DB.prepare('SELECT quantity FROM UserInventory WHERE user_id = ? AND item_id = ?').bind(user.orbitId, 'item-pack-rare').first<{ quantity: number }>()
    expect(Number(inv?.quantity || 0)).toBe(0)

    const collection = await new CardService(env.DB).getCollection(user.orbitId)
    expect(collection).toHaveLength(3)
  })

  it('replays idempotently without double-minting or double-decrement', async () => {
    await grantPack(env.DB, user.orbitId, 'item-pack-rare', 2)
    const body = JSON.stringify({ item_id: 'item-pack-rare', idempotency_key: 'open-pack-0002' })
    const headers = { 'Content-Type': 'application/json', ...authHeaders(user, 'POST', '/api/users/store/open-pack', body) }

    const res1 = await app.request('/api/users/store/open-pack', { method: 'POST', headers, body }, env)
    const res2 = await app.request('/api/users/store/open-pack', { method: 'POST', headers, body }, env)
    const d1: any = await res1.json()
    const d2: any = await res2.json()

    expect(d2.cards.map((c: any) => c.id)).toEqual(d1.cards.map((c: any) => c.id))

    const inv = await env.DB.prepare('SELECT quantity FROM UserInventory WHERE user_id = ? AND item_id = ?').bind(user.orbitId, 'item-pack-rare').first<{ quantity: number }>()
    expect(Number(inv?.quantity || 0)).toBe(1)

    const collection = await new CardService(env.DB).getCollection(user.orbitId)
    expect(collection).toHaveLength(3)
  })

  it('rejects opening a pack the user does not own and mints nothing', async () => {
    const body = JSON.stringify({ item_id: 'item-pack-rare', idempotency_key: 'open-pack-0003' })
    const res = await app.request('/api/users/store/open-pack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(user, 'POST', '/api/users/store/open-pack', body) },
      body,
    }, env)
    expect(res.status).toBe(400)

    const collection = await new CardService(env.DB).getCollection(user.orbitId)
    expect(collection).toHaveLength(0)
  })

  it('rejects an unknown pack id', async () => {
    const body = JSON.stringify({ item_id: 'item-pack-nope', idempotency_key: 'open-pack-0004' })
    const res = await app.request('/api/users/store/open-pack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(user, 'POST', '/api/users/store/open-pack', body) },
      body,
    }, env)
    expect(res.status).toBe(400)
  })
})

describe('starter-deck canonical init', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>
  const user = createTestIdentity()
  const provider = {
    id: 'prov_rule34',
    name: 'Test booru',
    providerType: 'dapi',
    url: 'https://booru.test/posts',
    apiKey: '',
    userId: '',
    customHeaders: {},
    tags: ['highres'],
    enabled: true,
    weight: 10,
  }

  beforeEach(async () => {
    env = await createMockEnv()
    await app.request('/api/users', { headers: authHeaders(user, 'GET', '/api/users') }, env)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('mints 5 cards from the configured provider and replays idempotently', async () => {
    await saveBotConfig(env.DB, { providers: [provider] })
    const payload = Array.from({ length: 5 }, (_, i) => ({
      file_url: `https://img.test/starter-${i}.jpg`,
      tags: 'highres, 1girl',
    }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => payload,
    }))

    const headers = authHeaders(user, 'POST', '/api/starter-deck/init', '')
    const res = await app.request('/api/starter-deck/init', { method: 'POST', headers }, env)
    expect(res.status).toBe(200)
    const data: any = await res.json()
    expect(data.cards_created).toBe(5)
    expect(data.cards.every((c: any) => c.content_url.startsWith('https://img.test/'))).toBe(true)

    const replay = await app.request('/api/starter-deck/init', { method: 'POST', headers }, env)
    expect(replay.status).toBe(200)
    const replayData: any = await replay.json()
    expect(replayData.replayed).toBe(true)

    const collection = await new CardService(env.DB).getCollection(user.orbitId)
    expect(collection).toHaveLength(5)
  })

  it('mints nothing (and never a placeholder deck) when no provider is configured', async () => {
    const headers = authHeaders(user, 'POST', '/api/starter-deck/init', '')
    const res = await app.request('/api/starter-deck/init', { method: 'POST', headers }, env)
    expect(res.status).toBe(409)
    const data: any = await res.json()
    expect(data.error).toMatch(/provider/i)

    const collection = await new CardService(env.DB).getCollection(user.orbitId)
    expect(collection).toHaveLength(0)
  })
})
