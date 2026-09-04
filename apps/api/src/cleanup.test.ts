import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createClient, type Client } from '@libsql/client'
import { D1Turso, ensureSchema } from './db'
import { LocalBlobStore } from './blob'
import { maybeNormalizeTags, deleteExpiredContent, sweepOrphanedBlobs, runPeriodicMaintenance, deleteOfflineUsers, sendOfflineWarnings } from './cleanup'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'orbit-cleanup-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true }).catch(() => {})
})

async function makeDb(): Promise<D1Turso> {
  const client: Client = createClient({ url: ':memory:' })
  await ensureSchema(client)
  return new D1Turso(client)
}

describe('maybeNormalizeTags', () => {
  it('normalizes legacy tags once and is idempotent', async () => {
    const db = await makeDb()
    await db
      .prepare("INSERT INTO Users (id, public_key, tags) VALUES ('u1', 'pub1', ?), ('u2', 'pub2', ?), ('u3', 'pub3', ?)")
      .bind(
        JSON.stringify([' Art ', '#Photo', 'art', 'Goon!%']),
        JSON.stringify(['alL-cLean']),
        JSON.stringify(['ok']),
      )
      .run()

    const first = await maybeNormalizeTags(db)
    expect(first).toBe(true)

    const row = await db.prepare("SELECT tags FROM Users WHERE id = 'u1'").first<{ tags: string }>()
    expect(JSON.parse(row!.tags)).toEqual(['art', 'photo', 'goon'])
    const row2 = await db.prepare("SELECT tags FROM Users WHERE id = 'u2'").first<{ tags: string }>()
    expect(JSON.parse(row2!.tags)).toEqual(['all-clean'])

    const again = await maybeNormalizeTags(db)
    expect(again).toBe(false)
  })
})

describe('deleteExpiredContent', () => {
  it('automatically deletes expired stories, objects, lobby images, sessions, and associated blobs', async () => {
    const db = await makeDb()
    const blobStore = new LocalBlobStore(dir)

    const pastIso = new Date(Date.now() - 3600_000).toISOString()
    const futureIso = new Date(Date.now() + 3600_000).toISOString()

    // 1. Insert user
    await db.prepare("INSERT INTO Users (id, public_key) VALUES ('user1', 'pub1')").run()

    // 2. Put blobs
    await blobStore.put('objects/expired-story-1', new Uint8Array([1, 2, 3]))
    await blobStore.put('objects/active-story-1', new Uint8Array([4, 5, 6]))
    await blobStore.put('lobby/expired-lobby-1', new Uint8Array([7, 8, 9]))
    await blobStore.put('lobby/active-lobby-1', new Uint8Array([10, 11, 12]))

    // 3. Insert Objects (one expired story, one active story)
    await db.prepare("INSERT INTO Objects (id, owner_id, size_bytes, mime_type, content_url, is_story, expires_at) VALUES ('expired-story-1', 'user1', 3, 'image/jpeg', '/api/objects/expired-story-1', 1, ?)").bind(pastIso).run()
    await db.prepare("INSERT INTO Objects (id, owner_id, size_bytes, mime_type, content_url, is_story, expires_at) VALUES ('active-story-1', 'user1', 3, 'image/jpeg', '/api/objects/active-story-1', 1, ?)").bind(futureIso).run()

    // 4. Insert LobbyImages (one expired, one active)
    await db.prepare("INSERT INTO LobbyImages (id, owner_id, content_url, expires_at) VALUES ('expired-lobby-1', 'user1', '/api/lobby/images/expired-lobby-1/content', ?)").bind(pastIso).run()
    await db.prepare("INSERT INTO LobbyImages (id, owner_id, content_url, expires_at) VALUES ('active-lobby-1', 'user1', '/api/lobby/images/active-lobby-1/content', ?)").bind(futureIso).run()

    // 5. Insert Sessions (one expired, one active)
    await db.prepare("INSERT INTO Sessions (id, user_id, challenge, expires_at) VALUES ('sess-exp', 'user1', 'chal', ?)").bind(pastIso).run()
    await db.prepare("INSERT INTO Sessions (id, user_id, challenge, expires_at) VALUES ('sess-act', 'user1', 'chal', ?)").bind(futureIso).run()

    // 6. Run deleteExpiredContent
    const stats = await deleteExpiredContent(db, blobStore, Date.now())

    expect(stats.expiredObjects).toBe(1)
    expect(stats.expiredLobbyImages).toBe(1)
    expect(stats.expiredSessions).toBe(1)

    // Verify DB states
    const remainingObjs = await db.prepare("SELECT id FROM Objects").all<{ id: string }>()
    expect(remainingObjs.results.map(r => r.id)).toEqual(['active-story-1'])

    const remainingLobby = await db.prepare("SELECT id FROM LobbyImages").all<{ id: string }>()
    expect(remainingLobby.results.map(r => r.id)).toEqual(['active-lobby-1'])

    const remainingSess = await db.prepare("SELECT id FROM Sessions").all<{ id: string }>()
    expect(remainingSess.results.map(r => r.id)).toEqual(['sess-act'])

    // Verify blob deletion
    expect(await blobStore.get('objects/expired-story-1')).toBeNull()
    expect(await blobStore.get('objects/active-story-1')).not.toBeNull()
    expect(await blobStore.get('lobby/expired-lobby-1')).toBeNull()
    expect(await blobStore.get('lobby/active-lobby-1')).not.toBeNull()
  })
})

