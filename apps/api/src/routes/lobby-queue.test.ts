import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import app from '../index'
import { advanceLobby } from '../lobby'
import { saveBotProfile } from '../bot-image-api'
import { createTestIdentity, signRequestHeaders, createMockEnv } from '../test-utils'
import type { TestIdentity } from '../test-utils'

let env: Awaited<ReturnType<typeof createMockEnv>>
let playerA: TestIdentity
let playerB: TestIdentity
let playerC: TestIdentity

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
async function uploadCard(identity: TestIdentity): Promise<string> {
  const form = new FormData()
  // Vary the payload each call so the per-owner content-hash dedup sees a
  // different image and keeps returning 201 across tests.
  const payload = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, uploadCounter++ & 0xFF])
  form.append('image', new Blob([payload], { type: 'image/jpeg' }), 'card.jpg')
  const res = await app.request('/api/objects', {
    method: 'POST',
    headers: { ...signRequestHeaders(identity, 'POST', '/api/objects', '') },
    body: form,
  }, env)
  expect(res.status).toBe(201)
  const body: any = await res.json()
  return body.id
}

async function joinBoth() {
  // The Quick-Play gate (routes/lobby.ts) requires each joining user to own at
  // least MIN_GAME_CARDS non-story Objects. Seed five for each player so the
  // hopper still pairs them.
  for (let i = 0; i < 5; i++) {
    await uploadCard(playerA)
    await uploadCard(playerB)
  }
  await app.request('/api/lobby/join', { method: 'POST', headers: auth(playerA, 'POST', '/api/lobby/join') }, env)
  await app.request('/api/lobby/join', { method: 'POST', headers: auth(playerB, 'POST', '/api/lobby/join') }, env)
  const stateARes = await app.request('/api/lobby', { headers: auth(playerA, 'GET', '/api/lobby') }, env)
  const stateA: any = await stateARes.json()
  expect(stateA.match).toBeDefined()
  return stateA.match.id as string
}

async function joinOne(identity: TestIdentity) {
  // Convenience: seed five cards then join the lobby queue (satisfies the gate).
  for (let i = 0; i < 5; i++) await uploadCard(identity)
  return app.request('/api/lobby/join', { method: 'POST', headers: auth(identity, 'POST', '/api/lobby/join') }, env)
}

async function playCardFor(matchId: string, identity: TestIdentity): Promise<void> {
  const cardId = await uploadCard(identity)
  const res = await app.request(`/api/lobby/match/${matchId}/card`, {
    method: 'POST',
    headers: auth(identity, 'POST', `/api/lobby/match/${matchId}/card`, JSON.stringify({ card_id: cardId })),
    body: JSON.stringify({ card_id: cardId }),
  }, env)
  expect(res.status).toBe(200)
}

async function decide(matchId: string, identity: TestIdentity, decision: 'like' | 'reject'): Promise<any> {
  const res = await app.request(`/api/lobby/match/${matchId}/decision`, {
    method: 'POST',
    headers: auth(identity, 'POST', `/api/lobby/match/${matchId}/decision`, JSON.stringify({ decision })),
    body: JSON.stringify({ decision }),
  }, env)
  expect(res.status).toBe(200)
  return res.json()
}

async function lobbyPlayer(identity: TestIdentity) {
  return env.DB.prepare('SELECT status, auto_queue FROM LobbyPlayers WHERE user_id = ?').bind(identity.orbitId).first<any>()
}

