/**
 * One-shot maintenance: delete specific dead placeholder accounts that still
 * show up in the Domination target list on this install's node.
 *
 *   bun run scripts/purge-dead-domination-users.ts \
 *     --db I:/path/orbit.sqlite \
 *     --user <orbitId>:<displayName> [--user <orbitId>:<displayName> ...] \
 *     [--blobs I:/path/blobs]
 *
 * Deletion is by EXPLICIT (id, display name) pair only — never by name alone.
 * Each pair must match exactly one row on BOTH the id and the
 * case/whitespace-insensitive display name, so a real account whose name merely
 * collides (different case / trailing space) is never touched. The existing
 * cascading-account helper removes each matched account's rows, including its
 * DominationActions, and — with --blobs — its object files. Re-running with the
 * same pairs finds no rows, so the purge is idempotent.
 */
import { existsSync } from 'node:fs'
import { createClient } from '@libsql/client'
import { D1Turso } from '../src/db'
import { deleteUserCascade } from '../src/routes/users'
import { LocalBlobStore } from '../src/blob'

export const DEAD_DOMINATION_HANDLES = ['velvetspecter', 'pulsevoyeur'] as const

export type PurgePair = { id: string; displayName: string }

export async function purgeDeadDominationUsers(
  db: D1Turso,
  pairs: readonly PurgePair[],
  opts: { BUCKET?: LocalBlobStore } = {},
): Promise<{ deleted: string[]; missing: string[] }> {
  const deleted: string[] = []
  const missing: string[] = []
  for (const pair of pairs) {
    const name = pair.displayName.trim().toLowerCase()
    const rows = await db.prepare('SELECT id FROM Users WHERE id = ? AND LOWER(TRIM(display_name)) = ?')
      .bind(pair.id, name).all<{ id: string }>()
    if (rows.results.length === 0) {
      console.warn(`[purge-domination-users] no row for id=${pair.id} name="${pair.displayName}" — skipping`)
      missing.push(pair.id)
      continue
    }
    for (const row of rows.results) {
      await deleteUserCascade(db, row.id, opts)
      deleted.push(row.id)
    }
  }
  return { deleted, missing }
}

const USAGE = 'Usage: bun run scripts/purge-dead-domination-users.ts --db <orbit.sqlite> --user <orbitId>:<displayName> [--user ...] [--blobs <dir>]'

/** Parse repeated `--user <orbitId>:<displayName>` flags. Null when none given. */
function parsePairs(argv: readonly string[]): PurgePair[] | null {
  const pairs: PurgePair[] = []
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] !== '--user') continue
    const raw = argv[i + 1]
    if (!raw || raw.startsWith('--')) return null
    const sep = raw.indexOf(':')
    if (sep <= 0) return null
    const id = raw.slice(0, sep).trim()
    const displayName = raw.slice(sep + 1)
    if (!id || !displayName.trim()) return null
    pairs.push({ id, displayName })
    i += 1
  }
  return pairs.length > 0 ? pairs : null
}

if (import.meta.main) {
  const argv = process.argv.slice(2)
  const pairs = parsePairs(argv)
  if (!pairs) {
    console.error(USAGE)
    process.exit(2)
  }
  const i = argv.indexOf('--db')
  const raw = (i >= 0 ? argv[i + 1] : null) || process.env.SNAPSHOT_PATH || process.env.DATABASE_URL || ''
  const dbPath = raw.startsWith('file:') ? raw.slice(5) : raw
  if (!dbPath || !existsSync(dbPath)) {
    console.error(USAGE)
    process.exit(1)
  }
  const db = new D1Turso(createClient({ url: `file:${dbPath}` }))
  let BUCKET: LocalBlobStore | undefined
  const bi = argv.indexOf('--blobs')
  if (bi >= 0 && argv[bi + 1]) BUCKET = new LocalBlobStore(argv[bi + 1])
  const result = await purgeDeadDominationUsers(db, pairs, BUCKET ? { BUCKET } : {})
  console.log(`[purge-domination-users] deleted=${result.deleted.join(', ') || 'none'} | missing=${result.missing.join(', ') || 'none'}`)
}