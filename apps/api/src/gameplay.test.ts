import { describe, it, expect, beforeEach } from 'vitest'
import app from './index'
import { createMockEnv, createTestIdentity, signRequestHeaders } from './test-utils'
import { EconomyService } from './economy'
import crypto from 'crypto'

// Release-1.0 gate: the connected loops the plan promises, over HTTP.
// Only the legs NOT covered by existing suites (domination victim payout,
// marketplace cancel listing, share-link PM round trip).
function auth(identity: any, method: string, url: string, body?: string) {
  return signRequestHeaders(identity, method, url, body)
}

describe('release loops (P4 gaps)', () => {
  let env: any
  let attacker: any
  let victim: any

  beforeEach(async () => {
    env = await createMockEnv()
    attacker = createTestIdentity()
    victim = createTestIdentity()
    await env.DB.prepare('INSERT INTO Users (id, public_key, display_name) VALUES (?, ?, ?)')
      .bind(attacker.orbitId, attacker.publicKeyHex, 'Attacker').run()
    await env.DB.prepare('INSERT INTO Users (id, public_key, display_name) VALUES (?, ?, ?)')
      .bind(victim.orbitId, victim.publicKeyHex, 'Victim').run()
    // victim consents to blur + enables domination (keys per routes/domination.ts)
    await env.DB.prepare('UPDATE Users SET pc_domination_enabled = 1, pc_domination_settings = ? WHERE id = ?')
      .bind(JSON.stringify({ allowBlurEverything: true }), victim.orbitId).run()
    await new EconomyService(env.DB).credit(attacker.orbitId, 10_000, {
      idempotencyKey: 'seed-attacker-p4', kind: 'grant',
    })
  })

  it('domination action debits attacker AND pays the victim a consent cut', async () => {
    const body = JSON.stringify({ targetId: victim.orbitId, action: 'blur', payload: { intensity: 10, duration: 5000 } })
    const res = await app.request('/api/domination/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(attacker, 'POST', '/api/domination/trigger', body) },
      body,
    }, env)
    expect(res.status).toBe(200)
    const json: any = await res.json()
    expect(json.success).toBe(true)

    const econ = new EconomyService(env.DB)
    const attackerBal = await econ.getBalance(attacker.orbitId)
    const victimBal = await econ.getBalance(victim.orbitId)
    expect(attackerBal).toBeLessThan(10_000) // fee taken
    expect(victimBal).toBeGreaterThan(0)     // payout received
    expect(victimBal).toBeLessThanOrEqual(10_000 - attackerBal) // cut <= fee
  })

  it('broke attacker gets 4xx and nothing is recorded', async () => {
    const body = JSON.stringify({ targetId: victim.orbitId, action: 'blur', payload: { intensity: 10, duration: 5000 } })
    const url = '/api/domination/trigger'
    // drain wallet
    const drain = JSON.stringify({ to_user_id: victim.orbitId, amount: 10_000, idempotency_key: 'drain-' + crypto.randomUUID().slice(0, 10) })
    await app.request('/api/economy/transfer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(attacker, 'POST', '/api/economy/transfer', drain) },
      body: drain,
    }, env)
    const res = await app.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(attacker, 'POST', url, body) },
      body,
    }, env)
    expect(res.status).toBe(402)
    const victimBal = await new EconomyService(env.DB).getBalance(victim.orbitId)
    expect(victimBal).toBe(10_000) // only the transfer landed; no domination payout double
  })

  it('marketplace: cancel listing returns the card to none', async () => {
    const cardId = 'card-cancel-p4'
    const now = new Date().toISOString()
    await env.DB.prepare(
      "INSERT INTO Cards (id, creator_id, media_object_id, name, rarity, value, like_count, market_status, moderation_state, created_at, updated_at) VALUES (?, ?, 'm-1', 'C', 'gold', 500, 0, 'none', 'active', ?, ?)",
    ).bind(cardId, attacker.orbitId, now, now).run()
    await env.DB.prepare('INSERT INTO CardOwnership (card_id, owner_id, acquired_at) VALUES (?, ?, ?)')
      .bind(cardId, attacker.orbitId, now).run()

    const listBody = JSON.stringify({ price: 300 })
    const listRes = await app.request(`/api/cards/${cardId}/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(attacker, 'POST', `/api/cards/${cardId}/list`, listBody) },
      body: listBody,
    }, env)
    expect(listRes.status).toBe(200)
    expect((await listRes.json()).card.marketStatus).toBe('listed')

    const cancelRes = await app.request(`/api/cards/${cardId}/cancel`, {
      method: 'POST',
      headers: auth(attacker, 'POST', `/api/cards/${cardId}/cancel`),
    }, env)
    expect(cancelRes.status).toBe(200)

    const getRes = await app.request(`/api/cards/${cardId}`, {
      headers: auth(attacker, 'GET', `/api/cards/${cardId}`),
    }, env)
    expect((await getRes.json()).card.marketStatus).toBe('none')
  })

  it('share DM round trip: message carrying a /p/<id> link arrives intact', async () => {
    const permalink = 'http://127.0.0.1:8790/p/abc123'
    const body = JSON.stringify({ recipient_id: victim.orbitId, body: `look ${permalink}` })
    const url = '/api/pm/send'
    const res = await app.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(attacker, 'POST', url, body) },
      body,
    }, env)
    expect(res.status).toBe(200)

    const inbox = await app.request('/api/pm?peer_id=' + attacker.orbitId, {
      headers: auth(victim, 'GET', '/api/pm'),
    }, env)
    expect(inbox.status).toBe(200)
    const messages = await inbox.json()
    const list = Array.isArray(messages) ? messages : messages.messages || []
    expect(JSON.stringify(list)).toContain('/p/abc123')
  })
})
