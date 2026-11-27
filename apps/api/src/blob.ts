import { unlink, writeFile, mkdir, readdir, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'

import { join, dirname, resolve, sep } from 'node:path'

export class LocalBlobStore {
  private baseDir: string

  constructor(baseDir?: string) {
    this.baseDir = baseDir || process.env.BLOB_STORE_DIR || './blobs'
  }

  /**
   * Map a caller-supplied key to an absolute path INSIDE the store.
   *
   * Object ids are client-chosen (an outbox replays the id it minted), and this
   * store is the boundary between "a key" and "a file on the user's disk".
   * Without the containment check a key like `../../orbit.sqlite` walked out of
   * the blob directory: put() would overwrite any file the app could write, and
   * get() would stream any file it could read. Both are reachable from an
   * authenticated request, so the check is not optional — it is the difference
   * between a blob store and an arbitrary file primitive.
   *
   * Null means "not a key this store may touch"; callers treat it as a miss.
   */
  private resolve(key: string): string | null {
    if (typeof key !== 'string' || key.length === 0) return null
    // Absolute keys and Windows drive/UNC paths are never valid blob keys.
    if (key.includes('\0')) return null
    const base = resolve(this.baseDir)
    const filePath = resolve(base, key)
    // Same directory or a descendant of it — nothing else.
    if (filePath !== base && !filePath.startsWith(base + sep)) return null
    return filePath
  }

  async put(key: string, data: Uint8Array, _options?: { httpMetadata?: { contentType?: string } }): Promise<void> {
    const filePath = this.resolve(key)
    // An uncontained key is a programming error or an attack; writing it would
    // escape the store, so refuse rather than coerce.
    if (!filePath) throw new Error(`blob: refusing to write outside the store: ${key}`)
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, Buffer.from(data))
  }

  async get(key: string): Promise<{
    body: ReadableStream | null
    httpEtag: string
    writeHttpMetadata: (headers: Headers) => void
  } | null> {
    const filePath = this.resolve(key)
    // A miss and an uncontainable key are the same answer to a caller: no bytes.
    if (!filePath) return null
    // Stream the file — never buffer the whole blob in RAM (multi-MB media
    // used to be readFile'd whole, keeping every served image resident).
    let size = 0
    try {
      size = (await stat(filePath)).size
    } catch {
      return null
    }
    return {
      body: Readable.toWeb(createReadStream(filePath)) as ReadableStream,
      httpEtag: `orbit-blob-${key}`,
      writeHttpMetadata(headers: Headers) {
        headers.set('Content-Type', 'application/octet-stream')
        headers.set('Content-Length', String(size))
      },
    }
  }

  async delete(key: string): Promise<void> {
    const filePath = this.resolve(key)
    if (!filePath) return
    try {
      await unlink(filePath)
    } catch { }
  }

  async list(prefix = ''): Promise<string[]> {
    const targetDir = join(this.baseDir, prefix)
    const results: string[] = []
    async function scan(dir: string, currentPrefix: string) {
      let entries: any[] = []
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        const fullRel = currentPrefix ? `${currentPrefix}/${entry.name}` : entry.name
        if (entry.isDirectory()) {
          await scan(join(dir, entry.name), fullRel)
        } else if (entry.isFile()) {
          results.push(fullRel)
        }
      }
    }
    await scan(targetDir, prefix.replace(/\/+$/, ''))
    return results
  }
}
