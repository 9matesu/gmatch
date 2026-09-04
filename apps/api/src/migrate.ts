import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { Client } from '@libsql/client'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCHEMA_FILE = join(ROOT, 'schema.sql')
const MIGRATIONS_DIR = join(ROOT, 'migrations')

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
  //    existing databases alike. Failures here are hard errors.
  const schemaSql = readFileSync(SCHEMA_FILE, 'utf8')
  for (const statement of splitStatements(schemaSql)) {
    await client.execute(statement)
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

  // 3. Seed default community settings (idempotent). Admins can change or
  //    clear these later via the admin panel Settings tab.
  await client.execute("INSERT OR IGNORE INTO SystemMeta (key, value) VALUES ('discord_invite_url', 'https://discord.gg/WMEz9jgr3')")
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
