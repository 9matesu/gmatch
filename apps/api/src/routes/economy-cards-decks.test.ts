import { describe, it, expect, beforeEach } from 'vitest'
import app from '../index'
import { createTestIdentity, signRequestHeaders, createMockEnv } from '../test-utils'
import { EconomyService } from '../economy'
import type { D1Turso } from '../db'

function authHeaders(identity: ReturnType<typeof createTestIdentity>, method: string, url: string, body?: string) {
  return signRequestHeaders(identity, method, url, body)
}

async function seedMedia(db: D1Turso, id: string, owner: string) {
  await db.prepare('INSERT INTO Objects (id, owner_id, size_bytes, mime_type) VALUES (?, ?, ?, ?)').bind(id, owner, 1000, 'image/jpeg').run()
}

describe('economy/cards/decks route wiring', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>
  const alice = createTestIdentity()
  const bob = createTestIdentity()

  beforeEach(async () => {
    env = await createMockEnv()
    await app.request('/api/users', { headers: authHeaders(alice, 'GET', '/api/users') }, env)
    await app.request('/api/users', { headers: authHeaders(bob, 'GET', '/api/users') }, env)
  })

  it('GET /api/economy/balance returns wallet balance', async () => {
    const economy = new EconomyService(env.DB)
    await economy.credit(alice.orbitId, 500, { idempotencyKey: 'seed-balance-01', kind: 'grant' })

    const res = await app.request('/api/economy/balance', { headers: authHeaders(alice, 'GET', '/api/economy/balance') }, env)
    expect(res.status).toBe(200)
    const data: any = await res.json()
    expect(data.balance).toBe(500)
  })

  it('POST /api/economy/transfer moves g$ atomically', async () => {
    const economy = new EconomyService(env.DB)
    await economy.credit(alice.orbitId, 500, { idempotencyKey: 'seed-balance-02', kind: 'grant' })

    const body = JSON.stringify({ to_user_id: bob.orbitId, amount: 200, idempotency_key: 'transfer-route-1' })
    const res = await app.request('/api/economy/transfer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(alice, 'POST', '/api/economy/transfer', body) },
      body,
    }, env)
    expect(res.status).toBe(200)
    const data: any = await res.json()
    expect(data.fromBalance).toBe(300)
    expect(data.toBalance).toBe(200)
  })

  it('cards: create → list → buy through the API', async () => {
    await seedMedia(env.DB, 'media-route-1', alice.orbitId)
    const createBody = JSON.stringify({ media_object_id: 'media-route-1', name: 'Route Card' })
    const createRes = await app.request('/api/cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(alice, 'POST', '/api/cards', createBody) },
      body: createBody,
    }, env)
    expect(createRes.status).toBe(201)
    const created: any = await createRes.json()
    const cardId = created.card.id

    const listBody = JSON.stringify({ price: 100 })
    const listRes = await app.request(`/api/cards/${cardId}/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(alice, 'POST', `/api/cards/${cardId}/list`, listBody) },
      body: listBody,
    }, env)
    expect(listRes.status).toBe(200)

    const economy = new EconomyService(env.DB)
    await economy.credit(bob.orbitId, 1000, { idempotencyKey: 'seed-buyer-route', kind: 'grant' })

    const buyBody = JSON.stringify({ idempotency_key: 'buy-route-0001' })
    const buyRes = await app.request(`/api/cards/${cardId}/buy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(bob, 'POST', `/api/cards/${cardId}/buy`, buyBody) },
      body: buyBody,
    }, env)
    expect(buyRes.status).toBe(200)
    const buy: any = await buyRes.json()
    expect(buy.buyerId).toBe(bob.orbitId)

    // seller gets a 'card_purchase' notification (Instagram-style activity feed)
    const notifs = await env.DB.prepare("SELECT type, user_id FROM Notifications WHERE type = 'card_purchase'").all<any>()
    expect(notifs.results.length).toBe(1)
    expect(notifs.results[0].user_id).toBe(alice.orbitId)

    await expect(economy.getBalance(bob.orbitId)).resolves.toBe(900)
  })

  it('cards: transfer/gift card moves ownership and creates card_received notification for recipient', async () => {
    await env.DB.prepare("UPDATE Users SET display_name = 'Alice' WHERE id = ?").bind(alice.orbitId).run()
    await seedMedia(env.DB, 'media-gift-1', alice.orbitId)
    const createBody = JSON.stringify({ media_object_id: 'media-gift-1', name: 'Gift Card', tags: ['gift', 'rare'] })
    const createRes = await app.request('/api/cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(alice, 'POST', '/api/cards', createBody) },
      body: createBody,
    }, env)
    expect(createRes.status).toBe(201)
    const created: any = await createRes.json()
    const cardId = created.card.id

    const transferBody = JSON.stringify({ to_user_id: bob.orbitId })
    const transferRes = await app.request(`/api/cards/${cardId}/transfer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(alice, 'POST', `/api/cards/${cardId}/transfer`, transferBody) },
      body: transferBody,
    }, env)
    expect(transferRes.status).toBe(200)
    const transferData: any = await transferRes.json()
    expect(transferData.card.ownerId).toBe(bob.orbitId)
    expect(transferData.card.name).toBe('Gift Card')
    expect(transferData.card.tags).toEqual(['gift', 'rare'])

    // Recipient receives 'card_received' notification
    const giftNotifs = await env.DB.prepare("SELECT type, user_id, title FROM Notifications WHERE type = 'card_received'").all<any>()
    expect(giftNotifs.results.length).toBe(1)
    expect(giftNotifs.results[0].user_id).toBe(bob.orbitId)
    expect(giftNotifs.results[0].title).toContain('Alice')
  })

  it('POST /api/decks/:id/validate rejects a deck owned by another user', async () => {
    const body = JSON.stringify({ name: 'Alice Deck', game_id: 'card-duel' })
    const createRes = await app.request('/api/decks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(alice, 'POST', '/api/decks', body) },
      body,
    }, env)
    expect(createRes.status).toBe(201)
    const { deck } = await createRes.json() as any

    const vPath = `/api/decks/${deck.id}/validate`
    const vBody = JSON.stringify({})
    const res = await app.request(vPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(bob, 'POST', vPath, vBody) },
      body: vBody,
    }, env)
    expect(res.status).toBe(404)
  })
})

describe('store purchase uses the g$ wallet', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>
  const user = createTestIdentity()

  beforeEach(async () => {
    env = await createMockEnv()
    await app.request('/api/users', { headers: authHeaders(user, 'GET', '/api/users') }, env)
  })

  it('requires an Idempotency-Key', async () => {
    const body = JSON.stringify({ item_id: 'item-pack-rare' })
    const res = await app.request('/api/users/store/purchase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(user, 'POST', '/api/users/store/purchase', body) },
      body,
    }, env)
    expect(res.status).toBe(400)
  })

  it('rejects purchase with an empty wallet', async () => {
    const body = JSON.stringify({ item_id: 'item-pack-rare', idempotency_key: 'store-purchase-01' })
    const res = await app.request('/api/users/store/purchase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(user, 'POST', '/api/users/store/purchase', body) },
      body,
    }, env)
    expect(res.status).toBe(409)
  })

  it('debits g$, grants inventory atomically, and replays idempotently', async () => {
    const economy = new EconomyService(env.DB)
    await economy.credit(user.orbitId, 1000, { idempotencyKey: 'seed-store-funds', kind: 'grant' })

    const body = JSON.stringify({ item_id: 'item-pack-rare', idempotency_key: 'store-purchase-02' })
    const res = await app.request('/api/users/store/purchase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(user, 'POST', '/api/users/store/purchase', body) },
      body,
    }, env)
    expect(res.status).toBe(200)
    const data: any = await res.json()
    expect(data.balance).toBe(750)

    const inv = await env.DB.prepare('SELECT quantity FROM UserInventory WHERE user_id = ? AND item_id = ?').bind(user.orbitId, 'item-pack-rare').first<{ quantity: number }>()
    expect(Number(inv?.quantity || 0)).toBe(1)

    // Replay: no double-charge, no double-grant.
    const replay = await app.request('/api/users/store/purchase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(user, 'POST', '/api/users/store/purchase', body) },
      body,
    }, env)
    expect(replay.status).toBe(200)
    const replayData: any = await replay.json()
    expect(replayData.replayed).toBe(true)

    await expect(economy.getBalance(user.orbitId)).resolves.toBe(750)
    const invAfter = await env.DB.prepare('SELECT quantity FROM UserInventory WHERE user_id = ? AND item_id = ?').bind(user.orbitId, 'item-pack-rare').first<{ quantity: number }>()
    expect(Number(invAfter?.quantity || 0)).toBe(1)
  })

  it('rejects a hack against an offline target', async () => {
    const economy = new EconomyService(env.DB)
    await economy.credit(user.orbitId, 1000, { idempotencyKey: 'seed-hack-funds-01', kind: 'grant' })

    const target = createTestIdentity()
    await app.request('/api/users', { headers: authHeaders(target, 'GET', '/api/users') }, env)
    // Age the target's last_seen beyond the 60s online window.
    const stale = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    await env.DB.prepare('UPDATE Users SET last_seen = ? WHERE id = ?').bind(stale, target.orbitId).run()

    const body = JSON.stringify({ item_id: 'item-hack-deny', target_id: target.orbitId, idempotency_key: 'hack-offline-01' })
    const res = await app.request('/api/users/store/purchase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(user, 'POST', '/api/users/store/purchase', body) },
      body,
    }, env)
    expect(res.status).toBe(409)
    const data: any = await res.json()
    expect(data.error).toContain('not online')

    // Balance must not be debited for a rejected hack.
    await expect(economy.getBalance(user.orbitId)).resolves.toBe(1000)
  })

  it('grants a flash drop inventory charge without a target (broadcast, not debuff)', async () => {
    const economy = new EconomyService(env.DB)
    await economy.credit(user.orbitId, 1000, { idempotencyKey: 'seed-flash-funds-01', kind: 'grant' })

    const body = JSON.stringify({ item_id: 'item-flash-drop', idempotency_key: 'flash-purchase-01' })
    const res = await app.request('/api/users/store/purchase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(user, 'POST', '/api/users/store/purchase', body) },
      body,
    }, env)
    expect(res.status).toBe(200)
    const data: any = await res.json()
    expect(data.balance).toBe(0)

    const inv = await env.DB.prepare('SELECT quantity FROM UserInventory WHERE user_id = ? AND item_id = ?').bind(user.orbitId, 'item-flash-drop').first<{ quantity: number }>()
    expect(Number(inv?.quantity || 0)).toBe(1)

    // No hack debuff should exist (flash-drop is not a targeted debuff).
    const hacks = await app.request('/api/users/hacks/active', { headers: authHeaders(user, 'GET', '/api/users/hacks/active') }, env)
    const hackData: any = await hacks.json()
    expect(hackData.active_hacks).toHaveLength(0)
  })

  it('allows a hack against an online target and registers the debuff', async () => {
    const economy = new EconomyService(env.DB)
    await economy.credit(user.orbitId, 1000, { idempotencyKey: 'seed-hack-funds-02', kind: 'grant' })

    const target = createTestIdentity()
    await app.request('/api/users', { headers: authHeaders(target, 'GET', '/api/users') }, env)
    // hacks only land on players who opted in (allowHacks)
    await env.DB.prepare('UPDATE Users SET pc_domination_settings = ? WHERE id = ?')
      .bind(JSON.stringify({ allowHacks: true }), target.orbitId).run()

    const body = JSON.stringify({ item_id: 'item-hack-deny', target_id: target.orbitId, idempotency_key: 'hack-online-01' })
    const res = await app.request('/api/users/store/purchase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(user, 'POST', '/api/users/store/purchase', body) },
      body,
    }, env)
    expect(res.status).toBe(200)

    const hacks = await app.request('/api/users/hacks/active', { headers: authHeaders(target, 'GET', '/api/users/hacks/active') }, env)
    const hackData: any = await hacks.json()
    const mine = (hackData.active_hacks || []).filter((h: any) => h.type === 'deny' && h.attacker_id === user.orbitId)
    expect(mine.length).toBe(1)
  })
})

describe('authorization gates', () => {
  it('POST /api/moderation/simulated-reward rejects non-moderators', async () => {
    const env = await createMockEnv()
    const user = createTestIdentity()
    await app.request('/api/users', { headers: authHeaders(user, 'GET', '/api/users') }, env)

    const body = JSON.stringify({ target_post_id: 'whatever-post', likes_count: 1 })
    const res = await app.request('/api/moderation/simulated-reward', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(user, 'POST', '/api/moderation/simulated-reward', body) },
      body,
    }, env)
    expect(res.status).toBe(403)
  })

  it('PUT /api/starter-deck/settings rejects non-admins', async () => {
    const env = await createMockEnv()
    const user = createTestIdentity()
    await app.request('/api/users', { headers: authHeaders(user, 'GET', '/api/users') }, env)

    const body = JSON.stringify({ provider_id: 'x', tags: 'y' })
    const res = await app.request('/api/starter-deck/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders(user, 'PUT', '/api/starter-deck/settings', body) },
      body,
    }, env)
    expect(res.status).toBe(403)
  })
})
