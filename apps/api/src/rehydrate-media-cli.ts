/**
 * CLI: rehydrate the media bytes behind archive rows.
 *
 * WHAT IT DOES
 *
 * For every row in `Objects` that kept only a descriptor (magnet / urn), it
 * looks for the bytes in the places they can still exist:
 *
 *   --vault <dir>        the desktop's content-addressed media vault
 *   --imgcache <dir>     the desktop's encrypted picture LRU
 *   --indexeddb <dir>    the desktop profile's Chromium IndexedDB blob store
 *   --blob-dir <dir>     another node's blob store
 *   --remote <base>      a node that may still hold the bytes (signed GET)
 *
 * and writes the ones it can PROVE are the row's bytes into this node's blob
 * store, so `GET /api/objects/:id` serves a picture instead of a descriptor.
 *
 * EVERY WRITE IS PROVEN BY A HASH. Nothing is matched by caption, size, date
 * or "looks like the same picture" — see rehydrate-media.ts for the two hash
 * eras this archive used.
 *
 * USAGE
 *
 *   bun run src/rehydrate-media-cli.ts \
 *     --db I:/goongrid/apps/api/orbit.sqlite \
 *     --remote http://192.168.1.10:8790 \
 *     --vault "C:/Users/<you>/AppData/Roaming/@gmatch/desktop/media-vault" \
 *     --vault-key "C:/Users/<you>/AppData/Roaming/@gmatch/desktop/storage.key" \
 *     --imgcache "C:/Users/<you>/AppData/Roaming/@gmatch/desktop/imgcache" \
 *     --imgcache-key "C:/Users/<you>/AppData/Roaming/@gmatch/desktop/storage.key" \
 *     --indexeddb "C:/Users/<you>/AppData/Roaming/@gmatch/desktop/IndexedDB" \
 *     --report I:/tmp/rehydrate-report.json
 *
 * Add --dry-run to report without writing.
 */

import { Database } from 'bun:sqlite'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { LocalBlobStore } from './blob'
import { resolveStorageKey } from './storage-key'
import {
  rehydrateMedia,
  readBlobDirCandidates,
  readEncryptedCacheCandidates,
  readIndexedDbCandidates,
  readVaultCandidates,
  type ArchiveObject,
  type ByteCandidate,
  type RecoveryIdentity,
} from './rehydrate-media'

interface Args {
  db: string
  blobDir: string
  remotes: string[]
  identity: string | null
  vault: string | null
  vaultKey: string | null
  imgcache: string | null
  imgcacheKey: string | null
  indexedDb: string | null
  blobDirs: string[]
  report: string | null
  dryRun: boolean
  limit: number | null
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | null => {
    const i = argv.indexOf(flag)
    return i >= 0 && argv[i + 1] ? argv[i + 1] : null
  }
  const many = (flag: string): string[] => {
    const out: string[] = []
    argv.forEach((a, i) => {
      if (a === flag && argv[i + 1]) out.push(argv[i + 1])
    })
    return out
  }
  const db = get('--db') || process.env.SNAPSHOT_PATH || process.env.DATABASE_URL || ''
  const dbPath = db.startsWith('file:') ? db.slice(5) : db
  const blobDir =
    get('--blob-dir') ||
    process.env.BLOB_STORE_DIR ||
    (dbPath ? join(dirname(dbPath), 'blobs') : './blobs')
  const limitRaw = get('--limit')
  return {
    db: dbPath,
    blobDir,
    remotes: many('--remote'),
    identity: get('--identity'),
    vault: get('--vault'),
    vaultKey: get('--vault-key'),
    imgcache: get('--imgcache'),
    imgcacheKey: get('--imgcache-key'),
    indexedDb: get('--indexeddb'),
    blobDirs: many('--blob-dir-source'),
    report: get('--report'),
    dryRun: argv.includes('--dry-run'),
    limit: limitRaw ? Number(limitRaw) : null,
  }
}

function readKeyFile(p: string | null): string | null {
  if (!p) return null
  try {
    const hex = readFileSync(p, 'utf8').trim()
    return /^[0-9a-f]{64}$/i.test(hex) ? hex : null
  } catch {
    return null
  }
}

function readIdentity(p: string | null): RecoveryIdentity | null {
  if (!p) return null
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8'))
    if (!raw?.privateKeyHex || !raw?.publicKeyHex || !raw?.orbitId) return null
    return {
      orbitId: raw.orbitId,
      publicKeyHex: raw.publicKeyHex,
      privateKeyHex: raw.privateKeyHex,
      encryptionPubHex: raw.encryptionPubHex,
    }
  } catch {
    return null
  }
}

