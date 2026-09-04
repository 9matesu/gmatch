import { describe, it, expect, beforeAll } from 'vitest'
import app from '../index'
import { createTestIdentity, signRequestHeaders, createMockEnv } from '../test-utils'
import { resolveMatch } from '../lobby'

const adminId = createTestIdentity()
const regularId = createTestIdentity()

function authHeaders(identity: ReturnType<typeof createTestIdentity>, method: string, url: string, body?: string) {
  return signRequestHeaders(identity, method, url, body)
}

describe('Match Archive (admin-only reports)', () => {
  let env: Awaited<ReturnType<typeof createMockEnv>>

  async function seedArchivedMatch(opts: {
    userA: string
    userB: string
    nameA: string
    nameB: string
    scoreA: number
    scoreB: number
    result: string
    matched: number
    perfect: number
    rounds?: string
    endedAt?: string
  }) {
    const id = crypto.randomUUID()
    await env._client.execute(
      `INSERT INTO MatchArchive
        (id, user_a, user_b, user_a_name, user_a_pfp, user_b_name, user_b_pfp,
         score_a, score_b, result, rounds_history, matched, perfect, created_at, ended_at)
       VALUES (?, ?, ?, ?, NULL, ?, NULL, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`,
      [
        id,
        opts.userA,
        opts.userB,
        opts.nameA,
        opts.nameB,
        opts.scoreA,
        opts.scoreB,
        opts.result,
        opts.rounds || '[]',
        opts.matched,
        opts.perfect,
        opts.endedAt || new Date().toISOString(),
      ]
    )
    return id
  }

  beforeAll(async () => {
    env = await createMockEnv()
    await app.request('/api/users', { headers: authHeaders(adminId, 'GET', '/api/users') }, env)
    await app.request('/api/users', { headers: authHeaders(regularId, 'GET', '/api/users') }, env)
    // Grant admin to adminId via PIN
    const envWithPin = { ...env, ADMIN_PIN: 'test-pin' }
    await app.request('/api/admin/verify-pin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(adminId, 'POST', '/api/admin/verify-pin', JSON.stringify({ pin: 'test-pin' })),
      },
      body: JSON.stringify({ pin: 'test-pin' }),
    }, envWithPin)
  })

  it('rejects archive access for non-admin', async () => {
    const res = await app.request('/api/admin/matches/archive', {
      headers: authHeaders(regularId, 'GET', '/api/admin/matches/archive'),
    }, env)
    expect(res.status).toBe(403)
  })

  it('lists an empty archive for admin', async () => {
    const res = await app.request('/api/admin/matches/archive', {
      headers: authHeaders(adminId, 'GET', '/api/admin/matches/archive'),
    }, env)
    expect(res.status).toBe(200)
    const body: any = await res.json()
    expect(Array.isArray(body.matches)).toBe(true)
    expect(body.total).toBeGreaterThanOrEqual(0)
  })

  it('lists archived matches and supports filters', async () => {
    const aliceId = `user-a-${Math.random().toString(36).slice(2, 8)}`
    const bobId = `user-b-${Math.random().toString(36).slice(2, 8)}`
    await seedArchivedMatch({
      userA: aliceId,
      userB: bobId,
      nameA: 'Alice',
      nameB: 'Bob',
      scoreA: 3,
      scoreB: 1,
      result: 'winner_a',
      matched: 1,
      perfect: 0,
      rounds: JSON.stringify([{ round: 1, matched: true }]),
    })
    await seedArchivedMatch({
      userA: aliceId,
      userB: bobId,
      nameA: 'Alice',
      nameB: 'Bob',
      scoreA: 0,
      scoreB: 0,
      result: 'no_match',
      matched: 0,
      perfect: 0,
    })

    const res = await app.request('/api/admin/matches/archive', {
      headers: authHeaders(adminId, 'GET', '/api/admin/matches/archive'),
    }, env)
    expect(res.status).toBe(200)
    const body: any = await res.json()
    expect(body.matches.length).toBeGreaterThanOrEqual(2)

    // Filter by result
    const filtered = await app.request('/api/admin/matches/archive?result=winner_a', {
      headers: authHeaders(adminId, 'GET', '/api/admin/matches/archive'),
    }, env)
    const fBody: any = await filtered.json()
    expect(fBody.matches.every((m: any) => m.result === 'winner_a')).toBe(true)

    // Filter by matched
    const matchedOnly = await app.request('/api/admin/matches/archive?matched=1', {
      headers: authHeaders(adminId, 'GET', '/api/admin/matches/archive'),
    }, env)
    const mBody: any = await matchedOnly.json()
    expect(mBody.matches.every((m: any) => m.matched === 1)).toBe(true)

    // Search by name
    const search = await app.request('/api/admin/matches/archive?q=Alice', {
      headers: authHeaders(adminId, 'GET', '/api/admin/matches/archive'),
    }, env)
    const sBody: any = await search.json()
    expect(sBody.matches.length).toBeGreaterThanOrEqual(2)

    // Pagination
    const page = await app.request('/api/admin/matches/archive?limit=1&offset=0', {
      headers: authHeaders(adminId, 'GET', '/api/admin/matches/archive'),
    }, env)
    const pBody: any = await page.json()
    expect(pBody.matches.length).toBe(1)
    expect(pBody.limit).toBe(1)
  })

  it('returns full detail for a single archived match', async () => {
    const aId = `user-a2-${Math.random().toString(36).slice(2, 8)}`
    const bId = `user-b2-${Math.random().toString(36).slice(2, 8)}`
    const id = await seedArchivedMatch({
      userA: aId,
      userB: bId,
      nameA: 'Charlie',
      nameB: 'Dana',
      scoreA: 4,
      scoreB: 2,
      result: 'winner_a',
      matched: 1,
      perfect: 1,
      rounds: JSON.stringify([{ round: 1, matched: true }, { round: 2, matched: true }]),
    })
    const res = await app.request(`/api/admin/matches/archive/${id}`, {
      headers: authHeaders(adminId, 'GET', `/api/admin/matches/archive/${id}`),
    }, env)
    expect(res.status).toBe(200)
    const body: any = await res.json()
    expect(body.user_a_name).toBe('Charlie')
    expect(body.user_b_name).toBe('Dana')
    expect(body.score_a).toBe(4)
    expect(body.score_b).toBe(2)
    expect(body.perfect).toBe(1)
    expect(Array.isArray(body.rounds_history)).toBe(true)
    expect(body.rounds_history.length).toBe(2)
  })

  it('archives a resolved match via resolveMatch', async () => {
    const a = `user-res-${Math.random().toString(36).slice(2, 8)}`
    const b = `user-res2-${Math.random().toString(36).slice(2, 8)}`
    await env._client.execute(
      `INSERT INTO Users (id, public_key, display_name, last_seen) VALUES (?, ?, ?, ?)`,
      [a, `pk-${a}`, 'ResolvedA', new Date().toISOString()]
    )
    await env._client.execute(
      `INSERT INTO Users (id, public_key, display_name, last_seen) VALUES (?, ?, ?, ?)`,
      [b, `pk-${b}`, 'ResolvedB', new Date().toISOString()]
    )
    const matchId = crypto.randomUUID()
    await env._client.execute(
      `INSERT INTO GameMatches (id, user_a, user_b, status, phase, round_seq, max_rounds,
        score_a, score_b, played_cards_a, played_cards_b, rounds_history, phase_deadline, phase_version)
       VALUES (?, ?, ?, 'playing', 'result', 5, 5, 2, 1, '[]', '[]', '[]', ?, 1)`,
      [matchId, a, b, Date.now() + 60000]
    )
    const row = await env._client.execute('SELECT * FROM GameMatches WHERE id = ?', [matchId])
    const match = row.rows[0] as any
    await resolveMatch(env.DB, {
      id: match.id,
      user_a: match.user_a,
      user_b: match.user_b,
      status: match.status,
      phase: match.phase,
      round_seq: match.round_seq,
      max_rounds: match.max_rounds,
      score_a: match.score_a,
      score_b: match.score_b,
      card_a: match.card_a,
      card_b: match.card_b,
      decision_a: match.decision_a,
      decision_b: match.decision_b,
      played_cards_a: match.played_cards_a,
      played_cards_b: match.played_cards_b,
      rounds_history: match.rounds_history,
      forfeit_user: match.forfeit_user,
      matched: match.matched,
      result: match.result,
      phase_deadline: match.phase_deadline,
      phase_version: match.phase_version,
      created_at: match.created_at,
      updated_at: match.updated_at,
    } as any, Date.now(), 'winner_a')

    const res = await app.request(`/api/admin/matches/archive/${matchId}`, {
      headers: authHeaders(adminId, 'GET', `/api/admin/matches/archive/${matchId}`),
    }, env)
    expect(res.status).toBe(200)
    const body: any = await res.json()
    expect(body.user_a_name).toBe('ResolvedA')
    expect(body.user_b_name).toBe('ResolvedB')
    expect(body.result).toBe('winner_a')
    expect(body.score_a).toBe(2)
    expect(body.score_b).toBe(1)
  })
})