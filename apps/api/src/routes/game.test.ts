import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import app from '../index'
import { createTestIdentity, signRequestHeaders, createMockEnv } from '../test-utils'
import type { TestIdentity } from '../test-utils'

let env: Awaited<ReturnType<typeof createMockEnv>>
let ids: TestIdentity[]

function auth(identity: TestIdentity, method: string, url: string, body?: string) {
  return {
    'Content-Type': 'application/json',
    ...signRequestHeaders(identity, method, url, body),
  }
}

async function register(identity: TestIdentity) {
  const res = await app.request('/api/users', { headers: signRequestHeaders(identity, 'GET', '/api/users') }, env)
  expect(res.status).toBe(200)
}

let uploadCounter = 0
async function uploadCard(identity: TestIdentity, recipients?: string): Promise<string> {
  const form = new FormData()
  // Vary the payload each call so the per-owner content-hash dedup sees a
  // different image and keeps returning 201 across tests (and so "stale"
  // cards are genuinely distinct bytes from the current round's card).
  const payload = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, uploadCounter++ & 0xFF])
  form.append('image', new Blob([payload], { type: 'image/jpeg' }), 'card.jpg')
  if (recipients) form.append('recipients', recipients)
  const res = await app.request('/api/objects', {
    method: 'POST',
    headers: { ...signRequestHeaders(identity, 'POST', '/api/objects', '') },
    body: form,
  }, env)
  expect(res.status).toBe(201)
  const body: any = await res.json()
  return body.id
}

async function seedMatch(a: string, b: string, tier = 1): Promise<string> {
  const id = crypto.randomUUID()
  await env.DB.prepare("INSERT INTO TierMatches (id, user_a, user_b, tier, status) VALUES (?, ?, ?, ?, 'active')").bind(id, a, b, tier).run()
  return id
}

async function playBothCards(matchId: string, a: TestIdentity, b: TestIdentity) {
  const cardA = await uploadCard(a)
  const cardB = await uploadCard(b)
  const resA = await app.request(`/api/lobby/special/${matchId}/card`, {
    method: 'POST',
    headers: auth(a, 'POST', `/api/lobby/special/${matchId}/card`, JSON.stringify({ card_id: cardA })),
    body: JSON.stringify({ card_id: cardA }),
  }, env)
  expect(resA.status).toBe(200)
  const resB = await app.request(`/api/lobby/special/${matchId}/card`, {
    method: 'POST',
    headers: auth(b, 'POST', `/api/lobby/special/${matchId}/card`, JSON.stringify({ card_id: cardB })),
    body: JSON.stringify({ card_id: cardB }),
  }, env)
  expect(resB.status).toBe(200)
  return { cardA, cardB }
}

async function getSpecial(identity: TestIdentity) {
  const res = await app.request('/api/lobby/special', { headers: auth(identity, 'GET', '/api/lobby/special') }, env)
  expect(res.status).toBe(200)
  return (await res.json()) as { active: any[]; recent: any[] }
}

