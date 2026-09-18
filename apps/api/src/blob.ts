import { unlink, writeFile, mkdir, readdir, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'

import { join, dirname } from 'node:path'

export class LocalBlobStore {
  private baseDir: string

  constructor(baseDir?: string) {
    this.baseDir = baseDir || process.env.BLOB_STORE_DIR || './blobs'
  }

  private resolve(key: string): string {
    return join(this.baseDir, key)
  }

  async put(key: string, data: Uint8Array, _options?: { httpMetadata?: { contentType?: string } }): Promise<void> {
    const filePath = this.resolve(key)
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, Buffer.from(data))
  }

  async get(key: string): Promise<{
    body: ReadableStream | null
    httpEtag: string
    writeHttpMetadata: (headers: Headers) => void
  } | null> {
    const filePath = this.resolve(key)
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
