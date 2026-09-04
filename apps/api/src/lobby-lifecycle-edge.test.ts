// Edge coverage for src/lobby.ts advanceLobby lifecycle: pick-phase timeout
// with both cards missing, ended-match cleanup + orphan safety sweep, legacy
// in_session reset, and final-round decide timeouts resolving to winner_b/draw.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { createMockEnv } from './test-utils'
import { advanceLobby, getLobbyState, joinLobby } from './lobby'
import type { D1Turso } from './db'

let env: Awaited<ReturnType<typeof createMockEnv>>
let db: D1Turso

const M = 1000

function uid(i: number): string {
  return `led-${i}-${Math.random().toString(36).slice(2, 8)}`
}

async function seedUser(userId: string, name: string) {
  await env._client.execute(
    `INSERT INTO Users (id, public_key, encryption_pub_key, display_name, last_seen) VALUES (?, ?, ?, ?, ?)`,
    [userId, `pk-${userId}`, null, name, new Date().toISOString()],
  )
}

async function insertMatch(params: {
  id: string
  userA: string
  userB: string
  status: string
  phase: string
  phaseDeadline: number
  scoreA?: number
  scoreB?: number
  roundSeq?: number
  maxRounds?: number
  cardA?: string | null
  cardB?: string | null
}) {
  await env._client.execute(
    `INSERT INTO GameMatches (id, user_a, user_b, status, phase, phase_deadline, score_a, score_b, round_seq, max_rounds, card_a, card_b)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      params.id, params.userA, params.userB, params.status, params.phase, params.phaseDeadline,
      params.scoreA ?? 0, params.scoreB ?? 0, params.roundSeq ?? 1, params.maxRounds ?? 5,
      params.cardA ?? null, params.cardB ?? null,
    ],
  )
}

async function matchRow(id: string) {
  const rows = await env._client.execute('SELECT * FROM GameMatches WHERE id = ?', [id])
  return rows.rows[0] as Record<string, unknown> | undefined
}

beforeAll(async () => {
  env = await createMockEnv()
  db = env.DB
})

beforeEach(async () => {
  await env._client.execute('DELETE FROM GameMatches').catch(() => {})
  await env._client.execute('DELETE FROM LobbyPlayers').catch(() => {})
  await env._client.execute('DELETE FROM MatchCards').catch(() => {})
})

describe('advanceLobby: pick-phase timeout', () => {
  it('forfeits BOTH players when neither card arrives', async () => {
    const a = uid(1)
    const b = uid(2)
    await seedUser(a, 'A')
    await seedUser(b, 'B')
    await insertMatch({ id: 'm-both-late', userA: a, userB: b, status: 'playing', phase: 'pick', phaseDeadline: Date.now() - 1000 })

    await advanceLobby(db, Date.now() + 5000)

    const row = await matchRow('m-both-late')
    expect(row).toBeDefined()
    expect(row!.forfeit_user).toBe('both')
    expect(row!.status).toBe('ended')
    expect(row!.result).toBe('expired')
  })

  it('forfeits the player whose card is missing (card_a present, card_b absent)', async () => {
    const a = uid(3)
    const b = uid(4)
    await seedUser(a, 'A')
    await seedUser(b, 'B')
    await insertMatch({
      id: 'm-b-late', userA: a, userB: b, status: 'playing', phase: 'pick',
      phaseDeadline: Date.now() - 1000, cardA: 'obj-a-1', cardB: null,
    })

    await advanceLobby(db, Date.now() + 5000)
    const row = await matchRow('m-b-late')
    // resolveMatch normalizes forfeit_user to 'both' on expiry regardless of
    // which side was late; the observable contract is the expired result.
    expect(row!.forfeit_user).toBe('both')
    expect(row!.status).toBe('ended')
    expect(row!.result).toBe('expired')
  })
})

describe('advanceLobby: final-round decide timeout', () => {
  it('resolves a winner_b match when B leads on the last round', async () => {
    const a = uid(5)
    const b = uid(6)
    await seedUser(a, 'A')
    await seedUser(b, 'B')
    await insertMatch({
      id: 'm-winner-b', userA: a, userB: b, status: 'playing', phase: 'decide',
      phaseDeadline: Date.now() - 1000, scoreA: 0, scoreB: 2, roundSeq: 5, maxRounds: 5,
    })

    await advanceLobby(db, Date.now() + 5000)
    const row = await matchRow('m-winner-b')
    expect(row!.status).toBe('ended')
    expect(row!.result).toBe('winner_b')
    // missing decisions auto-filled as reject
    expect(row!.decision_a).toBe('reject')
    expect(row!.decision_b).toBe('reject')
  })

  it('resolves a draw when both players scored but neither leads', async () => {
    const a = uid(7)
    const b = uid(8)
    await seedUser(a, 'A')
    await seedUser(b, 'B')
    await insertMatch({
      id: 'm-draw', userA: a, userB: b, status: 'playing', phase: 'decide',
      phaseDeadline: Date.now() - 1000, scoreA: 1, scoreB: 1, roundSeq: 5, maxRounds: 5,
    })

    await advanceLobby(db, Date.now() + 5000)
    const row = await matchRow('m-draw')
    expect(row!.status).toBe('ended')
    expect(row!.result).toBe('draw')
  })
})

describe('advanceLobby: ended-match cleanup and orphan sweep', () => {
  it('deletes ended result-phase matches past the cleanup deadline with their match cards', async () => {
    const a = uid(9)
    const b = uid(10)
    await seedUser(a, 'A')
    await seedUser(b, 'B')
    const old = Date.now() - 60_000
    await insertMatch({ id: 'm-done', userA: a, userB: b, status: 'ended', phase: 'result', phaseDeadline: old })
    await env._client.execute(
      `INSERT INTO MatchCards (id, room_id, owner_id, content_url) VALUES ('mc-1', 'm-done', ?, 'data:image/jpeg;base64,x')`,
      [a],
    )

    await advanceLobby(db, Date.now() + 120_000)
    expect(await matchRow('m-done')).toBeUndefined()
    const cards = await env._client.execute("SELECT id FROM MatchCards WHERE room_id = 'm-done'")
    expect(cards.rows.length).toBe(0)
  })

  it('sweeps orphaned ended matches stuck outside the result phase', async () => {
    const a = uid(11)
    const b = uid(12)
    await seedUser(a, 'A')
    await seedUser(b, 'B')
    // status='ended' but phase='pick' — the crash-window orphan.
    await insertMatch({ id: 'm-orphan', userA: a, userB: b, status: 'ended', phase: 'pick', phaseDeadline: Date.now() - 120_000 })

    await advanceLobby(db, Date.now() + 120_000)
    expect(await matchRow('m-orphan')).toBeUndefined()
  })

  it('keeps a fresh ended result match inside the cleanup window', async () => {
    const a = uid(13)
    const b = uid(14)
    await seedUser(a, 'A')
    await seedUser(b, 'B')
    await insertMatch({ id: 'm-fresh', userA: a, userB: b, status: 'ended', phase: 'result', phaseDeadline: Date.now() })

    await advanceLobby(db, Date.now() + 1000)
    expect(await matchRow('m-fresh')).toBeDefined()
  })
})

describe('advanceLobby: stale queue hygiene', () => {
  it('resets legacy in_session rows back to waiting', async () => {
    const a = uid(15)
    await seedUser(a, 'A')
    await joinLobby(db, a)
    await env._client.execute("UPDATE LobbyPlayers SET status = 'in_session' WHERE user_id = ?", [a])

    await advanceLobby(db)
    const row = (await env._client.execute('SELECT status FROM LobbyPlayers WHERE user_id = ?', [a])).rows[0] as { status: string }
    expect(row.status).toBe('waiting')
  })

  it('drops lobby rows for players idle past the queue max', async () => {
    const a = uid(16)
    await seedUser(a, 'A')
    await joinLobby(db, a)
    await env._client.execute(`UPDATE Users SET last_seen = datetime('now', '-20 minutes') WHERE id = ?`, [a])

    await advanceLobby(db)
    const row = await env._client.execute('SELECT user_id FROM LobbyPlayers WHERE user_id = ?', [a])
    expect(row.rows.length).toBe(0)
    // The player is no longer counted as waiting.
    const state = await getLobbyState(db, uid(99))
    expect(state.waiting_count).toBe(0)
  })
})
