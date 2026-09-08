// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type Client } from '@libsql/client'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { snapshotDb, restoreDb } from './persistence'
import { ensureSchema } from './db'

// Crash-safety regression: a leftover <path>.tmp (killed mid-write) must NOT
// poison every future snapshot — VACUUM INTO fails on existing files, so
// snapshotDb must clear the stale temp first.
describe('snapshotDb stale .tmp recovery', () => {
  let dir: string
  let src: Client

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'snap-recovery-'))
    src = createClient({ url: ':memory:' })
    await ensureSchema(src)
    await src.execute("INSERT INTO Users (id, public_key) VALUES ('u1', 'pub1')")
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('overwrites a stale tmp and keeps snapshotting', async () => {
    const snapPath = join(dir, 'orbit.sqlite')
    writeFileSync(`${snapPath}.tmp`, 'garbage from a previous crash')
    await snapshotDb(src, snapPath)
    expect(existsSync(`${snapPath}.tmp`)).toBe(false) // tmp consumed, not left behind

    const dst = createClient({ url: ':memory:' })
    await ensureSchema(dst)
    await expect(restoreDb(dst, snapPath)).resolves.toBe(true)
    const rows = await dst.execute('SELECT id FROM Users')
    expect(rows.rows.length).toBe(1)

    // second snapshot still fine (idempotent loop, like the 30s interval)
    await snapshotDb(src, snapPath)
    await snapshotDb(src, snapPath)
  })
})
