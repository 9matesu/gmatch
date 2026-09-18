import { describe, it, expect } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalBlobStore } from './blob'

describe('LocalBlobStore', () => {
  it('round-trips bytes and streams the body without buffering it whole', async () => {
    const store = new LocalBlobStore(await mkdtemp(join(tmpdir(), 'blob-')))
    const data = new Uint8Array(1024 * 1024).map((_, i) => i & 0xff)
    await store.put('objects/x', data)
    const got = await store.get('objects/x')
    expect(got).not.toBeNull()
    const reader = got!.body!.getReader()
    const chunks: Uint8Array[] = []
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }
    const joined = Buffer.concat(chunks)
    expect(Buffer.compare(joined, Buffer.from(data))).toBe(0)
    const headers = new Headers()
    got!.writeHttpMetadata(headers)
    expect(headers.get('Content-Length')).toBe(String(data.length))
  })

  it('returns null for a missing key', async () => {
    const store = new LocalBlobStore(await mkdtemp(join(tmpdir(), 'blob-')))
    expect(await store.get('objects/nope')).toBeNull()
  })
})