import { describe, it, expect, beforeEach } from 'vitest'
import { createMockEnv } from './test-utils'
import { EconomyService } from './economy'
import { DomainError } from './common/errors'
import type { D1Turso } from './db'

describe('EconomyService', () => {
  let db: D1Turso
  let economy: EconomyService

  beforeEach(async () => {
    const env = await createMockEnv()
    db = env.DB
    economy = new EconomyService(db)
  })

  it('returns 0 for an unknown wallet', async () => {
    await expect(economy.getBalance('nobody-user-0')).resolves.toBe(0)
  })

  it('credits balance and records a ledger row', async () => {
    const res = await economy.credit('alice-user-01', 500, { idempotencyKey: 'credit-1', kind: 'grant' })
    expect(res.delta).toBe(500)
    expect(res.balance).toBe(500)
    await expect(economy.getBalance('alice-user-01')).resolves.toBe(500)

    const ledger = await db.prepare('SELECT * FROM LedgerTransactions WHERE user_id = ?').bind('alice-user-01').all<{ delta: number; balance_after: number }>()
    expect(ledger.results).toHaveLength(1)
    expect(ledger.results[0].delta).toBe(500)
    expect(ledger.results[0].balance_after).toBe(500)
  })

  it('debits balance and records a negative-delta ledger row', async () => {
    await economy.credit('alice-user-01', 500, { idempotencyKey: 'credit-1', kind: 'grant' })
    const res = await economy.debit('alice-user-01', 120, { idempotencyKey: 'debit-key-1', kind: 'purchase' })
    expect(res.delta).toBe(-120)
    expect(res.balance).toBe(380)
    await expect(economy.getBalance('alice-user-01')).resolves.toBe(380)
  })

  it('rejects a debit that would overdraw and writes nothing', async () => {
    await economy.credit('alice-user-01', 50, { idempotencyKey: 'credit-1', kind: 'grant' })

    await expect(economy.debit('alice-user-01', 100, { idempotencyKey: 'debit-over', kind: 'purchase' })).rejects.toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
    })

    await expect(economy.getBalance('alice-user-01')).resolves.toBe(50)
    const ledger = await db.prepare('SELECT count(*) AS n FROM LedgerTransactions WHERE user_id = ?').bind('alice-user-01').first<{ n: number }>()
    expect(ledger!.n).toBe(1) // only the credit
    const ops = await db.prepare('SELECT count(*) AS n FROM EconomicOperations WHERE user_id = ?').bind('alice-user-01').first<{ n: number }>()
    expect(ops!.n).toBe(1)
  })

  it('is idempotent: replaying a key does not double-apply', async () => {
    await economy.credit('alice-user-01', 100, { idempotencyKey: 'credit-1', kind: 'grant' })
    const replay = await economy.credit('alice-user-01', 100, { idempotencyKey: 'credit-1', kind: 'grant' })

    expect(replay.replayed).toBe(true)
    expect(replay.operationId).toBeTruthy()
    await expect(economy.getBalance('alice-user-01')).resolves.toBe(100)
    const ledger = await db.prepare('SELECT count(*) AS n FROM LedgerTransactions WHERE user_id = ?').bind('alice-user-01').first<{ n: number }>()
    expect(ledger!.n).toBe(1)
  })

  it('is idempotent for debits too (no double spend)', async () => {
    await economy.credit('alice-user-01', 100, { idempotencyKey: 'credit-1', kind: 'grant' })
    await economy.debit('alice-user-01', 40, { idempotencyKey: 'debit-key-1', kind: 'purchase' })
    const replay = await economy.debit('alice-user-01', 40, { idempotencyKey: 'debit-key-1', kind: 'purchase' })

    expect(replay.replayed).toBe(true)
    await expect(economy.getBalance('alice-user-01')).resolves.toBe(60)
  })

  it('transfers funds atomically between two wallets', async () => {
    await economy.credit('alice-user-01', 500, { idempotencyKey: 'credit-alice', kind: 'grant' })

    const res = await economy.transfer('alice-user-01', 'bob-user-02', 200, { idempotencyKey: 'transfer-1', kind: 'trade' })
    expect(res.fromBalance).toBe(300)
    expect(res.toBalance).toBe(200)

    await expect(economy.getBalance('alice-user-01')).resolves.toBe(300)
    await expect(economy.getBalance('bob-user-02')).resolves.toBe(200)

    const ledger = await db.prepare('SELECT * FROM LedgerTransactions WHERE operation_id = ?').bind(res.operationId).all<{ user_id: string; delta: number }>()
    expect(ledger.results).toHaveLength(2)
  })

  it('fails a transfer atomically on insufficient sender funds', async () => {
    await economy.credit('alice-user-01', 50, { idempotencyKey: 'credit-alice', kind: 'grant' })

    await expect(economy.transfer('alice-user-01', 'bob-user-02', 100, { idempotencyKey: 'transfer-2', kind: 'trade' })).rejects.toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
    })

    await expect(economy.getBalance('alice-user-01')).resolves.toBe(50)
    await expect(economy.getBalance('bob-user-02')).resolves.toBe(0)
    const ledger = await db.prepare('SELECT count(*) AS n FROM LedgerTransactions').first<{ n: number }>()
    expect(ledger!.n).toBe(1)
  })

  it('rejects negative or non-integer amounts', async () => {
    await expect(economy.credit('alice-user-01', -5, { idempotencyKey: 'bad-key-0001', kind: 'grant' })).rejects.toBeInstanceOf(DomainError)
    await expect(economy.credit('alice-user-01', 1.5, { idempotencyKey: 'bad-key-0002', kind: 'grant' })).rejects.toBeInstanceOf(DomainError)
    await expect(economy.transfer('alice-user-01', 'alice-user-01', 10, { idempotencyKey: 'self-key-0001', kind: 'trade' })).rejects.toBeInstanceOf(DomainError)
  })

  it('rejects unsafe integer amounts', async () => {
    await expect(economy.credit('alice-user-01', Number.MAX_SAFE_INTEGER + 10, { idempotencyKey: 'unsafe-key-01', kind: 'grant' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('rejects replay with mismatched parameters', async () => {
    await economy.credit('alice-user-01', 100, { idempotencyKey: 'replay-key-01', kind: 'grant' })
    await expect(economy.credit('alice-user-01', 200, { idempotencyKey: 'replay-key-01', kind: 'grant' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
  })

  it('rejects cross-user key reuse', async () => {
    await economy.credit('alice-user-01', 100, { idempotencyKey: 'replay-key-02', kind: 'grant' })
    await expect(economy.debit('bob-user-02', 100, { idempotencyKey: 'replay-key-02', kind: 'purchase' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
  })

  it('rejects transfer key reuse with a different recipient', async () => {
    await economy.credit('alice-user-01', 500, { idempotencyKey: 'credit-key-02', kind: 'grant' })
    await economy.transfer('alice-user-01', 'bob-user-02', 100, { idempotencyKey: 'transfer-key-1', kind: 'trade' })
    await expect(economy.transfer('alice-user-01', 'nobody-user-0', 100, { idempotencyKey: 'transfer-key-1', kind: 'trade' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
  })
})