describe('1v1 Match Hopper & Queue Lifecycle', () => {
  beforeAll(async () => {
    env = await createMockEnv()
    playerA = createTestIdentity()
    playerB = createTestIdentity()
    playerC = createTestIdentity()
    await register(playerA)
    await register(playerB)
    await register(playerC)

    // Seed an enabled admin-managed duelist so bot fallback / Quick Match have
    // a real opponent (bots now come only from the Bots table).
    await saveBotProfile(env.DB, {
      id: 'bot_queue_test',
      name: 'Queue Test Bot',
      tags: ['1girl', 'solo'],
      enabled: true,
    })
  })

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM GameMatches').run()
    await env.DB.prepare('DELETE FROM LobbyPlayers').run()
    await env.DB.prepare('DELETE FROM Recipients').run()
    await env.DB.prepare('DELETE FROM Objects').run()
    await env.DB.prepare("DELETE FROM SystemMeta WHERE key = 'bot_enabled'").run()
  })

  it('allows joining and leaving the lobby queue', async () => {
    // Player A joins queue (must own at least MIN_GAME_CARDS cards — gate)
    for (let i = 0; i < 5; i++) await uploadCard(playerA)
    const joinRes = await app.request('/api/lobby/join', {
      method: 'POST',
      headers: auth(playerA, 'POST', '/api/lobby/join'),
    }, env)
    expect(joinRes.status).toBe(200)

    const state1Res = await app.request('/api/lobby', {
      headers: auth(playerA, 'GET', '/api/lobby'),
    }, env)
    const state1: any = await state1Res.json()
    expect(state1.waiting_count).toBe(1)
    expect(state1.players.some((p: any) => p.user_id === playerA.orbitId && p.status === 'waiting')).toBe(true)

    // Player A leaves queue
    const leaveRes = await app.request('/api/lobby/leave', {
      method: 'POST',
      headers: auth(playerA, 'POST', '/api/lobby/leave'),
    }, env)
    expect(leaveRes.status).toBe(200)

    const state2Res = await app.request('/api/lobby', {
      headers: auth(playerA, 'GET', '/api/lobby'),
    }, env)
    const state2: any = await state2Res.json()
    expect(state2.waiting_count).toBe(0)
    expect(state2.players.some((p: any) => p.user_id === playerA.orbitId)).toBe(false)
  })

  it('pairs two queued players into a 1v1 match automatically', async () => {
    // Quick-Play gate: each joining user needs at least MIN_GAME_CARDS cards.
    for (let i = 0; i < 5; i++) {
      await uploadCard(playerA)
      await uploadCard(playerB)
    }
    // Player A joins
    await app.request('/api/lobby/join', {
      method: 'POST',
      headers: auth(playerA, 'POST', '/api/lobby/join'),
    }, env)

    // Player B joins -> triggers pairing
    await app.request('/api/lobby/join', {
      method: 'POST',
      headers: auth(playerB, 'POST', '/api/lobby/join'),
    }, env)

    // Check Player A state
    const stateARes = await app.request('/api/lobby', {
      headers: auth(playerA, 'GET', '/api/lobby'),
    }, env)
    const stateA: any = await stateARes.json()
    expect(stateA.match).toBeDefined()
    expect(stateA.match.status).toBe('lobby')
    expect(stateA.match.opponent.id).toBe(playerB.orbitId)

    // Check Player B state
    const stateBRes = await app.request('/api/lobby', {
      headers: auth(playerB, 'GET', '/api/lobby'),
    }, env)
    const stateB: any = await stateBRes.json()
    expect(stateB.match).toBeDefined()
    expect(stateB.match.status).toBe('lobby')
    expect(stateB.match.opponent.id).toBe(playerA.orbitId)
  })

  it('completes the full game flow: play cards, reveal, mutual like, reward points', async () => {
    // Quick-Play gate seed (the cards played below create additional Objects).
    for (let i = 0; i < 5; i++) {
      await uploadCard(playerA)
      await uploadCard(playerB)
    }
    // Join both players
    await app.request('/api/lobby/join', { method: 'POST', headers: auth(playerA, 'POST', '/api/lobby/join') }, env)
    await app.request('/api/lobby/join', { method: 'POST', headers: auth(playerB, 'POST', '/api/lobby/join') }, env)

    const stateARes = await app.request('/api/lobby', { headers: auth(playerA, 'GET', '/api/lobby') }, env)
    const matchId = (await stateARes.json() as any).match.id

    // Both players upload & play cards
    const cardA = await uploadCard(playerA)
    const cardB = await uploadCard(playerB)

    const playARes = await app.request(`/api/lobby/match/${matchId}/card`, {
      method: 'POST',
      headers: auth(playerA, 'POST', `/api/lobby/match/${matchId}/card`, JSON.stringify({ card_id: cardA })),
      body: JSON.stringify({ card_id: cardA }),
    }, env)
    expect(playARes.status).toBe(200)

    const playBRes = await app.request(`/api/lobby/match/${matchId}/card`, {
      method: 'POST',
      headers: auth(playerB, 'POST', `/api/lobby/match/${matchId}/card`, JSON.stringify({ card_id: cardB })),
      body: JSON.stringify({ card_id: cardB }),
    }, env)
    expect(playBRes.status).toBe(200)

    // Both decide LIKE
    const decARes = await app.request(`/api/lobby/match/${matchId}/decision`, {
      method: 'POST',
      headers: auth(playerA, 'POST', `/api/lobby/match/${matchId}/decision`, JSON.stringify({ decision: 'like' })),
      body: JSON.stringify({ decision: 'like' }),
    }, env)
    expect(decARes.status).toBe(200)

    const decBRes = await app.request(`/api/lobby/match/${matchId}/decision`, {
      method: 'POST',
      headers: auth(playerB, 'POST', `/api/lobby/match/${matchId}/decision`, JSON.stringify({ decision: 'like' })),
      body: JSON.stringify({ decision: 'like' }),
    }, env)
    expect(decBRes.status).toBe(200)
    const decBData: any = await decBRes.json()
    expect(decBData.matched).toBe(true)

    // Spectator endpoints test
    const matchesRes = await app.request('/api/lobby/matches', { headers: auth(playerA, 'GET', '/api/lobby/matches') }, env)
    expect(matchesRes.status).toBe(200)
    const matchesData: any = await matchesRes.json()
    expect(Array.isArray(matchesData.matches)).toBe(true)

    const spectateRes = await app.request(`/api/lobby/match/${matchId}/spectate`, { headers: auth(playerA, 'GET', `/api/lobby/match/${matchId}/spectate`) }, env)
    expect(spectateRes.status).toBe(200)
    const spectateData: any = await spectateRes.json()
    expect(spectateData.snapshot.is_spectating).toBe(true)

    // Clean up match so next test can pair
    await app.request(`/api/lobby/match/${matchId}/quit`, {
      method: 'POST',
      headers: auth(playerA, 'POST', `/api/lobby/match/${matchId}/quit`),
    }, env)
  })

  it('allows leaving / quitting a live game cleanly', async () => {
    // Quick-Play gate seed
    for (let i = 0; i < 5; i++) {
      await uploadCard(playerA)
      await uploadCard(playerB)
    }
    // Join both players
    await app.request('/api/lobby/join', { method: 'POST', headers: auth(playerA, 'POST', '/api/lobby/join') }, env)
    await app.request('/api/lobby/join', { method: 'POST', headers: auth(playerB, 'POST', '/api/lobby/join') }, env)

    const stateARes = await app.request('/api/lobby', { headers: auth(playerA, 'GET', '/api/lobby') }, env)
    const matchId = (await stateARes.json() as any).match.id

    // Player A quits match
    const quitRes = await app.request(`/api/lobby/match/${matchId}/quit`, {
      method: 'POST',
      headers: auth(playerA, 'POST', `/api/lobby/match/${matchId}/quit`),
    }, env)
    expect(quitRes.status).toBe(200)
    expect((await quitRes.json() as any).ok).toBe(true)

    // Verify match status in DB is ended
    const matchRow = await env.DB.prepare('SELECT * FROM GameMatches WHERE id = ?').bind(matchId).first<any>()
    expect(matchRow.status).toBe('ended')
    expect(matchRow.result).toBe('quit')
  })

  it('ends a full 5-round match and does not auto-re-queue players', async () => {
    const matchId = await joinBoth()

    for (let round = 1; round <= 5; round++) {
      await playCardFor(matchId, playerA)
      await playCardFor(matchId, playerB)
      await decide(matchId, playerA, 'like')
      const bData = await decide(matchId, playerB, 'like')
      expect(bData.matched).toBe(true)
      if (round < 5) {
        await advanceLobby(env.DB, Date.now() + 5000)
      }
    }

    const matchRow = await env.DB.prepare('SELECT status, result FROM GameMatches WHERE id = ?').bind(matchId).first<any>()
    expect(matchRow.status).toBe('ended')
    expect(['draw', 'match', 'winner_a', 'winner_b']).toContain(matchRow.result)

    // No auto-requeue: both players are dropped from the queue and must press
    // Quick Play again to rejoin.
    const a = await lobbyPlayer(playerA)
    const b = await lobbyPlayer(playerB)
    expect(a).toBeNull()
    expect(b).toBeNull()
  })

  it('does not re-queue anyone when the pick phase times out', async () => {
    const matchId = await joinBoth()
    await playCardFor(matchId, playerA) // Player B never plays

    await env.DB.prepare("UPDATE GameMatches SET phase = 'pick', phase_deadline = ? WHERE id = ?").bind(Date.now() - 10000, matchId).run()
    await advanceLobby(env.DB, Date.now())

    const a = await lobbyPlayer(playerA)
    const b = await lobbyPlayer(playerB)
    expect(a).toBeNull()
    expect(b).toBeNull()
  })

  it('does not re-queue anyone when the decide phase times out', async () => {
    const matchId = await joinBoth()
    await playCardFor(matchId, playerA)
    await playCardFor(matchId, playerB)
    await decide(matchId, playerA, 'like') // Player B never decides

    // Set round_seq = 5 so deciding timeout resolves the match
    await env.DB.prepare("UPDATE GameMatches SET round_seq = 5, phase = 'decide', phase_deadline = ? WHERE id = ?").bind(Date.now() - 10000, matchId).run()
    await advanceLobby(env.DB, Date.now())

    const a = await lobbyPlayer(playerA)
    const b = await lobbyPlayer(playerB)
    expect(a).toBeNull()
    expect(b).toBeNull()
  })

  it('drops both players from the queue when one quits', async () => {
    const matchId = await joinBoth()

    const quitRes = await app.request(`/api/lobby/match/${matchId}/quit`, {
      method: 'POST',
      headers: auth(playerA, 'POST', `/api/lobby/match/${matchId}/quit`),
    }, env)
    expect(quitRes.status).toBe(200)

    const a = await lobbyPlayer(playerA)
    const b = await lobbyPlayer(playerB)
    expect(a).toBeNull()
    expect(b).toBeNull()
  })

  // Helper: a single player joins the queue, then we artificially age their
  // waiting_since column backwards so a stale-wait can be simulated without
  // actually sleeping in the test.
  async function joinOneLonerAndAge(identity: TestIdentity, ageMs = 125_000): Promise<void> {
    for (let i = 0; i < 5; i++) await uploadCard(identity)
    const joinRes = await app.request('/api/lobby/join', {
      method: 'POST',
      headers: auth(identity, 'POST', '/api/lobby/join'),
    }, env)
    expect(joinRes.status).toBe(200)
    // Store as full ISO-8601 UTC (T + Z) — the same format pairFromQueue
    // parses via new Date(...), so parsing matches the runtime regardless of
    // the host timezone.
    const backdated = new Date(Date.now() - ageMs).toISOString()
    await env.DB.prepare("UPDATE LobbyPlayers SET waiting_since = ? WHERE user_id = ?")
      .bind(backdated, identity.orbitId)
      .run()
  }

  it('does NOT pair a lone queued player with a bot even after the wait elapses (bots removed from queue matching)', async () => {
    // Bots would be enabled, but queue fallback pairing is removed.
    await env.DB.prepare("INSERT INTO SystemMeta (key, value) VALUES ('bot_enabled', '1')").run()
    await joinOneLonerAndAge(playerC)
    await advanceLobby(env.DB, Date.now())

    // No match should have been created — the loner keeps waiting for a human.
    const matchRow = await env.DB.prepare(
      "SELECT id FROM GameMatches WHERE user_a = ? OR user_b = ?"
    ).bind(playerC.orbitId, playerC.orbitId).first<any>()
    expect(matchRow).toBeNull()

    const lp = await lobbyPlayer(playerC)
    expect(lp.status).toBe('waiting')
  })

  it('does NOT pair a lone queued player with a bot when bots are disabled — they keep waiting for a human', async () => {
    // Disable the bot matchmaking switch in SystemMeta.
    await env.DB.prepare("INSERT INTO SystemMeta (key, value) VALUES ('bot_enabled', '0')").run()

    await joinOneLonerAndAge(playerC)
    await advanceLobby(env.DB, Date.now())

    // No match should have been created.
    const matchRow = await env.DB.prepare(
      "SELECT id FROM GameMatches WHERE user_a = ? OR user_b = ?"
    ).bind(playerC.orbitId, playerC.orbitId).first<any>()
    expect(matchRow).toBeNull()

    // The loner stays in the queue, waiting for a human opponent.
    const lp = await lobbyPlayer(playerC)
    expect(lp.status).toBe('waiting')

    // Ticking forward again still does nothing while bots stay disabled.
    await env.DB.prepare("UPDATE LobbyPlayers SET waiting_since = ? WHERE user_id = ?")
      .bind(new Date(Date.now() - 60_000).toISOString(), playerC.orbitId)
      .run()
    await advanceLobby(env.DB, Date.now())
    const matchRow2 = await env.DB.prepare(
      "SELECT id FROM GameMatches WHERE user_a = ? OR user_b = ?"
    ).bind(playerC.orbitId, playerC.orbitId).first<any>()
    expect(matchRow2).toBeNull()
    const lp2 = await lobbyPlayer(playerC)
    expect(lp2.status).toBe('waiting')

    // Now a second human joins — regular human/human pairing must still work
    // even while bots are disabled. The loner is matched with the newcomer.
    for (let i = 0; i < 5; i++) await uploadCard(playerA)
    await app.request('/api/lobby/join', {
      method: 'POST',
      headers: auth(playerA, 'POST', '/api/lobby/join'),
    }, env)
    await advanceLobby(env.DB, Date.now())

    const matchRow3 = await env.DB.prepare(
      "SELECT user_a, user_b, status FROM GameMatches WHERE user_a IN (?, ?) OR user_b IN (?, ?)"
    ).bind(playerC.orbitId, playerA.orbitId, playerC.orbitId, playerA.orbitId).first<any>()
    expect(matchRow3).toBeTruthy()
    expect(matchRow3.status).toBe('lobby')
    const opponents = new Set([matchRow3.user_a, matchRow3.user_b])
    expect(opponents.has(playerC.orbitId)).toBe(true)
    expect(opponents.has(playerA.orbitId)).toBe(true)
    // No bot involved.
    expect([...opponents].every((id) => !id.startsWith('bot_'))).toBe(true)
  })

  it('Quick Match instantly pairs a player with a bot without waiting', async () => {
    // Bots are off by default — explicitly enable for this test.
    await env.DB.prepare("INSERT INTO SystemMeta (key, value) VALUES ('bot_enabled', '1')").run()
    for (let i = 0; i < 5; i++) await uploadCard(playerB)
    const res = await app.request('/api/lobby/quick-match', {
      method: 'POST',
      headers: auth(playerB, 'POST', '/api/lobby/quick-match'),
    }, env)
    expect(res.status).toBe(200)
    const body: any = await res.json()
    expect(body.ok).toBe(true)
    expect(body.match.id).toBeTruthy()

    const matchRow = await env.DB.prepare(
      "SELECT user_a, user_b, status FROM GameMatches WHERE id = ?"
    ).bind(body.match.id).first<any>()
    expect(matchRow).toBeTruthy()
    expect(matchRow.status).toBe('lobby')
    const opponent = matchRow.user_a === playerB.orbitId ? matchRow.user_b : matchRow.user_a
    expect(opponent.startsWith('bot_')).toBe(true)

    const lp = await lobbyPlayer(playerB)
    expect(lp.status).toBe('in_match')
  })

  it('rejects Quick Match when already in an active match', async () => {
    // Bots are off by default — explicitly enable for this test.
    await env.DB.prepare("INSERT INTO SystemMeta (key, value) VALUES ('bot_enabled', '1')").run()
    for (let i = 0; i < 5; i++) await uploadCard(playerB)
    const first = await app.request('/api/lobby/quick-match', {
      method: 'POST',
      headers: auth(playerB, 'POST', '/api/lobby/quick-match'),
    }, env)
    expect(first.status).toBe(200)

    const second = await app.request('/api/lobby/quick-match', {
      method: 'POST',
      headers: auth(playerB, 'POST', '/api/lobby/quick-match'),
    }, env)
    expect(second.status).toBe(409)
  })

  it('rejects Quick Match for players with no cards in their library', async () => {
    // PlayerB owns zero Objects (table is cleared each test) → card gate fires.
    const res = await app.request('/api/lobby/quick-match', {
      method: 'POST',
      headers: auth(playerB, 'POST', '/api/lobby/quick-match'),
    }, env)
    expect(res.status).toBe(400)
    expect((await res.json() as any).error).toContain('picture')
  })
})

