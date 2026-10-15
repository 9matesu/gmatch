import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createClient, type Client } from '@libsql/client'
import { D1Turso, ensureSchema } from './db'
import { LocalBlobStore } from './blob'
import { maybeNormalizeTags, deleteExpiredContent, sweepOrphanedBlobs, runPeriodicMaintenance } from './cleanup'
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

  it('flips never-acked domination actions to expired after 30 min', async () => {
    const db = await makeDb()
    await db.prepare("INSERT INTO Users (id, public_key) VALUES ('d1', 'p'), ('v1', 'p')").run()
    const old = new Date(Date.now() - 31 * 60_000).toISOString()
    const fresh = new Date(Date.now() - 2 * 60_000).toISOString()
    await db.prepare("INSERT INTO DominationActions (id, dominator_id, victim_id, action, status, created_at) VALUES ('stale', 'd1', 'v1', 'blur', 'sent', ?)").bind(old).run()
    await db.prepare("INSERT INTO DominationActions (id, dominator_id, victim_id, action, status, created_at) VALUES ('live', 'd1', 'v1', 'blur', 'sent', ?)").bind(fresh).run()
    await db.prepare("INSERT INTO DominationActions (id, dominator_id, victim_id, action, status, created_at, executed_at) VALUES ('done', 'd1', 'v1', 'blur', 'executed', ?, ?)").bind(old, old).run()

    await deleteExpiredContent(db, undefined, Date.now())

    const row = (id: string) => db.prepare('SELECT status FROM DominationActions WHERE id = ?').bind(id).first<{ status: string }>()
    expect((await row('stale'))?.status).toBe('expired')
    expect((await row('live'))?.status).toBe('sent')
    expect((await row('done'))?.status).toBe('executed')
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

describe('offline durability (no 3-day wipe)', () => {
  it('runPeriodicMaintenance keeps offline users and their content', async () => {
    const db = await makeDb()
    const blobStore = new LocalBlobStore(dir)
    const oldIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    await db.prepare("INSERT INTO Users (id, public_key, display_name, last_seen) VALUES ('gone-user', 'pub1', 'Gone', ?)").bind(oldIso).run()
    await db.prepare("INSERT INTO Objects (id, owner_id, size_bytes, mime_type, is_public) VALUES ('gone-obj', 'gone-user', 10, 'image/jpeg', 1)").run()

    await runPeriodicMaintenance(db, blobStore, Date.now())

    const user = await db.prepare("SELECT id FROM Users WHERE id = 'gone-user'").first()
    expect(user).not.toBeNull()
    const obj = await db.prepare("SELECT id FROM Objects WHERE id = 'gone-obj'").first()
    expect(obj).not.toBeNull()
  })
})
