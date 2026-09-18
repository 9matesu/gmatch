import { createClient } from '@libsql/client'
import { join, dirname } from 'node:path'
import { D1Turso, ensureSchema } from './db'
import { LocalBlobStore } from './blob'
import { resolveStorageKey } from './storage-key'
import { migrateDataUrls } from './migrate-dataurls'

const url = process.env.DATABASE_URL || (process.env.SNAPSHOT_PATH ? `file:${process.env.SNAPSHOT_PATH}` : undefined)
if (!url) {
  console.error('DATABASE_URL (or SNAPSHOT_PATH) is required (e.g. file:/data/orbit.sqlite)')
  process.exit(1)
}

const dbFilePath = url.startsWith('file:') ? url.slice(5) : url
process.env.STORAGE_ENCRYPTION_KEY = resolveStorageKey(dbFilePath, process.env)
const blobStoreDir = process.env.BLOB_STORE_DIR || join(dirname(dbFilePath), 'blobs')

const client = createClient({ url })
const db = new D1Turso(client)
const bucket = new LocalBlobStore(blobStoreDir)

try {
  await ensureSchema(client)
  console.log(`[MIGRATE-DATAURLS] connected to ${url}, blob store at ${blobStoreDir}`)
  const count = await migrateDataUrls(db, bucket)
  console.log(`[MIGRATE-DATAURLS] moved ${count} inline data: URLs to encrypted blobs`)
  // Compact SQLite DB file after removing inline base64 data
  if (count > 0) {
    console.log('[MIGRATE-DATAURLS] compacting DB via VACUUM...')
    await client.execute('VACUUM')
    console.log('[MIGRATE-DATAURLS] VACUUM complete')
  }
  process.exit(0)
} catch (err: any) {
  console.error(`[MIGRATE-DATAURLS] error: ${err?.message || err}`)
  process.exit(1)
}
