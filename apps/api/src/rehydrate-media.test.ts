import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import {
  archiveHashMatches,
  btihFromMagnet,
  candidateIdentifiesRow,
  parseIndexedDbRecord,
  readCloneBlob,
  readCloneString,
  readIndexedDbCandidates,
  readVaultCandidates,
  readVaultManifest,
  readEncryptedCacheCandidates,
  rehydrateMedia,
  selectArchiveRows,
  sha256Hex,
  type ArchiveObject,
} from './rehydrate-media'
import { LocalBlobStore } from './blob'
import { encryptBlob, decryptBlob } from './crypto'

const KEY = 'b'.repeat(64)

// The node encrypts blobs at rest with STORAGE_ENCRYPTION_KEY; the campaign
// writes through the same path, so the key must exist in the test process.
beforeEach(() => {
  process.env.STORAGE_ENCRYPTION_KEY = 'a'.repeat(64)
})

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'rehydrate-'))
}

function bytesOf(n: number, seed = 7): Uint8Array {
  const b = new Uint8Array(n)
  for (let i = 0; i < n; i++) b[i] = (i * seed) % 251
  return b
}

describe('archive hash identity', () => {
  it('matches a 64-hex content_hash against the full sha256', () => {
    const digest = 'a'.repeat(64)
    expect(archiveHashMatches(digest, 'A'.repeat(64))).toBe(true)
    expect(archiveHashMatches(digest, 'b'.repeat(64))).toBe(false)
  })

  it('matches a 40-hex content_hash against the first 40 hex of the sha256', () => {
    // The old archive wrote btih = sha256(bytes).slice(0, 40).
    const digest = 'c'.repeat(40) + 'f'.repeat(24)
    expect(archiveHashMatches(digest, 'c'.repeat(40))).toBe(true)
    expect(archiveHashMatches(digest, 'c'.repeat(39) + 'e')).toBe(false)
  })

  it('never matches without a hash, or with a length the archive never wrote', () => {
    expect(archiveHashMatches('a'.repeat(64), null)).toBe(false)
    expect(archiveHashMatches('a'.repeat(64), '')).toBe(false)
    expect(archiveHashMatches('a'.repeat(64), 'a'.repeat(63))).toBe(false)
  })

  it('accepts the era where the object id IS the sha256 of the bytes', () => {
    const row: ArchiveObject = {
      id: 'd'.repeat(64),
      contentHash: null,
      mimeType: 'image/jpeg',
      sizeBytes: 10,
      createdAt: null,
      contentUrl: 'magnet:?xt=urn:btih:' + 'd'.repeat(40),
    }
    expect(candidateIdentifiesRow('d'.repeat(64), row)).toBe(true)
    expect(candidateIdentifiesRow('e'.repeat(64), row)).toBe(false)
  })

  it('reads the btih out of a magnet', () => {
    expect(btihFromMagnet('magnet:?xt=urn:btih:83AC86DE28188309A2DAD09326C538FC184B977F&dn=x')).toBe(
      '83ac86de28188309a2dad09326c538fc184b977f',
    )
    expect(btihFromMagnet('https://example.com/x.jpg')).toBeNull()
  })
})

