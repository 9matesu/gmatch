import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { createMockEnv } from './test-utils'
import {
  joinLobby,
  leaveLobby,
  advanceLobby,
  getLobbyState,
  playMatchCard,
  setMatchDecision,
  quitMatch,
  getLobbyImages,
  setLobbyImage,
  promoteLobbyImageToPost,
  likeLobbyImage,
  expireIdleSpecialMatches,
} from './lobby'
import { LOBBY_LOBBY_SECONDS, LOBBY_PICK_SECONDS, LOBBY_REVEAL_SECONDS, LOBBY_DECIDE_SECONDS, LOBBY_ROUND_RESULT_SECONDS, SPECIAL_MATCH_IDLE_SECONDS } from '@orbit/shared'

let env: Awaited<ReturnType<typeof createMockEnv>>

const M = 1000

function uid(i: number): string {
  return `user-${i}-${Math.random().toString(36).slice(2, 8)}`
}

async function seedUser(userId: string, name: string) {
  await env._client.execute(
    `INSERT INTO Users (id, public_key, encryption_pub_key, display_name, last_seen) VALUES (?, ?, ?, ?, ?)`,
    [userId, `pk-${userId}`, null, name, new Date().toISOString()]
  )
}

async function seedObject(userId: string, story: number = 0): Promise<string> {
  const id = `obj-${userId}-${Math.random().toString(36).slice(2, 8)}`
  await env._client.execute(
    `INSERT INTO Objects (id, owner_id, size_bytes, mime_type, content_url, is_story) VALUES (?, ?, 0, 'image/jpeg', 'data:image/jpeg;base64,x', ?)`,
    [id, userId, story]
  )
  return id
}

async function seedLobbyUsers(n: number): Promise<string[]> {
  const ids: string[] = []
  for (let i = 0; i < n; i++) {
    const id = uid(i)
    await seedUser(id, `Player${i}`)
    await joinLobby(env.DB, id)
    ids.push(id)
  }
  return ids
}

async function matchFor(userId: string) {
  const state = await getLobbyState(env.DB, userId)
  return state.match
}

describe('lobby core: queue and 1v1 pairing', () => {
  beforeAll(async () => {
    env = await createMockEnv()
  })

  it('stays waiting until 2 players are in the queue', async () => {
    const ids = await seedLobbyUsers(1)
    const state = await getLobbyState(env.DB, ids[0])
    expect(state.waiting_count).toBe(1)
    expect(state.match).toBeNull()
    // no match created with a single player
    const rows = await env._client.execute('SELECT COUNT(*) AS cnt FROM GameMatches')
    expect(Number(rows.rows[0].cnt)).toBe(0)
    await leaveLobby(env.DB, ids[0])
  })

  it('pairs 2 waiting players into a lobby-phase match', async () => {
    const a = await uid(10)
    const b = await uid(11)
    await seedUser(a, 'Alice')
    await seedUser(b, 'Bob')
    await joinLobby(env.DB, a)
    await joinLobby(env.DB, b)

    await advanceLobby(env.DB)

    const stateA = await getLobbyState(env.DB, a)
    expect(stateA.match).toBeDefined()
    expect(stateA.match!.phase).toBe('lobby')
    expect(stateA.match!.status).toBe('lobby')
    expect(stateA.match!.opponent.id).toBe(b)

    const stateB = await getLobbyState(env.DB, b)
    expect(stateB.match!.opponent.id).toBe(a)

    // Both players are now in_match and no longer counted as waiting
    const players = stateA.players
    expect(players.find((p) => p.user_id === a)?.status).toBe('in_match')
    expect(players.find((p) => p.user_id === b)?.status).toBe('in_match')
    expect(stateA.waiting_count).toBe(0)
  })

  it('pairs additional waiting players in parallel even while a match is active', async () => {
    const c = await uid(12)
    const d = await uid(13)
    await seedUser(c, 'Carol')
    await seedUser(d, 'Dave')
    await joinLobby(env.DB, c)
    await joinLobby(env.DB, d)
    await advanceLobby(env.DB)

    // c/d are paired in parallel into their own duel
    const rows = await env._client.execute("SELECT COUNT(*) AS cnt FROM GameMatches WHERE status IN ('lobby','playing')")
    expect(Number(rows.rows[0].cnt)).toBe(2)
  })
})

