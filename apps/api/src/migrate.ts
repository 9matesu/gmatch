import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { Client } from '@libsql/client'

const ROOT = apiRootFor(import.meta.url)
const SCHEMA_FILE = join(ROOT, 'schema.sql')
const MIGRATIONS_DIR = join(ROOT, 'migrations')

/**
 * Root of the API package: `apps/api`, whichever way this code is running.
 *
 * In the repo the schema sits one level above this file
 * (`apps/api/src/migrate.ts` -> `apps/api`). A packaged install runs a
 * single-file bundle instead — `scripts/stage-api.cjs` builds
 * `apps/api/serve.js` — so the schema sits NEXT TO the running file. Resolving
 * "one level up" unconditionally pointed at `apps/`, schema.sql was never
 * found, and the bundled node died at startup while its HTTP shell still
 * answered 500/503: an empty world over an intact database. Look for the file
 * that has to exist rather than assuming a depth.
 */
export function apiRootFor(fileUrl: string): string {
  const here = dirname(fileURLToPath(fileUrl))
  return existsSync(join(here, 'schema.sql')) ? here : join(here, '..')
}

function splitStatements(sql: string): string[] {
  return sql
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => line.replace(/--.*$/, ''))
    .join('\n')
    .split(';')
    .map(s => s.trim())
    .filter(Boolean)
}

function readPendingMigrations(currentVersion: number): Array<{ version: number; file: string }> {
  if (!existsSync(MIGRATIONS_DIR)) return []
  return readdirSync(MIGRATIONS_DIR)
    .filter(f => /^\d+_.*\.sql$/.test(f))
    .map(file => ({ version: parseInt(file, 10), file }))
    .filter(m => m.version > currentVersion)
    .sort((a, b) => a.version - b.version)
}

export async function migrate(client: Client): Promise<void> {
  // 1. Apply the canonical schema. Every statement is idempotent
  //    (CREATE TABLE/INDEX IF NOT EXISTS), so this is safe on fresh and
  //    existing databases alike. Failures here are hard errors — EXCEPT a
  //    statement that names a column a later migration adds (e.g. the
  //    idx_objects_is_avatar index over migration 053): on an old DB the table
  //    already exists, so CREATE TABLE IF NOT EXISTS is a no-op and the column
  //    is not there yet. Aborting there used to kill the whole boot, so an old
  //    database could never upgrade (sidecar "could not keep the server
  //    running"). Those statements are deferred and retried after step 2.
  const schemaSql = readFileSync(SCHEMA_FILE, 'utf8')
  const deferred: string[] = []
  for (const statement of splitStatements(schemaSql)) {
    try {
      await client.execute(statement)
    } catch (err: any) {
      if (String(err?.message).includes('no such column')) {
        deferred.push(statement)
        continue
      }
      throw err
    }
  }

  // 2. Apply versioned migrations newer than the recorded user_version.
  const { rows } = await client.execute('PRAGMA user_version')
  let currentVersion = Number(rows?.[0]?.user_version ?? 0)

  for (const { version, file } of readPendingMigrations(currentVersion)) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
    for (const statement of splitStatements(sql)) {
      try {
        await client.execute(statement)
      } catch (err: any) {
        if (err?.message?.includes('duplicate column name') || err?.message?.includes('already exists')) {
          // column or index already exists, safe to continue
        } else {
          throw err
        }
      }
    }
    await client.execute(`PRAGMA user_version = ${version}`)
    currentVersion = version
  }

  // 2b. Retry the schema statements the migrations unblocked. A failure here
  //     is real: the column the statement names still does not exist.
  for (const statement of deferred) {
    await client.execute(statement)
  }

  // 3. Seed default community settings (idempotent). The discord invite is
  //    NOT seeded anymore (1.0.1: no hardcoded third-party links shipped) —
  //    admins set it themselves via the admin panel Settings tab.
  await client.execute("INSERT OR IGNORE INTO SystemMeta (key, value) VALUES ('economy_cashout_rate_bps', '12500')")

  // 4. One-time g$ wallet seed: carry each user's accumulated legacy score over
  //    into their economy wallet so the new marketplace/store is usable without
  //    a faucet. Idempotent via a SystemMeta flag; only runs once per database.
  const seed = await client.execute("SELECT value FROM SystemMeta WHERE key = 'wallet_seed_v1'")
  if (!seed.rows?.[0]?.value) {
    await client.execute(`
      INSERT OR IGNORE INTO Wallets (user_id, balance)
      SELECT id, MAX(COALESCE(score_total, 0), COALESCE(score, 0))
      FROM Users
      WHERE id NOT IN (SELECT user_id FROM Wallets)
        AND (COALESCE(score_total, 0) > 0 OR COALESCE(score, 0) > 0)
    `)
    await client.execute("INSERT OR IGNORE INTO SystemMeta (key, value) VALUES ('wallet_seed_v1', '1')")
  }
}
