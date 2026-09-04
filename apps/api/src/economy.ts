// EconomyService — authoritative g$ wallet with an immutable ledger and
// idempotent operations. The client never submits a balance, price, or result:
// every mutation here is validated and applied atomically via `atomicBatch`
// (single write transaction on the shared connection).
//
// Invariants enforced here:
//   - balances never go negative (conditional UPDATE gated on `balance >= amount`)
//   - every balance change produces exactly one LedgerTransactions row
//   - replaying the same idempotency key returns the recorded result instead of
//     applying the mutation twice (UNIQUE(idempotency_key) + rollback on conflict)
//   - concurrent duplicate requests are safe: the loser's batch aborts on the
//     unique-constraint violation and re-reads the winner's recorded result.

import crypto from 'crypto'
import type { D1Turso, AtomicStatement } from './db'
import { SqlError } from './db'
import { badRequest, idempotencyConflict, insufficientFunds } from './common/errors'
import { requireId } from './common/validation'

export type LedgerKind =
  | 'grant'
  | 'reward'
  | 'purchase'
  | 'sale'
  | 'refund'
  | 'transfer'
  | 'transfer_in'
  | 'transfer_out'
  | 'trade'
  | 'adjustment'

export interface BalanceOpResult {
  operationId: string
  ledgerId: string
  userId: string
  delta: number
  balance: number
  replayed?: boolean
}

export interface TransferResult {
  operationId: string
  fromUserId: string
  toUserId: string
  amount: number
  fromBalance: number
  toBalance: number
  replayed?: boolean
}

export interface LedgerRow {
  id: string
  userId: string
  kind: string
  delta: number
  balanceAfter: number
  reference: string | null
  operationId: string | null
  createdAt: string
}

interface OperationInput {
  idempotencyKey: string
  kind: LedgerKind
  reference?: string | null
}

interface RecordedOperation {
  id: string
  kind: string
  fingerprint: string | null
  payload: string | null
  result: string | null
}

// Reusable atomic transfer statement builder. Produces the full debit→credit→
// ledger→operation statement chain for a two-wallet transfer, gated through
// SQLite's changes() so the entire chain is a no-op when the sender has
// insufficient funds. Exported so other domain services (e.g. card marketplace
// purchase) can compose economy statements with their own statements into a
// single atomicBatch without duplicating wallet/ledger SQL.
export interface TransferStatements {
  statements: AtomicStatement[]
  // Indices (0-based) of the RETURNING balance rows for sender and receiver.
  debitIndex: number
  creditIndex: number
}

export function buildTransferStatements(params: {
  fromUserId: string
  toUserId: string
  amount: number
  reference: string | null
  operationId: string
  debitLedgerId: string
  creditLedgerId: string
  idempotencyKey: string
  fingerprint: string
  payload: unknown
  result: unknown
  nowIso: string
  // Extra WHERE fragment (and args) appended to the debit UPDATE so the debit
  // only applies when a caller-specific precondition holds — e.g. a marketplace
  // purchase that must atomically verify the card is still listed and owned by
  // the seller before any money moves.
  debitGate?: { clause: string; args: any[] }
  extra?: AtomicStatement[]
}): TransferStatements {
  const p = params
  const statements: AtomicStatement[] = [
    { sql: 'INSERT OR IGNORE INTO Wallets (user_id, balance) VALUES (?, 0)', args: [p.fromUserId] },
    { sql: 'INSERT OR IGNORE INTO Wallets (user_id, balance) VALUES (?, 0)', args: [p.toUserId] },
    {
      sql: `UPDATE Wallets SET balance = balance - ?, updated_at = ? WHERE user_id = ? AND balance >= ?${p.debitGate ? ` ${p.debitGate.clause}` : ''} RETURNING balance`,
      args: [p.amount, p.nowIso, p.fromUserId, p.amount, ...(p.debitGate?.args ?? [])],
    },
    { sql: 'UPDATE Wallets SET balance = balance + ?, updated_at = ? WHERE user_id = ? AND changes() = 1 RETURNING balance', args: [p.amount, p.nowIso, p.toUserId] },
    {
      sql: 'INSERT INTO LedgerTransactions (id, user_id, kind, delta, balance_after, reference, operation_id) SELECT ?, ?, ?, ?, balance, ?, ? FROM Wallets WHERE user_id = ? AND changes() = 1',
      args: [p.debitLedgerId, p.fromUserId, 'transfer_out', -p.amount, p.reference, p.operationId, p.fromUserId],
    },
    {
      sql: 'INSERT INTO LedgerTransactions (id, user_id, kind, delta, balance_after, reference, operation_id) SELECT ?, ?, ?, ?, balance, ?, ? FROM Wallets WHERE user_id = ? AND changes() = 1',
      args: [p.creditLedgerId, p.toUserId, 'transfer_in', p.amount, p.reference, p.operationId, p.toUserId],
    },
    {
      sql: 'INSERT INTO EconomicOperations (id, idempotency_key, user_id, kind, fingerprint, payload, result) SELECT ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1',
      args: [p.operationId, p.idempotencyKey, p.fromUserId, 'transfer', p.fingerprint, JSON.stringify(p.payload), JSON.stringify(p.result)],
    },
  ]

  if (p.extra?.length) statements.push(...p.extra)

  return { statements, debitIndex: 2, creditIndex: 3 }
}

