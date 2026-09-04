import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createClient, type Client } from '@libsql/client'
import { snapshotDb, restoreDb } from './persistence'
import { ensureSchema } from './db'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let dir: string
let snapshotPath: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'orbit-snapshot-'))
  snapshotPath = join(dir, 'orbit.snapshot.sqlite')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true }).catch(() => {})
})

async function makeClient(): Promise<Client> {
  const client = createClient({ url: ':memory:' })
  await ensureSchema(client)
  return client
}

describe('snapshotDb / restoreDb', () => {
  it('persists and restores rows into a fresh in-memory db', async () => {
    const src = await makeClient()
    await src.execute("INSERT INTO Users (id, public_key) VALUES ('u1', 'pub1')")
    await src.execute("INSERT INTO Friends (user_id, friend_id) VALUES ('u1', 'u2')")
    await snapshotDb(src, snapshotPath)

    const dst = await makeClient()
    const restored = await restoreDb(dst, snapshotPath)
    expect(restored).toBe(true)
    const users = await dst.execute("SELECT * FROM Users WHERE id = 'u1'")
    expect(users.rows.length).toBe(1)
    const friends = await dst.execute("SELECT * FROM Friends WHERE user_id = 'u1'")
    expect(friends.rows.length).toBe(1)
  })

  it('returns false when no snapshot file exists', async () => {
    const dst = await makeClient()
    expect(await restoreDb(dst, join(dir, 'missing.sqlite'))).toBe(false)
  })

  it('is a no-op for empty paths', async () => {
    const src = await makeClient()
    await expect(snapshotDb(src, '')).resolves.toBeUndefined()
    expect(await restoreDb(src, '')).toBe(false)
  })

  it('writes a valid SQLite file readable by a fresh file-backed client', async () => {
    const src = await makeClient()
    await src.execute("INSERT INTO Likes (id, user_id, object_id, decision) VALUES ('l1', 'u1', 'o1', 'yes')")
    await snapshotDb(src, snapshotPath)

    const fileUrl = `file:${snapshotPath.replace(/\\/g, '/')}`
    const fileC = createClient({ url: fileUrl })
    const res = await fileC.execute('SELECT * FROM Likes')
    expect(res.rows.length).toBe(1)
    expect((res.rows[0] as any).decision).toBe('yes')
  })

  it('restores blobs of columns added later via ALTER (schema drift)', async () => {
    const src = await makeClient()
    await src.execute("INSERT INTO Users (id, public_key, maximum_gooner) VALUES ('u9', 'pub9', 4)")
    await snapshotDb(src, snapshotPath)

    const dst = await makeClient()
    await restoreDb(dst, snapshotPath)
    const res = await dst.execute("SELECT maximum_gooner FROM Users WHERE id = 'u9'")
    expect((res.rows[0] as any).maximum_gooner).toBe(4)
  })

  it('restores profile data from an older snapshot schema with fewer columns', async () => {
    // Simulate a snapshot written by a previous deploy whose Users table had
    // only a legacy subset of columns (no hidden_at / bio etc). Restoring into
    // the current 32-column schema must map columns by NAME so the profile
    // survives instead of the whole table silently dropping (the bug that
    // wiped old accounts' name/pfp/bio after the hidden_at deploy).
    const src = createClient({ url: ':memory:' })
    await src.execute(`
      CREATE TABLE Users (
        id TEXT PRIMARY KEY,
        public_key TEXT NOT NULL,
        display_name TEXT,
        tags TEXT,
        last_seen DATETIME,
        pfp_url TEXT,
        bio TEXT
      )
    `)
    await src.execute(
      "INSERT INTO Users (id, public_key, display_name, tags, last_seen, pfp_url, bio) VALUES ('legacy', 'legacy-pub', 'Old Guard', '[\"veteran\"]', '2026-08-19T00:00:00.000Z', 'https://example.test/pfp.jpg', 'Grandfathered bio')"
    )
    await snapshotDb(src, snapshotPath)

    const dst = await makeClient()
    expect(await restoreDb(dst, snapshotPath)).toBe(true)
    const row = (await dst.execute("SELECT * FROM Users WHERE id = 'legacy'")).rows[0] as any
    expect(row).toBeTruthy()
    expect(row.display_name).toBe('Old Guard')
    expect(row.pfp_url).toBe('https://example.test/pfp.jpg')
    expect(row.bio).toBe('Grandfathered bio')
    expect(row.tags).toBe('["veteran"]')
    expect(row.hidden_at).toBeNull()
  })
})