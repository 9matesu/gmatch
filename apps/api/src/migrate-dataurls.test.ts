import { describe, it, expect } from 'vitest'
import { createClient } from '@libsql/client'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { D1Turso, ensureSchema } from './db'
import { LocalBlobStore } from './blob'
import { migrateDataUrls } from './migrate-dataurls'
import { decryptBlob } from './crypto'

describe('migrateDataUrls', () => {
  it('moves inline data: URLs to encrypted blobs and skips http rows', async () => {
    process.env.STORAGE_ENCRYPTION_KEY = 'aa'.repeat(32)
    const dir = await mkdtemp(join(tmpdir(), 'migrate-'))
    const client = createClient({ url: ':memory:' })
    await ensureSchema(client)
    const db = new D1Turso(client)
    const bucket = new LocalBlobStore(dir)

    const b64 = Buffer.from('hello').toString('base64')
    await db.prepare(
      "INSERT INTO Objects (id, owner_id, size_bytes, mime_type, content_url) VALUES ('obj1', 'u1', 50, 'text/plain', ?)"
    ).bind(`data:image/png;base64,${b64}`).run()

    await db.prepare(
      "INSERT INTO Objects (id, owner_id, size_bytes, mime_type, content_url) VALUES ('obj2', 'u1', 10, 'text/plain', 'https://example.com/img.png')"
    ).run()

    const moved = await migrateDataUrls(db, bucket)
    expect(moved).toBe(1)

    const row = await db.prepare("SELECT content_url, mime_type, size_bytes FROM Objects WHERE id = 'obj1'").first<{ content_url: string; mime_type: string; size_bytes: number }>()
    expect(row!.content_url).toBe('objects/obj1')
    expect(row!.mime_type).toBe('image/png')
    expect(row!.size_bytes).toBe(5)

    const blob = await bucket.get('objects/obj1')
    expect(blob).not.toBeNull()
    const reader = blob!.body!.getReader()
    const chunks: Uint8Array[] = []
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }
    const encrypted = Buffer.concat(chunks)
    const decrypted = decryptBlob(new Uint8Array(encrypted))
    expect(Buffer.from(decrypted).toString()).toBe('hello')

    const row2 = await db.prepare("SELECT content_url FROM Objects WHERE id = 'obj2'").first<{ content_url: string }>()
    expect(row2!.content_url).toBe('https://example.com/img.png')
  })

  it('is idempotent on re-run', async () => {
    process.env.STORAGE_ENCRYPTION_KEY = 'aa'.repeat(32)
    const dir = await mkdtemp(join(tmpdir(), 'migrate-'))
    const client = createClient({ url: ':memory:' })
    await ensureSchema(client)
    const db = new D1Turso(client)
    const bucket = new LocalBlobStore(dir)

    const b64 = Buffer.from('x').toString('base64')
    await db.prepare(
      "INSERT INTO Objects (id, owner_id, size_bytes, mime_type, content_url) VALUES ('o1', 'u1', 1, 'text/plain', ?)"
    ).bind(`data:image/jpeg;base64,${b64}`).run()

    await migrateDataUrls(db, bucket)
    const second = await migrateDataUrls(db, bucket)
    expect(second).toBe(0)
  })
})