function isConstraintError(err: unknown): boolean {
  return err instanceof SqlError && !!err.code && err.code.includes('CONSTRAINT')
}

// Reusable atomic debit statement builder (single wallet). Mirrors
// buildTransferStatements but for a spend. The extra statements gate on the
// debit's changes() chain, so the caller can atomically attach its own side
// effects (e.g. store inventory/unlock) and know the debit applied via
// `balanceIndex`.
export function buildDebitStatements(params: {
  userId: string
  amount: number
  kind: LedgerKind
  reference: string | null
  operationId: string
  ledgerId: string
  idempotencyKey: string
  fingerprint: string
  payload: unknown
  result: unknown
  nowIso: string
  debitGate?: { clause: string; args: any[] }
  extra?: AtomicStatement[]
}): { statements: AtomicStatement[]; balanceIndex: number } {
  const p = params
  const statements: AtomicStatement[] = [
    { sql: 'INSERT OR IGNORE INTO Wallets (user_id, balance) VALUES (?, 0)', args: [p.userId] },
    {
      sql: `UPDATE Wallets SET balance = balance - ?, updated_at = ? WHERE user_id = ? AND balance >= ?${p.debitGate ? ` ${p.debitGate.clause}` : ''} RETURNING balance`,
      args: [p.amount, p.nowIso, p.userId, p.amount, ...(p.debitGate?.args ?? [])],
    },
    {
      sql: 'INSERT INTO LedgerTransactions (id, user_id, kind, delta, balance_after, reference, operation_id) SELECT ?, ?, ?, ?, balance, ?, ? FROM Wallets WHERE user_id = ? AND changes() = 1',
      args: [p.ledgerId, p.userId, p.kind, -p.amount, p.reference, p.operationId, p.userId],
    },
    {
      sql: 'INSERT INTO EconomicOperations (id, idempotency_key, user_id, kind, fingerprint, payload, result) SELECT ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1',
      args: [p.operationId, p.idempotencyKey, p.userId, 'debit', p.fingerprint, JSON.stringify(p.payload), JSON.stringify(p.result)],
    },
  ]
  if (p.extra?.length) statements.push(...p.extra)
  return { statements, balanceIndex: 1 }
}