describe('lobby core: 1v1 match lifecycle', () => {
  beforeAll(async () => {
    env = await createMockEnv()
    const ids = await seedLobbyUsers(2)
    await advanceLobby(env.DB)
    pair = { a: ids[0], b: ids[1] }
  })

  let pair: { a: string; b: string }

  it('moves lobby -> pick after the lobby countdown', async () => {
    let m = await matchFor(pair.a)
    await advanceLobby(env.DB, Date.now() + (LOBBY_LOBBY_SECONDS + 1) * M)
    m = await matchFor(pair.a)
    expect(m!.phase).toBe('pick')
    expect(m!.status).toBe('playing')
    expect(m!.phase_deadline).toBeGreaterThan(Date.now())
  })

  it('rejects cards from outsiders or story objects in pick', async () => {
    const outsider = await uid(99)
    await seedUser(outsider, 'Outsider')
    const m = await matchFor(pair.a)
    const foreignCard = await seedObject(outsider)
    await expect(playMatchCard(env.DB, m!.id, pair.a, foreignCard)).rejects.toMatchObject({ status: 400 })

    const storyCard = await seedObject(pair.a, 1)
    await expect(playMatchCard(env.DB, m!.id, pair.a, storyCard)).rejects.toMatchObject({ status: 400 })

    await expect(playMatchCard(env.DB, m!.id, outsider, foreignCard)).rejects.toMatchObject({ status: 403 })
  })

  it('both play cards then transition to reveal', async () => {
    let m = await matchFor(pair.a)
    const cardA = await seedObject(pair.a)
    await playMatchCard(env.DB, m!.id, pair.a, cardA)

    // Opponent does not see my card during pick (information-safe)
    let mB = await matchFor(pair.b)
    expect(mB!.opponent_card).toBeNull()
    expect(mB!.opponent_played).toBe(true)

    const cardB = await seedObject(pair.b)
    await playMatchCard(env.DB, m!.id, pair.b, cardB)

    m = await matchFor(pair.a)
    expect(m!.phase).toBe('reveal')
    expect(m!.opponent_card).toBe(cardB)
  })

  it('reveal -> decide after the reveal window, then rejects outside deciding', async () => {
    let m = await matchFor(pair.a)
    await advanceLobby(env.DB, Date.now() + (LOBBY_REVEAL_SECONDS + 1) * M)
    m = await matchFor(pair.a)
    expect(m!.phase).toBe('decide')

    const card0 = await seedObject(pair.a)
    await expect(playMatchCard(env.DB, m!.id, pair.a, card0)).rejects.toMatchObject({ status: 409 })

    await expect(setMatchDecision(env.DB, m!.id, pair.a, 'maybe')).rejects.toMatchObject({ status: 400 })
  })

  it('mutual likes mark a match and advance rounds (points awarded on match resolution, not per-like)', async () => {
    let m = await matchFor(pair.a)

    const resA = await setMatchDecision(env.DB, m!.id, pair.a, 'like')
    expect(resA.points_awarded).toBe(3)
    expect(resA.matched).toBe(false)

    const resB = await setMatchDecision(env.DB, m!.id, pair.b, 'like')
    expect(resB.matched).toBe(true)
    expect(resB.points_awarded).toBe(3)

    // Round 1 ended with a match; transitions to round_result, then advances to round 2
    m = await matchFor(pair.a)
    expect(m!.phase).toBe('round_result')
    expect(m!.score_mine).toBe(1)
    expect(m!.matched).toBe(true)

    // Advance through the 3-second round result window into round 2 pick
    await advanceLobby(env.DB, Date.now() + (LOBBY_ROUND_RESULT_SECONDS + 1) * M)
    m = await matchFor(pair.a)
    expect(m!.round_seq).toBe(2)
    expect(m!.phase).toBe('pick')

    // Unique card rule: cannot replay card from round 1
    const cardA1 = m!.played_cards[0]
    await expect(playMatchCard(env.DB, m!.id, pair.a, cardA1)).rejects.toMatchObject({ status: 409 })

    // Play rounds 2, 3, 4, 5 to complete match
    for (let r = 2; r <= 5; r++) {
      const cA = await seedObject(pair.a)
      const cB = await seedObject(pair.b)
      await playMatchCard(env.DB, m!.id, pair.a, cA)
      await playMatchCard(env.DB, m!.id, pair.b, cB)
      await advanceLobby(env.DB, Date.now() + (LOBBY_REVEAL_SECONDS + 1) * M)
      await setMatchDecision(env.DB, m!.id, pair.a, 'like')
      await setMatchDecision(env.DB, m!.id, pair.b, 'like')
      if (r < 5) {
        await advanceLobby(env.DB, Date.now() + (LOBBY_ROUND_RESULT_SECONDS + 1) * M)
      }
      m = await matchFor(pair.a)
    }

    expect(m!.phase).toBe('result')
    expect(m!.matched).toBe(true)

    const a = await env._client.execute('SELECT matches_total FROM Users WHERE id = ?', [pair.a])
    expect(Number(a.rows[0].matches_total)).toBeGreaterThanOrEqual(1)
  })

  it('does not auto-re-queue either player after a full match result', async () => {
    const stateA = await getLobbyState(env.DB, pair.a)
    expect(stateA.waiting_count).toBe(0)
    const row = await env._client.execute('SELECT status FROM LobbyPlayers WHERE user_id = ?', [pair.a])
    expect(row.rows[0]).toBeUndefined()
  })
})

