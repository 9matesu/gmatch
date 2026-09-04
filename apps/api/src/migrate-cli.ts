import { createClient } from '@libsql/client'
import { migrate } from './migrate'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is required (e.g. file:./orbit.sqlite or libsql://... )')
  process.exit(1)
}

const client = createClient({ url })
try {
  await migrate(client)
} catch (err: any) {
  console.error(`Migration failed: ${err?.message || err}`)
  process.exit(1)
}
