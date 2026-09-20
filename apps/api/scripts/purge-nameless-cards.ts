#!/usr/bin/env bun
/**
 * purge-nameless-cards.ts
 *
 * One-shot DB cleanup: delete every card where name IS NULL or name is blank/whitespace.
 * These are "Untitled" cards auto-created by the now-removed backfillFromObjects().
 *
 * Also cleans up:
 *   - CardOwnership rows for deleted cards
 *   - CardHistory rows for deleted cards
 *   - MarketListings rows for deleted cards
 *
 * Run on the fly.io machine:
 *   flyctl ssh console -a gmatch
 *   cd /app && bun apps/api/scripts/purge-nameless-cards.ts
 *
 * Or locally against the live DB (requires DATABASE_URL env):
 *   DATABASE_URL=libsql://... bun apps/api/scripts/purge-nameless-cards.ts
 */

import { createClient } from '@libsql/client'

const url = process.env.DATABASE_URL || process.env.TURSO_DATABASE_URL
if (!url) {
  console.error('❌  Set DATABASE_URL or TURSO_DATABASE_URL')
  process.exit(1)
}

const authToken = process.env.TURSO_AUTH_TOKEN || process.env.DATABASE_AUTH_TOKEN || undefined
const db = createClient({ url, authToken })

async function main() {
  console.log('🔍  Counting nameless cards...')

  const countRes = await db.execute(
    `SELECT COUNT(*) AS total FROM Cards
     WHERE name IS NULL OR TRIM(name) = ''`
  )
  const total = Number(countRes.rows[0]?.total ?? 0)
  console.log(`   Found ${total} nameless card(s)`)

  if (total === 0) {
    console.log('✅  Nothing to delete.')
    await db.close()
    return
  }

  // Collect IDs first for safe cascading delete
  const idsRes = await db.execute(
    `SELECT id FROM Cards WHERE name IS NULL OR TRIM(name) = ''`
  )
  const ids = idsRes.rows.map((r) => r.id as string)
  console.log(`   Card IDs: ${ids.slice(0, 10).join(', ')}${ids.length > 10 ? ` ...+${ids.length - 10} more` : ''}`)

  // Batch in groups of 100 to avoid oversized queries
  const BATCH = 100
  let deleted = 0
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH)
    const placeholders = batch.map(() => '?').join(', ')

    await db.execute({ sql: `DELETE FROM MarketListings WHERE card_id IN (${placeholders})`, args: batch })
    await db.execute({ sql: `DELETE FROM CardHistory WHERE card_id IN (${placeholders})`, args: batch })
    await db.execute({ sql: `DELETE FROM CardOwnership WHERE card_id IN (${placeholders})`, args: batch })
    const del = await db.execute({ sql: `DELETE FROM Cards WHERE id IN (${placeholders})`, args: batch })
    deleted += del.rowsAffected
    console.log(`   Deleted batch ${Math.floor(i / BATCH) + 1}: ${del.rowsAffected} cards`)
  }

  console.log(`\n✅  Done. Deleted ${deleted} nameless card(s).`)
  await db.close()
}

main().catch((err) => {
  console.error('❌  Error:', err)
  process.exit(1)
})