describe('lobby core: rejects, timeouts and quit', () => {
  beforeAll(async () => {
    env = await createMockEnv()
  })

  // Each of these tests runs its own compact match; the single-hopper engine
  // only pairs one game at a time, so a leftover requeued player from a prior
  // test (eligibility restored by a large fake-time jump) would steal the pair.
  beforeEach(async () => {
    await env._client.execute('DELETE FROM GameMatches').catch(() => {})
    await env._client.execute('DELETE FROM LobbyPlayers').catch(() => {})
  })

  it('a reject does not end the match early and advances rounds normally', async () => {
    const ids = await seedLobbyUsers(2)
    await advanceLobby(env.DB)
    let m = await matchFor(ids[0])
    const cardA = await seedObject(ids[0])
    const cardB = await seedObject(ids[1])
    await playMatchCard(env.DB, m!.id, ids[0], cardA)
    await playMatchCard(env.DB, m!.id, ids[1], cardB)
    await advanceLobby(env.DB, Date.now() + (LOBBY_REVEAL_SECONDS + 1) * M)

    await setMatchDecision(env.DB, m!.id, ids[0], 'like')
    const decB = await setMatchDecision(env.DB, m!.id, ids[1], 'reject')
    expect(decB.matched).toBe(false)

    // Round 1 transitions to round_result, then advances to round 2
    m = await matchFor(ids[0])
    expect(m!.phase).toBe('round_result')
    await advanceLobby(env.DB, Date.now() + (LOBBY_ROUND_RESULT_SECONDS + 1) * M)
    m = await matchFor(ids[0])
    expect(m!.round_seq).toBe(2)
    expect(m!.phase).toBe('pick')

    // Play rounds 2, 3, 4 with mutual reject
    for (let r = 2; r <= 4; r++) {
      const cA = await seedObject(ids[0])
      const cB = await seedObject(ids[1])
      await playMatchCard(env.DB, m!.id, ids[0], cA)
      await playMatchCard(env.DB, m!.id, ids[1], cB)
      await advanceLobby(env.DB, Date.now() + (LOBBY_REVEAL_SECONDS + 1) * M)
      await setMatchDecision(env.DB, m!.id, ids[0], 'reject')
      await setMatchDecision(env.DB, m!.id, ids[1], 'reject')
      await advanceLobby(env.DB, Date.now() + (LOBBY_ROUND_RESULT_SECONDS + 1) * M)
      m = await matchFor(ids[0])
      expect(m!.round_seq).toBe(r + 1)
    }

    // Final round 5
    const cA5 = await seedObject(ids[0])
    const cB5 = await seedObject(ids[1])
    await playMatchCard(env.DB, m!.id, ids[0], cA5)
    await playMatchCard(env.DB, m!.id, ids[1], cB5)
    await advanceLobby(env.DB, Date.now() + (LOBBY_REVEAL_SECONDS + 1) * M)
    await setMatchDecision(env.DB, m!.id, ids[0], 'reject')
    await setMatchDecision(env.DB, m!.id, ids[1], 'reject')

    m = await matchFor(ids[0])
    expect(m!.phase).toBe('result')
    expect(m!.matched).toBe(false)
    expect(m!.result).toBe('no_match')

    const a = await env._client.execute('SELECT matches_total FROM Users WHERE id = ?', [ids[0]])
    expect(Number(a.rows[0].matches_total)).toBe(0)
  })

  it('plays all 5 rounds without early termination when both players reject round 1', async () => {
    const ids = await seedLobbyUsers(2)
    const t0 = Date.now()
    await advanceLobby(env.DB, t0)
    let m = await matchFor(ids[0])
    await advanceLobby(env.DB, t0 + (LOBBY_LOBBY_SECONDS + 1) * M)
    m = await matchFor(ids[0])
    const cardA = await seedObject(ids[0])
    const cardB = await seedObject(ids[1])
    await playMatchCard(env.DB, m!.id, ids[0], cardA)
    await playMatchCard(env.DB, m!.id, ids[1], cardB)
    await advanceLobby(env.DB, t0 + (LOBBY_LOBBY_SECONDS + LOBBY_REVEAL_SECONDS + 1) * M)

    await setMatchDecision(env.DB, m!.id, ids[0], 'reject')
    await setMatchDecision(env.DB, m!.id, ids[1], 'reject')

    // Both rejected in round 1 → transitions to round_result (does NOT cancel the match)
    m = await matchFor(ids[0])
    expect(m!.phase).toBe('round_result')
    expect(m!.round_seq).toBe(1)

    // After round_result deadline, advances to round 2
    await advanceLobby(env.DB, t0 + (LOBBY_LOBBY_SECONDS + LOBBY_REVEAL_SECONDS + LOBBY_ROUND_RESULT_SECONDS + 1) * M)
    m = await matchFor(ids[0])
    expect(m!.phase).toBe('pick')
    expect(m!.round_seq).toBe(2)
  })

  it('rejects replaying the same card in a later round (no re-send)', async () => {
    const ids = await seedLobbyUsers(2)
    const t0 = Date.now()
    await advanceLobby(env.DB, t0)
    let m = await matchFor(ids[0])
    await advanceLobby(env.DB, t0 + (LOBBY_LOBBY_SECONDS + 1) * M)
    m = await matchFor(ids[0])

    // Player A has only ONE eligible card.
    const onlyA = await seedObject(ids[0])
    await playMatchCard(env.DB, m!.id, ids[0], onlyA)

    // Player B plays a card and both decide to advance past round 1.
    const cardB = await seedObject(ids[1])
    await playMatchCard(env.DB, m!.id, ids[1], cardB)
    await advanceLobby(env.DB, Date.now() + (LOBBY_REVEAL_SECONDS + 1) * M)
    await setMatchDecision(env.DB, m!.id, ids[0], 'like')
    await setMatchDecision(env.DB, m!.id, ids[1], 'like')
    await advanceLobby(env.DB, Date.now() + (LOBBY_ROUND_RESULT_SECONDS + 1) * M)

    m = await matchFor(ids[0])
    expect(m!.phase).toBe('pick')
    expect(m!.round_seq).toBe(2)

    // Replaying the already-used card in round 2 must now be rejected (409).
    await expect(playMatchCard(env.DB, m!.id, ids[0], onlyA)).rejects.toMatchObject({ status: 409 })
  })

  it('pick-phase timeout with a missing card cancels and cleans up players', async () => {
    const ids = await seedLobbyUsers(2)
    const t0 = Date.now()
    await advanceLobby(env.DB, t0)
    let m = await matchFor(ids[0])
    await advanceLobby(env.DB, t0 + (LOBBY_LOBBY_SECONDS + 1) * M)
    m = await matchFor(ids[0])
    const cardA = await seedObject(ids[0])
    await playMatchCard(env.DB, m!.id, ids[0], cardA)

    // Pick window elapses with player B's card missing → expired.
    await advanceLobby(env.DB, t0 + (LOBBY_LOBBY_SECONDS + LOBBY_PICK_SECONDS + 1) * M)

    m = await matchFor(ids[0])
    expect(m!.result).toBe('expired')
    const state = await getLobbyState(env.DB, ids[0])
    expect(state.waiting_count).toBe(0)
  })

  it('decide-phase timeout fills missing decisions as reject and transitions to round_result', async () => {
    const ids = await seedLobbyUsers(2)
    const t0 = Date.now()
    await advanceLobby(env.DB, t0)
    let m = await matchFor(ids[0])
    await advanceLobby(env.DB, t0 + (LOBBY_LOBBY_SECONDS + 1) * M)
    m = await matchFor(ids[0])
    const cardA = await seedObject(ids[0])
    const cardB = await seedObject(ids[1])
    await playMatchCard(env.DB, m!.id, ids[0], cardA)
    await playMatchCard(env.DB, m!.id, ids[1], cardB)
    await advanceLobby(env.DB, t0 + (LOBBY_LOBBY_SECONDS + LOBBY_REVEAL_SECONDS + 1) * M)

    // only one player decides; the other times out → auto-reject
    await setMatchDecision(env.DB, m!.id, ids[0], 'like')
    await advanceLobby(env.DB, t0 + (LOBBY_LOBBY_SECONDS + LOBBY_REVEAL_SECONDS + LOBBY_DECIDE_SECONDS + 1) * M)

    m = await matchFor(ids[0])
    expect(m!.phase).toBe('round_result')
    expect(m!.matched).toBe(false)

    // Timeout synthesis is marked auto in history …
    const hist = Array.isArray(m!.rounds_history) ? m!.rounds_history : JSON.parse((m as any).rounds_history_json || '[]')
    expect(hist).toHaveLength(1)
    expect(hist[0].decision_a).toBe('like')
    expect(hist[0].decision_b).toBe('reject')
    expect(hist[0].auto_a).toBeFalsy()
    expect(hist[0].auto_b).toBe(true)

    // … and the auto-reject writes no value: live like moved cardB (+10),
    // the auto side left cardA untouched.
    const scoreA = await env._client.execute('SELECT gacha_downloads_count FROM Objects WHERE id = ?', [cardA])
    const scoreB = await env._client.execute('SELECT gacha_downloads_count FROM Objects WHERE id = ?', [cardB])
    expect(Number(scoreA.rows[0]?.gacha_downloads_count ?? 0)).toBe(0)
    expect(Number(scoreB.rows[0]?.gacha_downloads_count ?? 0)).toBe(10)
  })

  it('quit ends the match and re-queues only the staying player', async () => {
    const ids = await seedLobbyUsers(2)
    const t0 = Date.now()
    await advanceLobby(env.DB, t0)
    let m = await matchFor(ids[0])
    await advanceLobby(env.DB, t0 + (LOBBY_LOBBY_SECONDS + 1) * M)
    m = await matchFor(ids[0])

    await quitMatch(env.DB, m!.id, ids[0])

    m = await matchFor(ids[1])
    expect(m!.result).toBe('quit')

    const state = await getLobbyState(env.DB, ids[1])
    expect(state.waiting_count).toBe(0)
    const row = await env._client.execute('SELECT status FROM LobbyPlayers WHERE user_id = ?', [ids[1]])
    expect(row.rows[0]).toBeUndefined()
    const quitter = await env._client.execute('SELECT status FROM LobbyPlayers WHERE user_id = ?', [ids[0]])
    expect(quitter.rows[0]).toBeUndefined()
  })

  it('does not resurrect an ended match when a stale card arrives after resolution', async () => {
    const ids = await seedLobbyUsers(2)
    const t0 = Date.now()
    await advanceLobby(env.DB, t0)
    let m = await matchFor(ids[0])
    await advanceLobby(env.DB, t0 + (LOBBY_LOBBY_SECONDS + 1) * M)
    m = await matchFor(ids[0])
    const cardA = await seedObject(ids[0])
    await playMatchCard(env.DB, m!.id, ids[0], cardA)

    // Pick window elapses with B's card missing → the tick resolves & expires.
    await advanceLobby(env.DB, t0 + (LOBBY_LOBBY_SECONDS + LOBBY_PICK_SECONDS + 1) * M)
    m = await matchFor(ids[0])
    expect(m!.result).toBe('expired')

    // A late (raced) card submission on the now-ended match must be rejected —
    // never re-enters a reveal phase (zombie) nor clears the result.
    await expect(playMatchCard(env.DB, m!.id, ids[1], cardA)).rejects.toMatchObject({ status: 410 })
    const after = await env._client.execute('SELECT status, phase, result FROM GameMatches WHERE id = ?', [m!.id])
    expect(after.rows[0].status).toBe('ended')
    expect(after.rows[0].phase).toBe('result')
    expect(after.rows[0].result).toBe('expired')
  })

  it('does not resurrect an ended match when a stale decision arrives after decide timeout', async () => {
    const ids = await seedLobbyUsers(2)
    const t0 = Date.now()
    await advanceLobby(env.DB, t0)
    let m = await matchFor(ids[0])
    await advanceLobby(env.DB, t0 + (LOBBY_LOBBY_SECONDS + 1) * M)
    m = await matchFor(ids[0])
    const cardA = await seedObject(ids[0])
    const cardB = await seedObject(ids[1])
    await playMatchCard(env.DB, m!.id, ids[0], cardA)
    await playMatchCard(env.DB, m!.id, ids[1], cardB)
    await advanceLobby(env.DB, t0 + (LOBBY_LOBBY_SECONDS + LOBBY_REVEAL_SECONDS + 1) * M)

    // Set round to 5 so decide timeout resolves the match
    await env._client.execute('UPDATE GameMatches SET round_seq = 5 WHERE id = ?', [m!.id])

    // only A decides; B times out → timer auto-rejects and resolves the match.
    await setMatchDecision(env.DB, m!.id, ids[0], 'like')
    await advanceLobby(env.DB, t0 + (LOBBY_LOBBY_SECONDS + LOBBY_REVEAL_SECONDS + LOBBY_DECIDE_SECONDS + 1) * M)
    m = await matchFor(ids[0])
    expect(m!.result).toBe('no_match')

    // A late (raced) decision must not re-enter a new pick round (which would
    // wipe the current cards / double-award) — it is rejected outright.
    await expect(setMatchDecision(env.DB, m!.id, ids[0], 'like')).rejects.toMatchObject({ status: 410 })
    const after = await env._client.execute('SELECT status, phase, round_seq, card_a, card_b FROM GameMatches WHERE id = ?', [m!.id])
    expect(after.rows[0].status).toBe('ended')
    expect(after.rows[0].phase).toBe('result')
    expect(Number(after.rows[0].round_seq)).toBe(5)
    expect(after.rows[0].card_a).not.toBeNull()
    expect(after.rows[0].card_b).not.toBeNull()
  })
})