describe('Special tier match lifecycle', () => {
  beforeAll(async () => {
    env = await createMockEnv()
    ids = [createTestIdentity(), createTestIdentity()]
    for (const id of ids) await register(id)
  })

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM TierMatches').run()
    await env.DB.prepare('DELETE FROM LobbyPlayers').run()
    await env.DB.prepare('DELETE FROM Recipients').run()
    await env.DB.prepare('DELETE FROM Objects').run()
  })

  it('GET /special returns an empty active/recent shape', async () => {
    const body = await getSpecial(ids[0])
    expect(body).toEqual({ active: [], recent: [] })
  })

  it('rejects a decision before both cards are played', async () => {
    const matchId = await seedMatch(ids[0].orbitId, ids[1].orbitId)
    const res = await app.request(`/api/lobby/special/${matchId}/decision`, {
      method: 'POST',
      headers: auth(ids[0], 'POST', `/api/lobby/special/${matchId}/decision`, JSON.stringify({ decision: 'like' })),
      body: JSON.stringify({ decision: 'like' }),
    }, env)
    expect(res.status).toBe(409)
  })

  it('records a mutual like and advances the tier with a reveal', async () => {
    const matchId = await seedMatch(ids[0].orbitId, ids[1].orbitId)
    await playBothCards(matchId, ids[0], ids[1])

    const resA = await app.request(`/api/lobby/special/${matchId}/decision`, {
      method: 'POST',
      headers: auth(ids[0], 'POST', `/api/lobby/special/${matchId}/decision`, JSON.stringify({ decision: 'like' })),
      body: JSON.stringify({ decision: 'like' }),
    }, env)
    expect(resA.status).toBe(200)
    expect((await resA.json() as any).waiting).toBe(true)

    const resB = await app.request(`/api/lobby/special/${matchId}/decision`, {
      method: 'POST',
      headers: auth(ids[1], 'POST', `/api/lobby/special/${matchId}/decision`, JSON.stringify({ decision: 'like' })),
      body: JSON.stringify({ decision: 'like' }),
    }, env)
    expect(resB.status).toBe(200)
    const body = await resB.json()
    expect(body.advanced).toBe(true)
    expect(body.both_like).toBe(true)
    expect(body.tier).toBe(2)

    const list = await getSpecial(ids[0])
    expect(list.active).toHaveLength(1)
    expect(list.active[0].id).toBe(matchId)
    expect(list.active[0].tier).toBe(2)
    expect(list.active[0].last_result).toBe('both_like')
    expect(list.active[0].card_a).toBeNull()
    expect(list.active[0].card_b).toBeNull()
    expect(list.active[0].last_card_a).toBeTruthy()
  })

  it('ends the match and removes both players from the queue on a non-mutual decision', async () => {
    const matchId = await seedMatch(ids[0].orbitId, ids[1].orbitId, 3)
    await playBothCards(matchId, ids[0], ids[1])

    const resB = await app.request(`/api/lobby/special/${matchId}/decision`, {
      method: 'POST',
      headers: auth(ids[1], 'POST', `/api/lobby/special/${matchId}/decision`, JSON.stringify({ decision: 'like' })),
      body: JSON.stringify({ decision: 'like' }),
    }, env)
    expect(resB.status).toBe(200)

    const resA = await app.request(`/api/lobby/special/${matchId}/decision`, {
      method: 'POST',
      headers: auth(ids[0], 'POST', `/api/lobby/special/${matchId}/decision`, JSON.stringify({ decision: 'reject' })),
      body: JSON.stringify({ decision: 'reject' }),
    }, env)
    expect(resA.status).toBe(200)
    const body = await resA.json()
    expect(body.ended).toBe(true)
    expect(body.rematch).toBeUndefined()

    const list = await getSpecial(ids[0])
    // No auto-rematch is created for the same pair.
    const activeForPair = list.active.filter((m) => m.user_a === ids[0].orbitId || m.user_b === ids[0].orbitId)
    expect(activeForPair).toHaveLength(0)

    const ended = list.recent.find((r) => r.id === matchId)
    expect(ended).toBeDefined()
    expect(ended!.last_result).toBe('ended')
    expect(ended!.opponent_id).toBe(ids[1].orbitId)

    // Joining queues is manual — players are removed from the lobby on match end.
    const queued = await env.DB.prepare('SELECT user_id FROM LobbyPlayers WHERE status = \'waiting\'').all<{ user_id: string }>()
    const queuedIds = queued.results.map((r) => r.user_id)
    expect(queuedIds).not.toContain(ids[0].orbitId)
    expect(queuedIds).not.toContain(ids[1].orbitId)
  })

  it('quit via /end marks the match ended with no rematch and rejoins the lobby', async () => {
    const matchId = await seedMatch(ids[0].orbitId, ids[1].orbitId)

    const res = await app.request(`/api/lobby/special/${matchId}/end`, {
      method: 'POST',
      headers: auth(ids[0], 'POST', `/api/lobby/special/${matchId}/end`),
    }, env)
    expect(res.status).toBe(200)
    expect((await res.json() as any).ok).toBe(true)

    const list = await getSpecial(ids[0])
    expect(list.active).toHaveLength(0)
    const ended = list.recent.find((r) => r.id === matchId)
    expect(ended?.last_result).toBe('quit')

    // Joining queues is manual — no auto-rejoin after quit.
    const queued = await env.DB.prepare('SELECT user_id FROM LobbyPlayers WHERE status = \'waiting\'').all<{ user_id: string }>()
    const queuedIds = queued.results.map((r) => r.user_id)
    expect(queuedIds).not.toContain(ids[0].orbitId)
    expect(queuedIds).not.toContain(ids[1].orbitId)
  })

  it('refuses a card that does not belong to the caller', async () => {
    const matchId = await seedMatch(ids[0].orbitId, ids[1].orbitId)
    const cardB = await uploadCard(ids[1], ids[1].orbitId)
    const res = await app.request(`/api/lobby/special/${matchId}/card`, {
      method: 'POST',
      headers: auth(ids[0], 'POST', `/api/lobby/special/${matchId}/card`, JSON.stringify({ card_id: cardB })),
      body: JSON.stringify({ card_id: cardB }),
    }, env)
    expect(res.status).toBe(400)
  })

  it('rejects a stale duplicate card submission instead of overwriting the current card', async () => {
    const matchId = await seedMatch(ids[0].orbitId, ids[1].orbitId)
    const { cardA, cardB } = await playBothCards(matchId, ids[0], ids[1])
    expect(cardA).toBeTruthy()

    // A raced retry carrying a DIFFERENT (stale) card must not clobber the card
    // that is already set for the current tier round.
    const staleCard = await uploadCard(ids[0])
    const dup = await app.request(`/api/lobby/special/${matchId}/card`, {
      method: 'POST',
      headers: auth(ids[0], 'POST', `/api/lobby/special/${matchId}/card`, JSON.stringify({ card_id: staleCard })),
      body: JSON.stringify({ card_id: staleCard }),
    }, env)
    expect(dup.status).toBe(409)

    const row = await env.DB.prepare('SELECT card_a, card_b FROM TierMatches WHERE id = ?').bind(matchId).first<any>()
    expect(row.card_a).toBe(cardA)
    expect(row.card_b).toBe(cardB)
  })

  it('a stale special decision does not double-award points after tier advance', async () => {
    const matchId = await seedMatch(ids[0].orbitId, ids[1].orbitId)
    await playBothCards(matchId, ids[0], ids[1])

    const resA = await app.request(`/api/lobby/special/${matchId}/decision`, {
      method: 'POST',
      headers: auth(ids[0], 'POST', `/api/lobby/special/${matchId}/decision`, JSON.stringify({ decision: 'like' })),
      body: JSON.stringify({ decision: 'like' }),
    }, env)
    expect(resA.status).toBe(200)
    const resB = await app.request(`/api/lobby/special/${matchId}/decision`, {
      method: 'POST',
      headers: auth(ids[1], 'POST', `/api/lobby/special/${matchId}/decision`, JSON.stringify({ decision: 'like' })),
      body: JSON.stringify({ decision: 'like' }),
    }, env)
    expect((await resB.json() as any).advanced).toBe(true)

    // The tier advance cleared card_a/card_b — a replayed stale 'like' must
    // now be rejected with 409 (match not ready) and award nothing twice.
    const resC = await app.request(`/api/lobby/special/${matchId}/decision`, {
      method: 'POST',
      headers: auth(ids[0], 'POST', `/api/lobby/special/${matchId}/decision`, JSON.stringify({ decision: 'like' })),
      body: JSON.stringify({ decision: 'like' }),
    }, env)
    expect(resC.status).toBe(409)
  })
})