describe('sweepOrphanedBlobs', () => {
  it('detects and removes orphaned files on disk whose DB records no longer exist', async () => {
    const db = await makeDb()
    const blobStore = new LocalBlobStore(dir)

    await db.prepare("INSERT INTO Users (id, public_key) VALUES ('user1', 'pub1')").run()
    await db.prepare("INSERT INTO Objects (id, owner_id, size_bytes, mime_type, content_url) VALUES ('legit-obj', 'user1', 3, 'image/jpeg', '/api/objects/legit-obj')").run()

    await blobStore.put('objects/legit-obj', new Uint8Array([1, 2, 3]))
    await blobStore.put('objects/orphan-obj', new Uint8Array([4, 5, 6]))
    await blobStore.put('lobby/orphan-lobby', new Uint8Array([7, 8, 9]))

    const swept = await sweepOrphanedBlobs(db, blobStore)
    expect(swept).toBe(2)

    expect(await blobStore.get('objects/legit-obj')).not.toBeNull()
    expect(await blobStore.get('objects/orphan-obj')).toBeNull()
    expect(await blobStore.get('lobby/orphan-lobby')).toBeNull()
  })
})

describe('runPeriodicMaintenance', () => {
  it('runs all cleanup phases in a single maintenance pass', async () => {
    const db = await makeDb()
    const blobStore = new LocalBlobStore(dir)

    const stats = await runPeriodicMaintenance(db, blobStore, Date.now(), true)
    expect(stats.pictureWiped).toBe(true)
    expect(stats.dailyScoresReset).toBe(true)
  })
})