describe('lobby core: leave, staleness, and images', () => {
  beforeAll(async () => {
    env = await createMockEnv()
  })

  it('leaveLobby removes a waiting player', async () => {
    const id = await uid(1)
    await seedUser(id, 'Leaver')
    await joinLobby(env.DB, id)
    expect(await leaveLobby(env.DB, id)).toBe(true)
    const state = await getLobbyState(env.DB, id)
    expect(state.players.some((p) => p.user_id === id)).toBe(false)
  })

  it('cannot leave while in a match', async () => {
    const ids = await seedLobbyUsers(2)
    await advanceLobby(env.DB)
    expect(await leaveLobby(env.DB, ids[0])).toBe(false)
  })

  it('stale waiting players are cleaned up', async () => {
    const id = await uid(2)
    await seedUser(id, 'Stale')
    // Idle past the 15-minute queue max → removed from the queue entirely
    const staleTime = new Date(Date.now() - 16 * 60 * 1000).toISOString()
    await env._client.execute(`UPDATE Users SET last_seen = ? WHERE id = ?`, [staleTime, id])
    await env._client.execute(
      `INSERT INTO LobbyPlayers (user_id, status, joined_at) VALUES (?, 'waiting', ?)`,
      [id, staleTime]
    )
    await advanceLobby(env.DB)
    const state = await getLobbyState(env.DB, id)
    expect(state.players.some((p) => p.user_id === id)).toBe(false)
  })

  it('stores and expires lobby images', async () => {
    const id = await uid(3)
    await seedUser(id, 'Poster')
    const img = await setLobbyImage(env.DB, id, { contentUrl: 'data:image/jpeg;base64,y', caption: 'hi' })
    expect(img.likes_count).toBe(0)
    let images = await getLobbyImages(env.DB)
    expect(images.some((i) => i.id === img.id)).toBe(true)

    const liked = await likeLobbyImage(env.DB, img.id, id)
    expect(liked.likes_count).toBe(1)

    // Force expiry
    await env._client.execute('UPDATE LobbyImages SET expires_at = ? WHERE id = ?', [
      new Date(Date.now() - 1000).toISOString(),
      img.id,
    ])
    images = await getLobbyImages(env.DB)
    expect(images.some((i) => i.id === img.id)).toBe(false)
  })

  it('setLobbyImage accepts a pre-generated id', async () => {
    const id = await uid(4)
    await seedUser(id, 'Poster2')
    const presetId = '11111111-1111-4111-8111-111111111111'
    const img = await setLobbyImage(env.DB, id, { id: presetId, contentUrl: 'data:image/jpeg;base64,z', caption: null })
    expect(img.id).toBe(presetId)
    const images = await getLobbyImages(env.DB)
    expect(images.some((i) => i.id === presetId)).toBe(true)
  })

  it('promotes a lobby image to one owner timeline with its original timestamp', async () => {
    const id = await uid(5)
    await seedUser(id, 'Timeline Poster')
    const createdAt = '2024-01-02T03:04:05.000Z'
    const img = await setLobbyImage(env.DB, id, {
      id: 'lobby-promote-' + id,
      contentUrl: 'data:image/jpeg;base64,/9j/',
      caption: 'saved caption',
      tags: ['photo', 'lobby'],
    })
    await env._client.execute('UPDATE LobbyImages SET created_at = ? WHERE id = ?', [createdAt, img.id])
    const stored = await env.DB.prepare('SELECT * FROM LobbyImages WHERE id = ?').bind(img.id).first<any>()
    expect(await promoteLobbyImageToPost(env.DB, undefined, stored)).toBe(true)
    expect(await promoteLobbyImageToPost(env.DB, undefined, stored)).toBe(false)
    const post = await env.DB.prepare('SELECT owner_id, created_at, post_caption, post_tags, is_public, expires_at FROM Objects WHERE id = ?').bind(img.id).first<any>()
    expect(post).toMatchObject({ owner_id: id, created_at: createdAt, post_caption: 'saved caption', post_tags: '["photo","lobby"]', is_public: 1, expires_at: null })
  })
})

