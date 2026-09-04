import { unlink, writeFile, readFile, mkdir, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'

export class LocalBlobStore {
  private baseDir: string

  constructor(baseDir?: string) {
    this.baseDir = baseDir || process.env.BLOB_STORE_DIR || './blobs'
  }

  private resolve(key: string): string {
    return join(this.baseDir, key)
  }

  async put(key: string, data: Uint8Array, options?: { httpMetadata?: { contentType?: string } }): Promise<void> {
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
    try {
      const data = await readFile(filePath)
      let bodyUsed = false
      return {
        get body() {
          if (bodyUsed) return null
          bodyUsed = true
          return new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(data))
              controller.close()
            },
          })
        },
        httpEtag: `orbit-blob-${key}`,
        writeHttpMetadata(headers: Headers) {
          headers.set('Content-Type', 'application/octet-stream')
          headers.set('Content-Length', String(data.length))
        },
      }
    } catch {
      return null
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