describe('deleteOfflineUsers', () => {
  it('deletes users offline > 3 days and all their content', async () => {
    const db = await makeDb()
    const blobStore = new LocalBlobStore(dir)

    const pastIso = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString() // 4 days ago
    const recentIso = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString() // 1 day ago
    const futureIso = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 1 day from now

    // 1. Insert users
    await db.prepare("INSERT INTO Users (id, public_key, last_seen) VALUES ('offline-user', 'pub1', ?)").bind(pastIso).run()
    await db.prepare("INSERT INTO Users (id, public_key, last_seen) VALUES ('active-user', 'pub2', ?)").bind(recentIso).run()
    await db.prepare("INSERT INTO Users (id, public_key, last_seen) VALUES ('bot_test', 'pub3', ?)").bind(pastIso).run()

    // 2. Insert Objects for offline user
    await blobStore.put('objects/offline-obj-1', new Uint8Array([1, 2, 3]))
    await blobStore.put('objects/offline-obj-2', new Uint8Array([4, 5, 6]))
    await db.prepare("INSERT INTO Objects (id, owner_id, size_bytes, mime_type, content_url) VALUES ('offline-obj-1', 'offline-user', 3, 'image/jpeg', '/api/objects/offline-obj-1')").run()
    await db.prepare("INSERT INTO Objects (id, owner_id, size_bytes, mime_type, content_url) VALUES ('offline-obj-2', 'offline-user', 3, 'image/jpeg', '/api/objects/offline-obj-2')").run()

    // 3. Insert Objects for active user (should NOT be deleted)
    await blobStore.put('objects/active-obj-1', new Uint8Array([7, 8, 9]))
    await db.prepare("INSERT INTO Objects (id, owner_id, size_bytes, mime_type, content_url) VALUES ('active-obj-1', 'active-user', 3, 'image/jpeg', '/api/objects/active-obj-1')").run()

    // 4. Insert Cards for offline user
    await db.prepare("INSERT INTO Cards (id, creator_id, media_object_id, rarity, value) VALUES ('card-1', 'offline-user', 'offline-obj-1', 'common', 10)").run()
    await db.prepare("INSERT INTO Cards (id, creator_id, media_object_id, rarity, value) VALUES ('card-2', 'offline-user', 'offline-obj-2', 'copper', 50)").run()
    await db.prepare("INSERT INTO CardOwnership (card_id, owner_id) VALUES ('card-1', 'offline-user')").run()
    await db.prepare("INSERT INTO CardOwnership (card_id, owner_id) VALUES ('card-2', 'offline-user')").run()
    await db.prepare("INSERT INTO CardHistory (id, card_id, event, to_user) VALUES ('hist-1', 'card-1', 'created', 'offline-user')").run()
    await db.prepare("INSERT INTO CardHistory (id, card_id, event, to_user) VALUES ('hist-2', 'card-2', 'created', 'offline-user')").run()
    await db.prepare("INSERT INTO MarketListings (id, card_id, seller_id, price, status) VALUES ('listing-1', 'card-1', 'offline-user', 100, 'open')").run()
    await db.prepare("INSERT INTO DeckCards (deck_id, card_id) VALUES ('deck-1', 'card-1')").run()

    // 5. Insert LobbyImages for offline user
    await blobStore.put('lobby/offline-lobby-1', new Uint8Array([10, 11, 12]))
    await db.prepare("INSERT INTO LobbyImages (id, owner_id, content_url) VALUES ('offline-lobby-1', 'offline-user', '/api/lobby/images/offline-lobby-1/content')").run()

    // 6. Insert MatchCards for offline user
    await db.prepare("INSERT INTO MatchCards (id, room_id, owner_id, content_url) VALUES ('matchcard-1', 'room-1', 'offline-user', 'data:image/png;base64,abc')").run()

    // 7. Insert relational data for offline user
    await db.prepare("INSERT INTO Recipients (object_id, recipient_id) VALUES ('offline-obj-1', 'other-user')").run()
    await db.prepare("INSERT INTO Favorites (user_id, object_id) VALUES ('offline-user', 'offline-obj-1')").run()
    await db.prepare("INSERT INTO Likes (id, user_id, object_id, decision) VALUES ('like-1', 'offline-user', 'offline-obj-1', 'like')").run()
    await db.prepare("INSERT INTO LobbyComments (id, image_id, user_id, body) VALUES ('lc-1', 'offline-lobby-1', 'offline-user', 'test')").run()
    await db.prepare("INSERT INTO LobbyLikes (user_id, image_id) VALUES ('offline-user', 'offline-lobby-1')").run()
    await db.prepare("INSERT INTO PrivateMessages (id, sender_id, recipient_id, body) VALUES ('pm-1', 'offline-user', 'other-user', 'test')").run()
    await db.prepare("INSERT INTO MatchChat (id, match_id, sender_id, body) VALUES ('mc-1', 'match-1', 'offline-user', 'test')").run()
    await db.prepare("INSERT INTO LobbyChat (id, sender_id, body) VALUES ('lc-1', 'offline-user', 'test')").run()
    await db.prepare("INSERT INTO Notifications (id, user_id, type, title, body) VALUES ('notif-1', 'offline-user', 'test', 'title', 'body')").run()
    await db.prepare("INSERT INTO MatchInvites (id, inviter_id, invitee_id, status, expires_at) VALUES ('mi-1', 'offline-user', 'other-user', 'open', ?)").bind(futureIso).run()
    await db.prepare("INSERT INTO BabecockEntries (id, round_id, user_id, content_url) VALUES ('be-1', 'round-1', 'offline-user', 'url')").run()
    await db.prepare("INSERT INTO BabecockInvites (id, round_id, host_id, invitee_id, status) VALUES ('bi-1', 'round-1', 'offline-user', 'other-user', 'open')").run()
    await db.prepare("INSERT INTO Followers (follower_id, followee_id) VALUES ('offline-user', 'other-user')").run()
    await db.prepare("INSERT INTO Friends (user_id, friend_id) VALUES ('offline-user', 'other-user')").run()
    await db.prepare("INSERT INTO FriendRequests (id, sender_id, receiver_id, status) VALUES ('fr-1', 'offline-user', 'other-user', 'pending')").run()
    await db.prepare("INSERT INTO UserBlocks (blocker_id, blocked_id) VALUES ('offline-user', 'other-user')").run()
    await db.prepare("INSERT INTO UserReports (id, reporter_id, reported_id, reason) VALUES ('ur-1', 'offline-user', 'other-user', 'test')").run()
    await db.prepare("INSERT INTO Playtime (user_id, accumulated_ms) VALUES ('offline-user', 1000)").run()
    await db.prepare("INSERT INTO DonationAcknowledgement (user_id, acked_at) VALUES ('offline-user', ?)").bind(recentIso).run()
    await db.prepare("INSERT INTO SessionEvents (id, user_id, kind) VALUES ('se-1', 'offline-user', 'login')").run()
    await db.prepare("INSERT INTO StoreUnlocks (user_id, item_id) VALUES ('offline-user', 'item-1')").run()
    await db.prepare("INSERT INTO UserInventory (user_id, item_id, quantity) VALUES ('offline-user', 'item-1', 1)").run()
    await db.prepare("INSERT INTO DominationActions (id, dominator_id, victim_id, action) VALUES ('da-1', 'offline-user', 'other-user', 'test')").run()
    await db.prepare("INSERT INTO LeagueRank (user_id, wins, points) VALUES ('offline-user', 5, 100)").run()
    await db.prepare("INSERT INTO MatchArchive (id, user_a, user_b, score_a, score_b, result) VALUES ('ma-1', 'offline-user', 'other-user', 3, 2, 'winner_a')").run()
    await db.prepare("INSERT INTO Wallets (user_id, balance) VALUES ('offline-user', 5000)").run()
    await db.prepare("INSERT INTO LedgerTransactions (id, user_id, kind, delta, balance_after) VALUES ('lt-1', 'offline-user', 'grant', 100, 5000)").run()
    await db.prepare("INSERT INTO EconomicOperations (id, idempotency_key, user_id, kind) VALUES ('eo-1', 'key-1', 'offline-user', 'test')").run()

    // 8. Run deleteOfflineUsers
    const stats = await deleteOfflineUsers(db, blobStore, Date.now())

    expect(stats.deletedUsers).toBe(1)
    expect(stats.deletedObjects).toBe(2)
    expect(stats.deletedCards).toBe(2)
    expect(stats.deletedBlobs).toBeGreaterThan(0)

    // Verify offline user is deleted
    const offlineUser = await db.prepare("SELECT id FROM Users WHERE id = 'offline-user'").first()
    expect(offlineUser).toBeNull()

    // Verify active user is NOT deleted
    const activeUser = await db.prepare("SELECT id FROM Users WHERE id = 'active-user'").first()
    expect(activeUser).not.toBeNull()

    // Verify bot user is NOT deleted
    const botUser = await db.prepare("SELECT id FROM Users WHERE id = 'bot_test'").first()
    expect(botUser).not.toBeNull()

    // Verify offline user's objects are deleted
    const remainingObjs = await db.prepare("SELECT id FROM Objects WHERE owner_id = 'offline-user'").all<{ id: string }>()
    expect(remainingObjs.results.length).toBe(0)

    // Verify active user's objects are NOT deleted
    const activeObjs = await db.prepare("SELECT id FROM Objects WHERE owner_id = 'active-user'").all<{ id: string }>()
    expect(activeObjs.results.length).toBe(1)

    // Verify blobs are deleted for offline user
    expect(await blobStore.get('objects/offline-obj-1')).toBeNull()
    expect(await blobStore.get('objects/offline-obj-2')).toBeNull()
    expect(await blobStore.get('lobby/offline-lobby-1')).toBeNull()

    // Verify active user's blob is NOT deleted
    expect(await blobStore.get('objects/active-obj-1')).not.toBeNull()

    // Verify all relational data for offline user is deleted
    const checks = [
      { table: 'Cards', where: "creator_id = 'offline-user'" },
      { table: 'CardOwnership', where: "owner_id = 'offline-user'" },
      { table: 'CardHistory', where: "card_id IN ('card-1', 'card-2')" },
      { table: 'MarketListings', where: "seller_id = 'offline-user'" },
      { table: 'DeckCards', where: "card_id = 'card-1'" },
      { table: 'LobbyImages', where: "owner_id = 'offline-user'" },
      { table: 'MatchCards', where: "owner_id = 'offline-user'" },
      { table: 'Recipients', where: "recipient_id = 'offline-user'" },
      { table: 'Favorites', where: "user_id = 'offline-user'" },
      { table: 'Likes', where: "user_id = 'offline-user'" },
      { table: 'LobbyComments', where: "user_id = 'offline-user'" },
      { table: 'LobbyLikes', where: "user_id = 'offline-user'" },
      { table: 'PrivateMessages', where: "sender_id = 'offline-user' OR recipient_id = 'offline-user'" },
      { table: 'MatchChat', where: "sender_id = 'offline-user'" },
      { table: 'LobbyChat', where: "sender_id = 'offline-user'" },
      { table: 'Notifications', where: "user_id = 'offline-user'" },
      { table: 'MatchInvites', where: "inviter_id = 'offline-user' OR invitee_id = 'offline-user'" },
      { table: 'BabecockEntries', where: "user_id = 'offline-user'" },
      { table: 'BabecockInvites', where: "host_id = 'offline-user' OR invitee_id = 'offline-user'" },
      { table: 'Followers', where: "follower_id = 'offline-user' OR followee_id = 'offline-user'" },
      { table: 'Friends', where: "user_id = 'offline-user' OR friend_id = 'offline-user'" },
      { table: 'FriendRequests', where: "sender_id = 'offline-user' OR receiver_id = 'offline-user'" },
      { table: 'UserBlocks', where: "blocker_id = 'offline-user' OR blocked_id = 'offline-user'" },
      { table: 'UserReports', where: "reporter_id = 'offline-user' OR reported_id = 'offline-user'" },
      { table: 'Playtime', where: "user_id = 'offline-user'" },
      { table: 'DonationAcknowledgement', where: "user_id = 'offline-user'" },
      { table: 'SessionEvents', where: "user_id = 'offline-user'" },
      { table: 'StoreUnlocks', where: "user_id = 'offline-user'" },
      { table: 'UserInventory', where: "user_id = 'offline-user'" },
      { table: 'DominationActions', where: "dominator_id = 'offline-user' OR victim_id = 'offline-user'" },
      { table: 'LeagueRank', where: "user_id = 'offline-user'" },
      { table: 'MatchArchive', where: "user_a = 'offline-user' OR user_b = 'offline-user'" },
      { table: 'Wallets', where: "user_id = 'offline-user'" },
      { table: 'LedgerTransactions', where: "user_id = 'offline-user'" },
      { table: 'EconomicOperations', where: "user_id = 'offline-user'" },
    ]

    for (const check of checks) {
      const result = await db.prepare(`SELECT COUNT(*) as c FROM ${check.table} WHERE ${check.where}`).first<{ c: number }>()
      expect(result?.c).toBe(0)
    }

    // Verify admin audit log was created
    const audit = await db.prepare("SELECT * FROM AdminAuditLog WHERE action = 'offline_user_purge'").first()
    expect(audit).not.toBeNull()
  })

  it('does not delete users with last_seen < 3 days', async () => {
    const db = await makeDb()
    const blobStore = new LocalBlobStore(dir)

    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
    await db.prepare("INSERT INTO Users (id, public_key, last_seen) VALUES ('recent-user', 'pub1', ?)").bind(twoDaysAgo).run()

    const stats = await deleteOfflineUsers(db, blobStore, Date.now())
    expect(stats.deletedUsers).toBe(0)

    const user = await db.prepare("SELECT id FROM Users WHERE id = 'recent-user'").first()
    expect(user).not.toBeNull()
  })
})