describe('lobby core: special match idle expiry', () => {
  beforeAll(async () => {
    env = await createMockEnv()
  })

  it('expires idle active matches and re-queues both players', async () => {
    const a = uid(20)
    const b = uid(21)
    await seedUser(a, 'Alice')
    await seedUser(b, 'Bob')
    const matchId = Math.random().toString(36).slice(2, 10)
    await env._client.execute(
      `INSERT INTO TierMatches (id, user_a, user_b, tier, status, updated_at) VALUES (?, ?, ?, 1, 'active', ?)`,
      [matchId, a, b, new Date(Date.now() - (SPECIAL_MATCH_IDLE_SECONDS + 5) * M).toISOString()]
    )
    await joinLobby(env.DB, a)
    await joinLobby(env.DB, b)

    await expireIdleSpecialMatches(env.DB)

    const row = await env._client.execute('SELECT status, last_result FROM TierMatches WHERE id = ?', [matchId])
    expect(row.rows[0].status).toBe('ended')
    expect(row.rows[0].last_result).toBe('expired')

    const queued = await env._client.execute("SELECT user_id FROM LobbyPlayers WHERE status = 'waiting'")
    const queuedIds = queued.rows.map((r: any) => r.user_id)
    expect(queuedIds).toContain(a)
    expect(queuedIds).toContain(b)
  })
})
