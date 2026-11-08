import { describe, it, expect } from 'vitest'
import { createClient } from '@libsql/client'
import { D1Turso, SqlError } from './db'

/**
 * The batch is the ONLY multi-statement write path, and it must be a real
 * transaction: a half-applied write (a request marked accepted without the
 * friendship it implies) is worse than a failed one.
 */
describe('D1Turso.atomicBatch', () => {
  async function makeDb(): Promise<D1Turso> {
    const client = createClient({ url: ':memory:' })
    return new D1Turso(client)
  }

  it('applies every statement when they all succeed', async () => {
    const db = await makeDb()
    await db.atomicBatch([
      db.prepare("INSERT INTO SystemMeta (key, value) VALUES ('k1', 'v1')"),
      db.prepare("INSERT INTO SystemMeta (key, value) VALUES ('k2', 'v2')"),
    ])
    const rows = await db.prepare("SELECT key FROM SystemMeta WHERE key IN ('k1', 'k2') ORDER BY key").all<{ key: string }>()
    expect(rows.results.map((r) => r.key)).toEqual(['k1', 'k2'])
  })

  it('rolls the whole batch back when one statement fails', async () => {
    const db = await makeDb()
    await db.prepare("INSERT INTO SystemMeta (key, value) VALUES ('keep', 'yes')").run()

    await expect(
      db.atomicBatch([
        db.prepare("INSERT INTO SystemMeta (key, value) VALUES ('fresh', 'yes')"),
        db.prepare("INSERT INTO SystemMeta (key, value) VALUES ('keep', 'duplicate')"),
      ]),
    ).rejects.toBeInstanceOf(SqlError)

    // The first statement of the failed batch must NOT have landed.
    const rows = await db.prepare("SELECT key, value FROM SystemMeta WHERE key IN ('keep', 'fresh')").all<{ key: string; value: string }>()
    expect(rows.results.map((r) => r.key)).toEqual(['keep'])
    expect(rows.results[0].value).toBe('yes')
  })
})