describe('sendOfflineWarnings', () => {
  it('sends warnings to users offline 2-3 days', async () => {
    const db = await makeDb()
    const now = Date.now()

    // Use 2.5 days ago (60 hours) - clearly in the 2-3 day warning window
    const twoPointFiveDaysAgo = new Date(now - 2.5 * 24 * 60 * 60 * 1000).toISOString()
    const fourDaysAgo = new Date(now - 4 * 24 * 60 * 60 * 1000).toISOString()

    await db.prepare("INSERT INTO Users (id, public_key, last_seen) VALUES ('warning-user', 'pub1', ?)").bind(twoPointFiveDaysAgo).run()
    await db.prepare("INSERT INTO Users (id, public_key, last_seen) VALUES ('deletion-user', 'pub2', ?)").bind(fourDaysAgo).run()
    await db.prepare("INSERT INTO Users (id, public_key, last_seen) VALUES ('active-user', 'pub3', ?)").bind(new Date(now - 24 * 60 * 60 * 1000).toISOString()).run()

    const warnedCount = await sendOfflineWarnings(db, now)
    expect(warnedCount).toBe(1)

    // Verify notification was created
    const notif = await db.prepare("SELECT * FROM Notifications WHERE user_id = 'warning-user' AND type = 'offline_warning'").first()
    expect(notif).not.toBeNull()
    expect(notif?.title).toBe('Account expires soon')
    expect(notif?.body).toContain('permanently deleted')
    expect(notif?.body).toContain('permanently deleted')

    // Verify SystemMeta tracking was created
    const meta = await db.prepare("SELECT * FROM SystemMeta WHERE key LIKE 'offline_warning_warning-user_%'").first()
    expect(meta).not.toBeNull()

    // Second call on same day should not send duplicate
    const warnedCount2 = await sendOfflineWarnings(db, now)
    expect(warnedCount2).toBe(0)
  })

  it('does not send warnings to bots or users not in warning window', async () => {
    const db = await makeDb()
    const now = Date.now()

    const twoDaysAgo = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString()
    await db.prepare("INSERT INTO Users (id, public_key, last_seen) VALUES ('bot_test', 'pub1', ?)").bind(twoDaysAgo).run()

    const warnedCount = await sendOfflineWarnings(db, now)
    expect(warnedCount).toBe(0)
  })
})