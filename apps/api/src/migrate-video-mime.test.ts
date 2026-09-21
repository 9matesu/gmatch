import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMockEnv } from './test-utils'
import { LocalBlobStore } from './blob'
import { encryptBlob } from './crypto'
import { repairVideoMime } from './migrate-video-mime'
import type { D1Turso } from './db'

const MP4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32, 0, 0, 0, 0])
const FREE_MP4 = new Uint8Array([0, 0, 0, 8, 0x66, 0x72, 0x65, 0x65, 0, 0, 0, 0])
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3])

async function seedObject(db: D1Turso, row: { id: string; mime: string; url: string; hash?: string | null }) {
  await db.prepare(
    'INSERT INTO Objects (id, owner_id, size_bytes, mime_type, content_url, content_hash, is_public) VALUES (?, ?, ?, ?, ?, ?, 1)'
  ).bind(row.id, 'owner-1', 16, row.mime, row.url, row.hash ?? null).run()
}

describe('repairVideoMime', () => {
  let db: D1Turso
  let bucket: LocalBlobStore

  beforeEach(async () => {
    const env = await createMockEnv()
    db = env.DB
    bucket = new LocalBlobStore(await mkdtemp(join(tmpdir(), 'vidmime-')))
  })

  it('re-sniffs byte-backed rows mislabeled as image/jpeg', async () => {
    await seedObject(db, { id: 'vid-bucket-1', mime: 'image/jpeg', url: 'objects/vid-bucket-1' })
    await bucket.put('objects/vid-bucket-1', encryptBlob(MP4))
    await seedObject(db, { id: 'vid-data-1', mime: 'application/octet-stream', url: `data:video/mp4;base64,${Buffer.from(MP4).toString('base64')}` })
    await seedObject(db, { id: 'img-ok-1', mime: 'image/jpeg', url: 'objects/img-ok-1' })
    await bucket.put('objects/img-ok-1', encryptBlob(JPEG))

    const stats = await repairVideoMime(db, bucket)
    expect(stats.sniffed).toBe(2)

    const fixed = await db.prepare('SELECT mime_type FROM Objects WHERE id = ?').bind('vid-bucket-1').first<{ mime_type: string }>()
    expect(fixed?.mime_type).toBe('video/mp4')
    const fixedData = await db.prepare('SELECT mime_type FROM Objects WHERE id = ?').bind('vid-data-1').first<{ mime_type: string }>()
    expect(fixedData?.mime_type).toBe('video/mp4')
    const untouched = await db.prepare('SELECT mime_type FROM Objects WHERE id = ?').bind('img-ok-1').first<{ mime_type: string }>()
    expect(untouched?.mime_type).toBe('image/jpeg')
  })

  it('rewrites loopback content_urls to urn when a hash exists, else to the object stream', async () => {
    const hash = 'a'.repeat(64)
    await seedObject(db, { id: 'loop-hash', mime: 'video/mp4', url: 'http://127.0.0.1:54321/f/abc.mp4', hash })
    await seedObject(db, { id: 'loop-nohash', mime: 'video/mp4', url: 'http://localhost:9/f/xyz.img' })

    const stats = await repairVideoMime(db, bucket)
    expect(stats.loopbackRewritten).toBe(2)

    const a = await db.prepare('SELECT content_url FROM Objects WHERE id = ?').bind('loop-hash').first<{ content_url: string }>()
    expect(a?.content_url).toBe(`urn:sha256:${hash}`)
    const b = await db.prepare('SELECT content_url FROM Objects WHERE id = ?').bind('loop-nohash').first<{ content_url: string }>()
    expect(b?.content_url).toBe('/api/objects/loop-nohash')
  })

  it('never touches p2p rows without server bytes and is idempotent via flag', async () => {
    await seedObject(db, { id: 'p2p-1', mime: 'application/octet-stream', url: 'magnet:?xt=urn:btih:abc', hash: 'b'.repeat(64) })

    const first = await repairVideoMime(db, bucket)
    expect(first.sniffed).toBe(0)
    const row = await db.prepare('SELECT mime_type, content_url FROM Objects WHERE id = ?').bind('p2p-1').first<{ mime_type: string; content_url: string }>()
    expect(row?.mime_type).toBe('application/octet-stream')
    expect(row?.content_url).toBe('magnet:?xt=urn:btih:abc')

    const second = await repairVideoMime(db, bucket)
    expect(second).toEqual({ sniffed: 0, loopbackRewritten: 0 })
  })
})
