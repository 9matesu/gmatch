import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Resolve (or create) the at-rest encryption key used by crypto.ts.
 *
 * crypto.ts hard-requires a non-zero 64-hex STORAGE_ENCRYPTION_KEY, but the
 * server can be started without one (`bun run serve:api`, a bare `bun
 * src/serve.ts` inside the packaged api-stage, etc.) — every upload and DM
 * then 500s with a setup error the user cannot act on. Instead of crashing
 * later, serve.ts calls this at boot: honor an explicit env key, else load or
 * generate one persisted next to the snapshot DB.
 */
export function resolveStorageKey(snapshotPath: string, env: Record<string, string | undefined> = process.env): string {
  const fromEnv = env.STORAGE_ENCRYPTION_KEY
  if (isUsableKey(fromEnv)) return fromEnv as string
  const keyPath = join(dirnameOf(snapshotPath), 'storage.key')
  try {
    const stored = readFileSync(keyPath, 'utf8').trim()
    if (isUsableKey(stored)) return stored
  } catch {
    /* generate below */
  }
  const generated = generateHexKey()
  try {
    writeFileSync(keyPath, generated)
  } catch {
    /* ephemeral is fine — worst case blobs written this run are unreadable after restart */
  }
  return generated
}

function isUsableKey(hex: string | undefined | null): boolean {
  return /^[0-9a-f]{64}$/i.test(hex || '') && hex !== '00'.repeat(32)
}

function dirnameOf(p: string): string {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return idx > 0 ? p.slice(0, idx) : '.'
}

export function generateHexKey(): string {
  const bytes = new Uint8Array(32)
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < 32; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}