function loadRows(dbPath: string): ArchiveObject[] {
  const db = new Database(dbPath, { readonly: true })
  try {
    const rows = db
      .query(
        `SELECT id, content_hash, mime_type, size_bytes, created_at, content_url
           FROM Objects
          WHERE content_url IS NULL
             OR content_url LIKE 'magnet:%'
             OR content_url LIKE 'urn:%'
             OR content_url LIKE '/api/objects/%'`,
      )
      .all() as any[]
    return rows.map((r) => ({
      id: String(r.id),
      contentHash: r.content_hash ? String(r.content_hash).toLowerCase() : null,
      mimeType: r.mime_type ? String(r.mime_type) : null,
      sizeBytes: r.size_bytes == null ? null : Number(r.size_bytes),
      createdAt: r.created_at ? String(r.created_at) : null,
      contentUrl: r.content_url ? String(r.content_url) : null,
    }))
  } finally {
    db.close()
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (!args.db) {
    console.error('--db (or SNAPSHOT_PATH) is required')
    process.exit(1)
  }
  if (!existsSync(args.db)) {
    console.error(`database not found: ${args.db}`)
    process.exit(1)
  }

  // The node encrypts blobs at rest with its own storage key; resolve it the
  // same way serve.ts does, so the CLI writes blobs THIS node can read.
  process.env.STORAGE_ENCRYPTION_KEY = resolveStorageKey(resolve(args.db), process.env)
  const bucket = new LocalBlobStore(args.blobDir)
  const hasBytes = async (id: string): Promise<boolean> =>
    existsSync(join(args.blobDir, 'objects', id))

  const rows = loadRows(args.db)
  const missing: ArchiveObject[] = []
  for (const row of rows) {
    if (await hasBytes(row.id)) continue
    missing.push(row)
  }
  const targets = args.limit ? missing.slice(0, args.limit) : missing

  const candidates: ByteCandidate[] = []
  if (args.vault) {
    const vaultKey = readKeyFile(args.vaultKey)
    const found = readVaultCandidates(args.vault, vaultKey)
    candidates.push(...found)
    console.log(`[rehydrate] vault ${args.vault}: ${found.length} readable entries`)
  }
  if (args.imgcache) {
    const cacheKey = readKeyFile(args.imgcacheKey)
    const found = readEncryptedCacheCandidates(args.imgcache, cacheKey)
    candidates.push(...found)
    console.log(`[rehydrate] imgcache ${args.imgcache}: ${found.length} readable entries`)
  }
  for (const dir of args.blobDirs) {
    const found = readBlobDirCandidates(dir)
    candidates.push(...found)
    console.log(`[rehydrate] blob dir ${dir}: ${found.length} files`)
  }
  if (args.indexedDb) {
    // The IndexedDB blob store is hundreds of MB: keep only the runs whose
    // digest could satisfy a row that is still missing bytes.
    const full = new Set<string>()
    const prefix = new Set<string>()
    for (const row of targets) {
      const h = (row.contentHash || '').toLowerCase()
      if (h.length === 64) full.add(h)
      else if (h.length === 40) prefix.add(h)
      const id = (row.id || '').toLowerCase()
      if (/^[0-9a-f]{64}$/.test(id)) full.add(id)
    }
    const found = readIndexedDbCandidates(args.indexedDb, { full, prefix })
    candidates.push(...found)
    console.log(`[rehydrate] indexeddb ${args.indexedDb}: ${found.length} matching records`)
  }

  const identity = readIdentity(args.identity)
  if (args.remotes.length && !identity) {
    console.warn('[rehydrate] no --identity: remote reads will be unsigned')
  }

  console.log(
    `[rehydrate] db=${args.db} blob=${args.blobDir} | descriptor rows=${rows.length} missing bytes=${missing.length} | targets=${targets.length}`,
  )

  const report = await rehydrateMedia({
    rows: targets,
    bucket,
    candidates,
    remotes: args.remotes.map((base) => ({ base, identity })),
    hasBytes,
    dryRun: args.dryRun,
  })

  console.log(
    `[rehydrate] recovered=${report.recovered} written=${report.written} already=${report.alreadyPresent} failed=${report.failed}`,
  )
  const byOutcome: Record<string, number> = {}
  for (const e of report.entries) byOutcome[e.outcome] = (byOutcome[e.outcome] || 0) + 1
  console.log('[rehydrate] outcomes:', JSON.stringify(byOutcome))

  if (args.report) {
    writeFileSync(args.report, JSON.stringify(report, null, 1))
    console.log(`[rehydrate] report written to ${args.report}`)
  }
}

main().catch((err) => {
  console.error('[rehydrate] failed:', (err as Error)?.stack || err)
  process.exit(1)
})
