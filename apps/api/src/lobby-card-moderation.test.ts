import { describe, it, expect, beforeAll } from 'vitest'
import { createMockEnv } from './test-utils'
import { joinLobby, advanceLobby, playMatchCard, getLobbyState } from './lobby'
import { LOBBY_LOBBY_SECONDS } from '@orbit/shared'

const M = 1000

let env: Awaited<ReturnType<typeof createMockEnv>>

function uid(i: number): string {
  return `mod-${i}-${Math.random().toString(36).slice(2, 8)}`
}

async function seedUser(userId: string, name: string) {
  await env._client.execute(
    `INSERT INTO Users (id, public_key, encryption_pub_key, display_name, last_seen) VALUES (?, ?, ?, ?, ?)`,
    [userId, `pk-${userId}`, null, name, new Date().toISOString()],
  )
}

async function seedObject(userId: string): Promise<string> {
  const id = `obj-${userId}-${Math.random().toString(36).slice(2, 8)}`
  await env._client.execute(
    `INSERT INTO Objects (id, owner_id, size_bytes, mime_type, content_url, is_story) VALUES (?, ?, 0, 'image/jpeg', 'data:image/jpeg;base64,x', 0)`,
    [id, userId],
  )
  return id
}

async function seedBannedCard(ownerId: string, mediaObjectId: string) {
  const cardId = `card-${ownerId}-${Math.random().toString(36).slice(2, 8)}`
  await env._client.execute(
    `INSERT INTO Cards (id, creator_id, media_object_id, rarity, moderation_state) VALUES (?, ?, ?, 'common', 'banned')`,
    [cardId, ownerId, mediaObjectId],
  )
  await env._client.execute(
    `INSERT INTO CardOwnership (card_id, owner_id) VALUES (?, ?)`,
    [cardId, ownerId],
  )
  return cardId
}

async function matchFor(userId: string) {
  const state = await getLobbyState(env.DB, userId)
  return state.match
}

describe('match card moderation exclusion', () => {
  let a: string
  let b: string

  beforeAll(async () => {
    env = await createMockEnv()
    a = uid(1)
    b = uid(2)
    await seedUser(a, 'ModA')
    await seedUser(b, 'ModB')
    await joinLobby(env.DB, a)
    await joinLobby(env.DB, b)
    await advanceLobby(env.DB)
    await advanceLobby(env.DB, Date.now() + (LOBBY_LOBBY_SECONDS + 1) * M)
  })

  it('rejects a banned canonical card in the pick phase', async () => {
    const m = await matchFor(a)
    expect(m!.phase).toBe('pick')

    const media = await seedObject(a)
    await seedBannedCard(a, media)

    await expect(playMatchCard(env.DB, m!.id, a, media)).rejects.toMatchObject({ status: 400 })
  })

  it('accepts an active (non-banned) owned object', async () => {
    const m = await matchFor(a)
    const ok = await seedObject(a)
    await playMatchCard(env.DB, m!.id, a, ok)
    const refreshed = await matchFor(a)
    expect(refreshed!.card_a || refreshed!.card_b || refreshed!.opponent_card).toBeDefined()
  })
})