describe('Lobby image content endpoint', () => {
  it('serves an inline image without auth headers', async () => {
    const form = new FormData()
    form.append('image', new Blob([new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46])], { type: 'image/jpeg' }), 'tile.jpg')
    const up = await app.request('/api/lobby/images', {
      method: 'POST',
      headers: { ...signRequestHeaders(playerA, 'POST', '/api/lobby/images', '') },
      body: form,
    }, env)
    expect(up.status).toBe(201)
    const img: any = await up.json()
    // The list endpoint rewrites inline data: URLs to /content refs so the JSON
    // list stays small; the frontend renders THAT ref inside <img src>.
    const listRes = await app.request('/api/lobby/images', { headers: signRequestHeaders(playerA, 'GET', '/api/lobby/images') }, env)
    expect(listRes.status).toBe(200)
    const list: any = await listRes.json()
    const found = (list as any[]).find((r) => r.id === img.id)
    expect(found).toBeDefined()
    expect(found.content_url).toBe(`/api/lobby/images/${img.id}/content`)

    const get = await app.request(`/api/lobby/images/${img.id}/content`, {}, env)
    expect(get.status).toBe(200)
    expect(get.headers.get('Content-Type') || '').toMatch(/^image\//)
  })

  it('returns 404 for an unknown/expired image id without auth headers', async () => {
    const get = await app.request('/api/lobby/images/does-not-exist/content', {}, env)
    expect(get.status).toBe(404)
  })

  it('rejects POST /images without auth headers', async () => {
    const form = new FormData()
    form.append('url', 'https://example.com/x.jpg')
    const res = await app.request('/api/lobby/images', { method: 'POST', body: form }, env)
    expect(res.status).toBe(401)
  })

  it('rejects GET / (lobby state) without auth headers', async () => {
    const res = await app.request('/api/lobby', {}, env)
    expect(res.status).toBe(401)
  })

  it('rejects POST /images/:id/like without auth headers', async () => {
    const res = await app.request('/api/lobby/images/some-id/like', { method: 'POST' }, env)
    expect(res.status).toBe(401)
  })
})