describe('local byte sources', () => {
  it('reads vault entries, decrypting the encrypted ones and rejecting damaged ones', () => {
    const dir = tmp()
    try {
      const plain = bytesOf(1000)
      const secret = bytesOf(2000, 3)
      const damaged = bytesOf(500, 5)
      writeFileSync(join(dir, 'plain.bin'), Buffer.from(plain))
      writeFileSync(join(dir, 'secret.bin'), Buffer.from(encryptBlob(secret, KEY)))
      writeFileSync(join(dir, 'damaged.bin'), Buffer.from(encryptBlob(damaged, KEY)))
      const manifest = {
        'https://x/1.jpg': { file: 'plain.bin', mime: 'image/jpeg', bytes: 1000, hash: sha256Hex(plain) },
        'local://s': { file: 'secret.bin', mime: 'image/jpeg', bytes: 2000, hash: sha256Hex(secret), enc: 1 },
        'local://d': { file: 'damaged.bin', mime: 'image/jpeg', bytes: 500, hash: sha256Hex(bytesOf(999)), enc: 1 },
      }
      writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest))

      expect(readVaultManifest(dir)).toHaveLength(3)
      const candidates = readVaultCandidates(dir, KEY)
      expect(candidates).toHaveLength(2)
      const digests = candidates.map((c) => sha256Hex(c.bytes)).sort()
      expect(digests).toContain(sha256Hex(plain))
      expect(digests).toContain(sha256Hex(secret))
      // The damaged entry (manifest hash disagrees with the bytes) is dropped.
      expect(digests).not.toContain(sha256Hex(damaged))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reads the encrypted picture LRU', () => {
    const dir = tmp()
    try {
      const media = bytesOf(777, 11)
      writeFileSync(join(dir, 'a_img.enc'), Buffer.from(encryptBlob(media, KEY)))
      const candidates = readEncryptedCacheCandidates(dir, KEY)
      expect(candidates).toHaveLength(1)
      expect(sha256Hex(candidates[0].bytes)).toBe(sha256Hex(media))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('the rehydration campaign', () => {
  let dir: string
  let bucket: LocalBlobStore

  beforeEach(() => {
    dir = tmp()
    bucket = new LocalBlobStore(join(dir, 'blobs'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const row = (over: Partial<ArchiveObject> = {}): ArchiveObject => ({
    id: 'obj-1',
    contentHash: null,
    mimeType: 'image/jpeg',
    sizeBytes: 10,
    createdAt: null,
    contentUrl: 'magnet:?xt=urn:btih:' + 'a'.repeat(40),
    ...over,
  })

  it('writes local bytes under the object id when the hash identifies the row', async () => {
    const bytes = bytesOf(64, 13)
    const digest = sha256Hex(bytes)
    const report = await rehydrateMedia({
      rows: [row({ contentHash: digest.slice(0, 40) })],
      bucket,
      candidates: [{ source: 'vault', label: 'x', bytes }],
    })
    expect(report.recovered).toBe(1)
    expect(report.written).toBe(1)
    const stored = await bucket.get('objects/obj-1')
    expect(stored).not.toBeNull()
    const chunks: Buffer[] = []
    const reader = (stored as any).body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(Buffer.from(value))
    }
    // The node stores blobs encrypted at rest and decrypts on read, so the
    // round-trip is checked the way the node reads them.
    expect(sha256Hex(decryptBlob(new Uint8Array(Buffer.concat(chunks)), 'a'.repeat(64)))).toBe(digest)
  })

  it('leaves a row alone when nothing identifies the bytes', async () => {
    const report = await rehydrateMedia({
      rows: [row({ contentHash: 'b'.repeat(40) })],
      bucket,
      candidates: [{ source: 'vault', label: 'x', bytes: bytesOf(64, 13) }],
    })
    expect(report.recovered).toBe(0)
    expect(report.entries[0].outcome).toBe('no-bytes')
    expect(await bucket.get('objects/obj-1')).toBeNull()
  })

  it('never installs bytes that disagree with the row hash', async () => {
    const report = await rehydrateMedia({
      rows: [row({ contentHash: 'c'.repeat(40) })],
      bucket,
      candidates: [{ source: 'vault', label: 'x', bytes: bytesOf(64, 13) }],
    })
    expect(report.recovered).toBe(0)
    expect(await bucket.get('objects/obj-1')).toBeNull()
  })

  it('skips rows the node already holds bytes for', async () => {
    const report = await rehydrateMedia({
      rows: [row()],
      bucket,
      hasBytes: async () => true,
    })
    expect(report.alreadyPresent).toBe(1)
    expect(report.entries[0].outcome).toBe('already-present')
  })

  it('reports without writing in dry-run mode', async () => {
    const bytes = bytesOf(32, 17)
    const report = await rehydrateMedia({
      rows: [row({ contentHash: sha256Hex(bytes).slice(0, 40) })],
      bucket,
      candidates: [{ source: 'vault', label: 'x', bytes }],
      dryRun: true,
    })
    expect(report.recovered).toBe(1)
    expect(report.written).toBe(0)
    expect(await bucket.get('objects/obj-1')).toBeNull()
  })

  it('selects only descriptor rows that are missing bytes', async () => {
    const rows: ArchiveObject[] = [
      row({ id: 'magnet-row', contentUrl: 'magnet:?xt=urn:btih:' + 'a'.repeat(40) }),
      row({ id: 'urn-row', contentUrl: 'urn:sha256:' + 'a'.repeat(64) }),
      row({ id: 'http-row', contentUrl: 'https://example.com/a.jpg' }),
      row({ id: 'present-row', contentUrl: 'magnet:?xt=urn:btih:' + 'a'.repeat(40) }),
    ]
    const selected = await selectArchiveRows(rows, async (id) => id === 'present-row')
    expect(selected.map((r) => r.id)).toEqual(['magnet-row', 'urn-row'])
  })
})

describe('remote byte sources', () => {
  let dir: string
  let bucket: LocalBlobStore
  let server: import('node:http').Server
  let port: number
  let served: { status: number; contentType: string; body: Buffer } = {
    status: 404,
    contentType: 'application/json',
    body: Buffer.from('{"error":"Object not found"}'),
  }

  beforeEach(async () => {
    dir = tmp()
    bucket = new LocalBlobStore(join(dir, 'blobs'))
    server = createServer((req, res) => {
      res.writeHead(served.status, { 'content-type': served.contentType })
      res.end(served.body)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    port = (server.address() as any).port
  })
  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(dir, { recursive: true, force: true })
  })

  const row = (over: Partial<ArchiveObject> = {}): ArchiveObject => ({
    id: 'obj-1',
    contentHash: null,
    mimeType: 'image/jpeg',
    sizeBytes: 10,
    createdAt: null,
    contentUrl: 'magnet:?xt=urn:btih:' + 'a'.repeat(40),
    ...over,
  })

  it('never installs a remote error body as the post media', async () => {
    const report = await rehydrateMedia({
      rows: [row()],
      bucket,
      remotes: [{ base: `http://127.0.0.1:${port}` }],
    })
    expect(report.recovered).toBe(0)
    expect(report.entries[0].outcome).toBe('no-bytes')
    expect(await bucket.get('objects/obj-1')).toBeNull()
  })

  it('takes bytes a remote serves for an id that carries no hash', async () => {
    const media = bytesOf(256, 23)
    served = { status: 200, contentType: 'image/jpeg', body: Buffer.from(media) }
    const report = await rehydrateMedia({
      rows: [row()],
      bucket,
      remotes: [{ base: `http://127.0.0.1:${port}` }],
    })
    expect(report.recovered).toBe(1)
    expect(report.written).toBe(1)
  })

  it('refuses remote bytes that contradict the row hash', async () => {
    served = { status: 200, contentType: 'image/jpeg', body: Buffer.from(bytesOf(256, 23)) }
    const report = await rehydrateMedia({
      rows: [row({ contentHash: 'd'.repeat(40) })],
      bucket,
      remotes: [{ base: `http://127.0.0.1:${port}` }],
    })
    expect(report.recovered).toBe(0)
    expect(report.entries[0].outcome).toBe('hash-mismatch')
    expect(await bucket.get('objects/obj-1')).toBeNull()
  })

  it('takes remote bytes whose hash identifies the row', async () => {
    const media = bytesOf(256, 29)
    served = { status: 200, contentType: 'image/jpeg', body: Buffer.from(media) }
    const report = await rehydrateMedia({
      rows: [row({ contentHash: sha256Hex(media).slice(0, 40) })],
      bucket,
      remotes: [{ base: `http://127.0.0.1:${port}` }],
    })
    expect(report.recovered).toBe(1)
    expect(report.written).toBe(1)
  })
})

describe('blob encryption round-trip', () => {
  it('uses the same envelope the node decrypts with', () => {
    const plain = bytesOf(1234, 19)
    const enc = encryptBlob(plain, KEY)
    expect(enc.length).toBe(plain.length + 28)
    expect(Buffer.from(decryptBlob(enc, KEY))).toEqual(Buffer.from(plain))
  })

  it('refuses a key that is not the one used to encrypt', () => {
    const enc = encryptBlob(bytesOf(32), KEY)
    expect(() => decryptBlob(enc, 'c'.repeat(64))).toThrow()
  })
})

/**
 * Blink's structured clone, the shape Chromium writes into the IndexedDB
 * external blob store:
 *   property name -> 0x22 <len> <name>
 *   string value   -> 0x22 <len> <chars>
 *   blob value     -> 'B' (0x42) + LEB128 length + bytes
 */
function cloneName(name: string): Buffer {
  return Buffer.concat([Buffer.from([0x22, name.length]), Buffer.from(name, 'latin1')])
}

function cloneString(name: string, value: string): Buffer {
  return Buffer.concat([
    cloneName(name),
    Buffer.from([0x22, value.length]),
    Buffer.from(value, 'latin1'),
  ])
}

function cloneBlob(bytes: Uint8Array): Buffer {
  const size: number[] = []
  let value = bytes.length
  do {
    let byte = value & 0x7f
    value >>>= 7
    if (value > 0) byte |= 0x80
    size.push(byte)
  } while (value > 0)
  return Buffer.concat([
    cloneName('data'),
    Buffer.from([0x42]),
    Buffer.from(size),
    Buffer.from(bytes),
  ])
}

function cloneRecord(id: string, mime: string, bytes: Uint8Array): Buffer {
  return Buffer.concat([cloneString('id', id), cloneString('mime_type', mime), cloneBlob(bytes)])
}

describe('chromium indexeddb blob store', () => {
  it('parses a record and returns the exact blob bytes', () => {
    const media = bytesOf(4096, 13)
    const buf = cloneRecord('abc-123', 'image/jpeg', media)
    const record = parseIndexedDbRecord(buf)
    expect(record).not.toBeNull()
    expect(record!.id).toBe('abc-123')
    expect(record!.mimeType).toBe('image/jpeg')
    expect(Buffer.from(record!.bytes)).toEqual(Buffer.from(media))
    // The parsed bytes hash to the media: the caller can prove identity.
    expect(sha256Hex(record!.bytes)).toBe(sha256Hex(media))
  })

  it('reads a long blob through its multi-byte varint length', () => {
    const media = bytesOf(70000, 3)
    const buf = cloneRecord('long', 'video/mp4', media)
    expect(Buffer.from(readCloneBlob(buf)!)).toEqual(Buffer.from(media))
  })

  it('rejects a record whose blob claims more bytes than the file holds', () => {
    const media = bytesOf(100, 5)
    const buf = cloneRecord('short', 'image/jpeg', media)
    const truncated = buf.subarray(0, buf.length - 50)
    expect(parseIndexedDbRecord(truncated)).toBeNull()
  })

  it('rejects a file that is not a clone at all', () => {
    expect(parseIndexedDbRecord(Buffer.from('not a structured clone'))).toBeNull()
    expect(readCloneString(Buffer.from('nothing here'), 'id')).toBeNull()
  })

  it('walks nested directories and keeps only the wanted digests', () => {
    const dir = tmp()
    try {
      const wanted = bytesOf(2048, 7)
      const other = bytesOf(2048, 9)
      const nested = join(dir, 'origin.indexeddb.blob', '1', '00')
      mkdirSync(nested, { recursive: true })
      writeFileSync(join(nested, 'a'), cloneRecord('a', 'image/png', wanted))
      writeFileSync(join(nested, 'b'), cloneRecord('b', 'image/png', other))
      writeFileSync(join(dir, 'noise'), Buffer.from('garbage'))

      const all = readIndexedDbCandidates(dir)
      expect(all).toHaveLength(2)

      const filtered = readIndexedDbCandidates(dir, {
        full: new Set([sha256Hex(wanted)]),
        prefix: new Set(),
      })
      expect(filtered).toHaveLength(1)
      expect(sha256Hex(filtered[0].bytes)).toBe(sha256Hex(wanted))
      expect(filtered[0].source).toBe('indexeddb')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
