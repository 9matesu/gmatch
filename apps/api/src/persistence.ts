import type { Client } from '@libsql/client'
import { access, mkdir, rename } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Quote a SQL string literal path for VACUUM INTO / ATTACH. */
function quotePath(p: string): string {
  return p.replace(/'/g, "''")
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

async function snapshotTableNames(db: Client): Promise<string[]> {
  const res = await db.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
  )
  return res.rows
    .map((r) => String((r as Record<string, unknown>).name))
    .filter((name) => name.length > 0)
}

async function tableColumns(db: Client, schema: string | null, table: string): Promise<Set<string>> {
  const prefix = schema ? `${quoteIdent(schema)}.` : ''
  const res = await db.execute(`PRAGMA ${prefix}table_info(${quoteIdent(table)})`)
  return new Set(
    res.rows
      .map((r) => String((r as Record<string, unknown>).name))
      .filter((name) => name.length > 0)
  )
}

/**
 * Atomically persist the entire in-memory database to a SQLite file.
 * Writes to `<path>.tmp` first (VACUUM INTO is crash-safe on its own), then
 * renames over `<path>` so a crash never leaves a truncated snapshot.
 */
export async function snapshotDb(db: Client, path: string): Promise<void> {
  if (!path) return
  await mkdir(dirname(path), { recursive: true }).catch(() => {})
  const tmp = `${path}.tmp`
  // A .tmp left by a crash would make VACUUM INTO fail FOREVER (it refuses
  // existing files) — silently freezing persistence. Clear it first.
  const { rm } = await import('node:fs/promises')
  await rm(tmp, { force: true }).catch(() => {})
  await db.execute(`VACUUM INTO '${quotePath(tmp)}'`)
  await rename(tmp, path)
}

/**
 * Load a previously snapshotted SQLite file back into an (empty) in-memory
 * database. Call after ensureSchema(). Returns true when rows were restored.
 */
export async function restoreDb(db: Client, path: string): Promise<boolean> {
  if (!path) return false
  try {
    await access(path)
  } catch {
    return false
  }

  let attached = false
  try {
    await db.execute(`ATTACH DATABASE '${quotePath(path)}' AS snap`)
    attached = true
    const snapRes = await db.execute(
      "SELECT name FROM snap.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
    )
    const tables = snapRes.rows
      .map((r) => String((r as Record<string, unknown>).name))
      .filter((name) => name.length > 0)
    const destTables = new Set(await snapshotTableNames(db))

    let copied = 0
    for (const t of tables) {
      if (!destTables.has(t)) continue
      const snapCols = await tableColumns(db, 'snap', t)
      const destCols = await tableColumns(db, null, t)
      // Map columns by NAME, not position: the snapshot was written by an older
      // build whose schema may have fewer/differently-ordered columns than the
      // current schema.sql. Positional `SELECT *` copy fails (and silently
      // drops the entire table's rows) the moment a column is added, removed,
      // or reordered between deploys — that is what wiped Users profiles on
      // the hidden_at deploy. New destination-only columns just take their
      // schema default.
      const shared = [...snapCols].filter((c) => destCols.has(c))
      if (shared.length === 0) continue
      const idents = shared.map((c) => quoteIdent(c)).join(', ')
      const result = await db.execute(
        `INSERT INTO ${quoteIdent(t)} (${idents}) SELECT ${idents} FROM snap.${quoteIdent(t)}`
      ).catch(() => null)
      if (result) copied++
    }

    await db.execute('DETACH DATABASE snap')
    attached = false
    if (copied > 0) {
    }
    return true
  } catch (err) {
    if (attached) {
      try { await db.execute('DETACH DATABASE snap') } catch {}
    }
    return false
  }
}