function parseStored<T>(raw: string | null): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export class EconomyService {
  constructor(private db: D1Turso) {}

  async getBalance(userId: string): Promise<number> {
    requireId(userId, 'userId')
    const row = await this.db
      .prepare('SELECT balance FROM Wallets WHERE user_id = ?')
      .bind(userId)
      .first<{ balance: number }>()
    return row?.balance ?? 0
  }

  // Append-only ledger history for a wallet, newest first.
  async listTransactions(userId: string, limit = 50, offset = 0): Promise<LedgerRow[]> {
    requireId(userId, 'userId')
    const safeLimit = Math.min(Math.max(1, Math.floor(limit) || 50), 200)
    const safeOffset = Math.max(0, Math.floor(offset) || 0)
    const rows = await this.db
      .prepare(
        'SELECT id, user_id, kind, delta, balance_after, reference, operation_id, created_at FROM LedgerTransactions WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?',
      )
      .bind(userId, safeLimit, safeOffset)
      .all<{ id: string; user_id: string; kind: string; delta: number; balance_after: number; reference: string | null; operation_id: string | null; created_at: string }>()
    return rows.results.map((r) => ({
      id: r.id,
      userId: r.user_id,
      kind: r.kind,
      delta: Number(r.delta),
      balanceAfter: Number(r.balance_after),
      reference: r.reference,
      operationId: r.operation_id,
      createdAt: r.created_at,
    }))
  }

  private async findOperation(idempotencyKey: string): Promise<RecordedOperation | null> {
    return this.db
      .prepare('SELECT id, kind, fingerprint, payload, result FROM EconomicOperations WHERE idempotency_key = ?')
      .bind(idempotencyKey)
      .first<RecordedOperation>()
  }

  // A replay is only honoured when the recorded fingerprint matches the request.
  // This prevents one idempotency key from being replayed with different users,
  // amounts, targets, or operation kinds (cross-request/key-reuse abuse).
  private assertFingerprintMatch(existing: RecordedOperation, fingerprint: string): void {
    if (existing.fingerprint && existing.fingerprint !== fingerprint) {
      throw idempotencyConflict()
    }
  }

  private validateAmount(amount: number): number {
    if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0) {
      throw badRequest('amount must be a positive integer')
    }
    return amount
  }

  // Credit an amount to a wallet. Always succeeds (no funds requirement).
  async credit(userId: string, amount: number, input: OperationInput): Promise<BalanceOpResult> {
    requireId(userId, 'userId')
    this.validateAmount(amount)
    const idempotencyKey = this.validateIdempotencyKey(input.idempotencyKey)
    const fingerprint = `credit|${userId}|${amount}|${input.kind}|${input.reference ?? ''}`

    const existing = await this.findOperation(idempotencyKey)
    if (existing) {
      this.assertFingerprintMatch(existing, fingerprint)
      const result = parseStored<BalanceOpResult>(existing.result)
      return {
        operationId: existing.id,
        ledgerId: result?.ledgerId ?? '',
        userId,
        delta: amount,
        balance: await this.getBalance(userId),
        replayed: true,
      }
    }

    const operationId = crypto.randomUUID()
    const ledgerId = crypto.randomUUID()
    const nowIso = new Date().toISOString()
    const result: BalanceOpResult = { operationId, ledgerId, userId, delta: amount, balance: 0 }

    try {
      const res = await this.db.atomicBatch([
        { sql: 'INSERT OR IGNORE INTO Wallets (user_id, balance) VALUES (?, 0)', args: [userId] },
        { sql: 'UPDATE Wallets SET balance = balance + ?, updated_at = ? WHERE user_id = ? RETURNING balance', args: [amount, nowIso, userId] },
        {
          sql: 'INSERT INTO LedgerTransactions (id, user_id, kind, delta, balance_after, reference, operation_id) SELECT ?, ?, ?, ?, balance, ?, ? FROM Wallets WHERE user_id = ?',
          args: [ledgerId, userId, input.kind, amount, input.reference ?? null, operationId, userId],
        },
        {
          sql: 'INSERT INTO EconomicOperations (id, idempotency_key, user_id, kind, fingerprint, payload, result) VALUES (?, ?, ?, ?, ?, ?, ?)',
          args: [operationId, idempotencyKey, userId, 'credit', fingerprint, JSON.stringify({ amount }), JSON.stringify(result)],
        },
      ])
      result.balance = (res[1].rows[0]?.balance as number) ?? 0
    } catch (err) {
      if (isConstraintError(err)) {
        const existing = await this.findOperation(idempotencyKey)
        if (existing) {
          this.assertFingerprintMatch(existing, fingerprint)
          const stored = parseStored<BalanceOpResult>(existing.result)
          return {
            operationId: existing.id,
            ledgerId: stored?.ledgerId ?? '',
            userId,
            delta: amount,
            balance: await this.getBalance(userId),
            replayed: true,
          }
        }
      }
      throw err
    }

    return result
  }

  // Debit an amount from a wallet. Throws DomainError(INSUFFICIENT_FUNDS) if the
  // balance is too low. No ledger or operation row is written on failure.
  async debit(userId: string, amount: number, input: OperationInput): Promise<BalanceOpResult> {
    requireId(userId, 'userId')
    this.validateAmount(amount)
    const idempotencyKey = this.validateIdempotencyKey(input.idempotencyKey)
    const fingerprint = `debit|${userId}|${amount}|${input.kind}|${input.reference ?? ''}`

    const existing = await this.findOperation(idempotencyKey)
    if (existing) {
      this.assertFingerprintMatch(existing, fingerprint)
      const result = parseStored<BalanceOpResult>(existing.result)
      return {
        operationId: existing.id,
        ledgerId: result?.ledgerId ?? '',
        userId,
        delta: -amount,
        balance: await this.getBalance(userId),
        replayed: true,
      }
    }

    const operationId = crypto.randomUUID()
    const ledgerId = crypto.randomUUID()
    const nowIso = new Date().toISOString()
    const delta = -amount
    const result: BalanceOpResult = { operationId, ledgerId, userId, delta, balance: 0 }

    try {
      const { statements, balanceIndex } = buildDebitStatements({
        userId,
        amount,
        kind: input.kind,
        reference: input.reference ?? null,
        operationId,
        ledgerId,
        idempotencyKey,
        fingerprint,
        payload: { amount },
        result,
        nowIso,
      })
      const res = await this.db.atomicBatch(statements)

      if ((res[balanceIndex].rows?.length ?? 0) === 0) {
        throw insufficientFunds()
      }
      result.balance = (res[balanceIndex].rows[0]?.balance as number) ?? 0
    } catch (err) {
      if (isConstraintError(err)) {
        const existing = await this.findOperation(idempotencyKey)
        if (existing) {
          this.assertFingerprintMatch(existing, fingerprint)
          const stored = parseStored<BalanceOpResult>(existing.result)
          return {
            operationId: existing.id,
            ledgerId: stored?.ledgerId ?? '',
            userId,
            delta,
            balance: await this.getBalance(userId),
            replayed: true,
          }
        }
      }
      throw err
    }

    return result
  }

  // Atomic transfer from one wallet to another. Fails as a unit if the sender
  // has insufficient funds — neither side's balance changes and no ledger rows
  // are written.
  async transfer(
    fromUserId: string,
    toUserId: string,
    amount: number,
    input: OperationInput,
  ): Promise<TransferResult> {
    requireId(fromUserId, 'fromUserId')
    requireId(toUserId, 'toUserId')
    this.validateAmount(amount)
    if (fromUserId === toUserId) throw badRequest('cannot transfer to the same account')
    const idempotencyKey = this.validateIdempotencyKey(input.idempotencyKey)
    const fingerprint = `transfer|${fromUserId}|${toUserId}|${amount}|${input.reference ?? ''}`

    const existing = await this.findOperation(idempotencyKey)
    if (existing) {
      this.assertFingerprintMatch(existing, fingerprint)
      const stored = parseStored<TransferResult>(existing.result)
      return {
        operationId: existing.id,
        fromUserId,
        toUserId,
        amount,
        fromBalance: stored?.fromBalance ?? (await this.getBalance(fromUserId)),
        toBalance: stored?.toBalance ?? (await this.getBalance(toUserId)),
        replayed: true,
      }
    }

    const operationId = crypto.randomUUID()
    const nowIso = new Date().toISOString()
    const debitLedgerId = crypto.randomUUID()
    const creditLedgerId = crypto.randomUUID()
    const result: TransferResult = { operationId, fromUserId, toUserId, amount, fromBalance: 0, toBalance: 0 }

    try {
      const { statements, debitIndex, creditIndex } = buildTransferStatements({
        fromUserId,
        toUserId,
        amount,
        reference: input.reference ?? null,
        operationId,
        debitLedgerId,
        creditLedgerId,
        idempotencyKey,
        fingerprint,
        payload: { amount, toUserId },
        result,
        nowIso,
      })
      const res = await this.db.atomicBatch(statements)

      if ((res[debitIndex].rows?.length ?? 0) === 0) {
        throw insufficientFunds()
      }
      result.fromBalance = (res[debitIndex].rows[0]?.balance as number) ?? 0
      result.toBalance = (res[creditIndex].rows[0]?.balance as number) ?? 0
    } catch (err) {
      if (isConstraintError(err)) {
        const existing = await this.findOperation(idempotencyKey)
        if (existing) {
          this.assertFingerprintMatch(existing, fingerprint)
          const stored = parseStored<TransferResult>(existing.result)
          return {
            operationId: existing.id,
            fromUserId,
            toUserId,
            amount,
            fromBalance: stored?.fromBalance ?? (await this.getBalance(fromUserId)),
            toBalance: stored?.toBalance ?? (await this.getBalance(toUserId)),
            replayed: true,
          }
        }
      }
      throw err
    }

    return result
  }

  private validateIdempotencyKey(key: string): string {
    if (typeof key !== 'string' || key.length < 8 || key.length > 128) {
      throw badRequest('idempotencyKey must be 8-128 characters')
    }
    return key
  }
}
