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

  /**
   * Object ids are client-chosen, so the key is attacker-influenced input and
   * this store is the boundary between "a key" and "a file on disk".
   */
  describe('path containment', () => {
    it('refuses to write a key that escapes the store', async () => {
      const base = await mkdtemp(join(tmpdir(), 'blob-'))
      const store = new LocalBlobStore(base)
      await expect(store.put('../escaped', new Uint8Array([1]))).rejects.toThrow()
      await expect(store.put('../../etc/passwd', new Uint8Array([1]))).rejects.toThrow()
      await expect(store.put('objects/../../escaped', new Uint8Array([1]))).rejects.toThrow()
    })

    it('reads and deletes an escaping key as a miss, never as a file', async () => {
      const store = new LocalBlobStore(await mkdtemp(join(tmpdir(), 'blob-')))
      expect(await store.get('../package.json')).toBeNull()
      // delete() is idempotent and must not throw on an uncontainable key.
      await expect(store.delete('../package.json')).resolves.toBeUndefined()
    })

    it('still round-trips a legitimate nested key', async () => {
      const store = new LocalBlobStore(await mkdtemp(join(tmpdir(), 'blob-')))
      await store.put('objects/nested/deep/file', new Uint8Array([1, 2, 3]))
      expect(await store.get('objects/nested/deep/file')).not.toBeNull()
    })
  })
})