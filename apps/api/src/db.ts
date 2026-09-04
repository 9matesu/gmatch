import type { Client } from '@libsql/client'
import { migrate } from './migrate'

export interface D1Result {
  success: boolean
  meta?: Record<string, any>
}

export interface D1PreparedStatement {
  run(): Promise<D1Result>
  first<T = any>(): Promise<T | null>
  all<T = any>(): Promise<{ results: T[] }>
}

// One statement in an atomic batch. `args` are sanitized the same way as the
// prepared-statement path (undefined -> null, boolean -> 0/1).
export interface AtomicStatement {
  sql: string
  args?: any[]
}

// Per-statement result of an atomic batch. `rows` carries RETURNING output and
// `rowsAffected` is the change count for conditional UPDATEs.
export interface AtomicResult {
  rows: Record<string, unknown>[]
  rowsAffected: number
}

// A libsql error surfaced with its stable base code (e.g. SQLITE_CONSTRAINT)
// preserved so callers can detect unique-constraint/idempotency conflicts.
export class SqlError extends Error {
  readonly code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.name = 'SqlError'
    this.code = code
  }
}

function sanitizeArgs(args?: any[]): any[] {
  if (!args || args.length === 0) return []
  return args.map(a => {
    if (a === undefined) return null
    if (typeof a === 'boolean') return a ? 1 : 0
    return a
  })
}

const schemaEnsuredMap = new WeakMap<Client, boolean>()

export async function ensureSchema(db: Client) {
  if (schemaEnsuredMap.get(db)) return
  await migrate(db)
  schemaEnsuredMap.set(db, true)
}

export class D1Turso {
  constructor(private db: Client) {}

  private async exec(sql: string, cleanArgs: any[]): Promise<any> {
    await ensureSchema(this.db)
    try {
      return cleanArgs.length > 0
        ? await this.db.execute(sql, cleanArgs)
        : await this.db.execute(sql)
    } catch (err: any) {
      console.error(`[DB] Error: ${err?.message || err} — SQL: ${sql}`)
      throw new Error('Database error: operation failed')
    }
  }

  prepare(sql: string): {
    bind(...args: any[]): D1PreparedStatement
    run(): Promise<D1Result>
    first<T = any>(): Promise<T | null>
    all<T = any>(): Promise<{ results: T[] }>
  } {
    const self = this
    const exec = async (args?: any[]) => {
      const cleanArgs = sanitizeArgs(args)
      const result = await self.exec(sql, cleanArgs)
      return { success: true, meta: { changes: result?.rowsAffected ?? 0 } }
    }

    const getFirst = async <T>(args?: any[]): Promise<T | null> => {
      const cleanArgs = sanitizeArgs(args)
      const result = await self.exec(sql, cleanArgs)
      return (result.rows[0] as T) || null
    }

    const getAll = async <T>(args?: any[]): Promise<{ results: T[] }> => {
      const cleanArgs = sanitizeArgs(args)
      const result = await self.exec(sql, cleanArgs)
      return { results: (result?.rows || []) as T[] }
    }

    return {
      bind(...args: any[]): D1PreparedStatement {
        return {
          run: () => exec(args),
          first: <T>() => getFirst<T>(args),
          all: <T>() => getAll<T>(args),
        }
      },
      run: () => exec(),
      first: <T>() => getFirst<T>(),
      all: <T>() => getAll<T>(),
    }
  }

  async batch(stmts: Array<{ run: () => Promise<D1Result> }>): Promise<D1Result[]> {
    // The embedded libsql engine is stateful (single in-memory client), but
    // running statements sequentially keeps batch semantics exact and simple.
    const results: D1Result[] = []
    for (const stmt of stmts) {
      results.push(await stmt.run())
    }
    return results
  }

  // Atomic batch: executes all statements in a single write transaction on the
  // shared connection (all-or-nothing). Unlike libsql's interactive
  // `transaction()`, this does not swap out the in-memory connection, so it is
  // safe for the embedded `:memory:` engine used in production and tests.
  //
  // Statements run synchronously under the hood (no interleaving awaits), which
  // gives genuine atomicity in the single-process event loop. Errors surface as
  // SqlError with the libsql base code preserved so callers can detect unique
  // constraint (idempotency) conflicts.
  async atomicBatch(stmts: AtomicStatement[]): Promise<AtomicResult[]> {
    await ensureSchema(this.db)
    try {
      const results = await this.db.batch(
        stmts.map((s) => ({ sql: s.sql, args: sanitizeArgs(s.args) })),
        'write',
      )
      return results.map((r) => ({
        rows: (r?.rows ?? []) as Record<string, unknown>[],
        rowsAffected: Number(r?.rowsAffected ?? 0),
      }))
    } catch (err: any) {
      const code = err?.code ?? err?.baseCode
      const message = err?.message || 'Database error: atomic batch failed'
      console.error(`[DB] Atomic batch failed (${code ?? 'unknown'}): ${message}`)
      throw new SqlError(message, code ? String(code) : undefined)
    }
  }
}
