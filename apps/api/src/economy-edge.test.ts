// Edge-branch coverage for EconomyService: idempotency races (constraint
// conflict on replay), fingerprint-mismatch handling, malformed stored
// payloads, amount/key validation, and statement-builder composition.
import { describe, it, expect, beforeEach } from 'vitest'
import { createMockEnv } from './test-utils'
import {
  EconomyService,
  buildTransferStatements,
  buildDebitStatements,
} from './economy'
import { SqlError } from './db'
import type { D1Turso } from './db'

const ALICE = 'alice-edge-01'
const BOB = 'bob-edge-02'

let db: D1Turso
let economy: EconomyService

beforeEach(async () => {
  const env = await createMockEnv()
  db = env.DB
  economy = new EconomyService(db)
})

// Insert a "winner" operation row directly, simulating a concurrent request
// that committed between our pre-check and our own write transaction.
async function seedOperation(params: {
  id: string
  key: string
  userId: string
  kind: string
  fingerprint: string | null
  result: string | null
}) {
  await db
    .prepare(
      'INSERT INTO EconomicOperations (id, idempotency_key, user_id, kind, fingerprint, result) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .bind(params.id, params.key, params.userId, params.kind, params.fingerprint, params.result)
    .run()
}

describe('concurrent idempotency races (constraint-conflict recovery)', () => {
  it('two simultaneous credits with one key: exactly one applies, the loser replays', async () => {
    const results = await Promise.all([
      economy.credit(ALICE, 100, { idempotencyKey: 'race-credit-01', kind: 'grant' }),
      economy.credit(ALICE, 100, { idempotencyKey: 'race-credit-01', kind: 'grant' }),
    ])
    const replays = results.filter((r) => r.replayed === true)
    expect(replays).toHaveLength(1)
    expect(await economy.getBalance(ALICE)).toBe(100)
    const ledger = await db.prepare('SELECT count(*) AS n FROM LedgerTransactions WHERE user_id = ?').bind(ALICE).first<{ n: number }>()
    expect(Number(ledger!.n)).toBe(1)
  })

  it('two simultaneous debits with one key: money leaves exactly once', async () => {
    await economy.credit(ALICE, 100, { idempotencyKey: 'race-seed-debit', kind: 'grant' })
    const results = await Promise.all([
      economy.debit(ALICE, 40, { idempotencyKey: 'race-debit-01', kind: 'purchase' }),
      economy.debit(ALICE, 40, { idempotencyKey: 'race-debit-01', kind: 'purchase' }),
    ])
    const replays = results.filter((r) => r.replayed === true)
    expect(replays).toHaveLength(1)
    expect(replays[0].delta).toBe(-40)
    expect(await economy.getBalance(ALICE)).toBe(60)
  })

  it('two simultaneous transfers with one key: funds move exactly once', async () => {
    await economy.credit(ALICE, 500, { idempotencyKey: 'race-seed-transfer', kind: 'grant' })
    const results = await Promise.all([
      economy.transfer(ALICE, BOB, 100, { idempotencyKey: 'race-transfer-01', kind: 'transfer' }),
      economy.transfer(ALICE, BOB, 100, { idempotencyKey: 'race-transfer-01', kind: 'transfer' }),
    ])
    const replays = results.filter((r) => r.replayed === true)
    expect(replays).toHaveLength(1)
    expect(await economy.getBalance(ALICE)).toBe(400)
    expect(await economy.getBalance(BOB)).toBe(100)
  })

  it('constraint error whose operation row is not found rethrows the SqlError', async () => {
    // Pre-insert a conflicting key, then blind the pre-check so the batch
    // itself hits the UNIQUE violation and the recovery re-read finds nothing.
    await seedOperation({
      id: 'ghost-op-0001',
      key: 'ghost-key-0001',
      userId: BOB,
      kind: 'credit',
      fingerprint: 'credit|bob-edge-02|7|grant|',
      result: null,
    })
    const svc = new EconomyService(db)
    ;(svc as any).findOperation = async () => null
    await expect(
      svc.credit(ALICE, 7, { idempotencyKey: 'ghost-key-0001', kind: 'grant' }),
    ).rejects.toBeInstanceOf(SqlError)
  })

  it('non-constraint batch failures propagate untouched', async () => {
    const fakeDb = (err: Error) =>
      new EconomyService({
        prepare: db.prepare.bind(db),
        batch: db.batch.bind(db),
        atomicBatch: async () => {
          throw err
        },
      } as unknown as D1Turso)

    await expect(
      fakeDb(new Error('generic failure')).credit(ALICE, 5, { idempotencyKey: 'generic-fail-01', kind: 'grant' }),
    ).rejects.toThrow('generic failure')

    // SqlError with a non-CONSTRAINT code is not treated as a replay race.
    await expect(
      fakeDb(new SqlError('busy', 'SQLITE_BUSY')).credit(ALICE, 5, { idempotencyKey: 'busy-fail-0001', kind: 'grant' }),
    ).rejects.toBeInstanceOf(SqlError)
  })
})

describe('stored-operation replay edge branches', () => {
  it('replay honours a null fingerprint (no conflict) and yields empty ledgerId when result is missing', async () => {
    await seedOperation({
      id: 'nofp-op-0001',
      key: 'nofp-key-0001',
      userId: ALICE,
      kind: 'credit',
      fingerprint: null,
      result: null,
    })
    const res = await economy.credit(ALICE, 42, { idempotencyKey: 'nofp-key-0001', kind: 'grant' })
    expect(res.replayed).toBe(true)
    expect(res.operationId).toBe('nofp-op-0001')
    expect(res.ledgerId).toBe('')
    expect(res.delta).toBe(42)
  })

  it('malformed stored result JSON degrades to empty ledgerId instead of throwing', async () => {
    await seedOperation({
      id: 'badjson-op-01',
      key: 'badjson-key1',
      userId: ALICE,
      kind: 'credit',
      fingerprint: 'credit|alice-edge-01|9|grant|',
      result: '{not valid json',
    })
    const res = await economy.credit(ALICE, 9, { idempotencyKey: 'badjson-key1', kind: 'grant' })
    expect(res.replayed).toBe(true)
    expect(res.ledgerId).toBe('')
  })

  it('debit replay with missing stored result still reports negative delta', async () => {
    await seedOperation({
      id: 'debitrp-op-01',
      key: 'debitrp-key-1',
      userId: ALICE,
      kind: 'debit',
      fingerprint: null,
      result: null,
    })
    const res = await economy.debit(ALICE, 11, { idempotencyKey: 'debitrp-key-1', kind: 'purchase' })
    expect(res.replayed).toBe(true)
    expect(res.delta).toBe(-11)
    expect(res.ledgerId).toBe('')
  })

  it('transfer replay falls back to live balances when stored result is absent', async () => {
    await economy.credit(ALICE, 300, { idempotencyKey: 'tr-seed-alice', kind: 'grant' })
    await economy.credit(BOB, 50, { idempotencyKey: 'tr-seed-bob', kind: 'grant' })
    await seedOperation({
      id: 'trnull-op-001',
      key: 'trnull-key-01',
      userId: ALICE,
      kind: 'transfer',
      fingerprint: null,
      result: null,
    })
    const res = await economy.transfer(ALICE, BOB, 10, { idempotencyKey: 'trnull-key-01', kind: 'transfer' })
    expect(res.replayed).toBe(true)
    expect(res.fromBalance).toBe(300)
    expect(res.toBalance).toBe(50)
  })

  it('transfer replay uses stored balances when present', async () => {
    const stored = JSON.stringify({ fromBalance: 111, toBalance: 222 })
    await seedOperation({
      id: 'trok-op-0001',
      key: 'trok-key-001',
      userId: ALICE,
      kind: 'transfer',
      fingerprint: 'transfer|alice-edge-01|bob-edge-02|10|',
      result: stored,
    })
    const res = await economy.transfer(ALICE, BOB, 10, { idempotencyKey: 'trok-key-001', kind: 'transfer' })
    expect(res.replayed).toBe(true)
    expect(res.fromBalance).toBe(111)
    expect(res.toBalance).toBe(222)
  })
})

describe('input validation', () => {
  it('rejects invalid userIds on every entry point', async () => {
    await expect(economy.getBalance('x')).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(economy.credit('nope', 5, { idempotencyKey: 'validkey-01', kind: 'grant' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(economy.debit('!!bad!!', 5, { idempotencyKey: 'validkey-02', kind: 'purchase' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(economy.transfer(ALICE, 'short', 5, { idempotencyKey: 'validkey-03', kind: 'transfer' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(economy.listTransactions('')).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('rejects non-number, NaN, zero, negative and fractional amounts', async () => {
    const bad: unknown[] = [0, -1, 1.5, NaN, '100', null, undefined, Infinity]
    for (const amount of bad) {
      await expect(
        economy.credit(ALICE, amount as number, { idempotencyKey: `amt-key-${String(amount)}`, kind: 'grant' }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    }
  })

  it('rejects idempotency keys that are too short, too long, or not strings', async () => {
    await expect(economy.credit(ALICE, 5, { idempotencyKey: 'short', kind: 'grant' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(economy.credit(ALICE, 5, { idempotencyKey: 'k'.repeat(129), kind: 'grant' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(economy.credit(ALICE, 5, { idempotencyKey: 12345678 as unknown as string, kind: 'grant' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(economy.debit(ALICE, 5, { idempotencyKey: 'short', kind: 'purchase' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(economy.transfer(ALICE, BOB, 5, { idempotencyKey: 'short', kind: 'transfer' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('rejects self-transfer with a distinct message', async () => {
    await expect(
      economy.transfer(ALICE, ALICE, 5, { idempotencyKey: 'self-tr-key-01', kind: 'transfer' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'cannot transfer to the same account' })
  })

  it('clamps listTransactions limit/offset instead of erroring', async () => {
    await economy.credit(ALICE, 10, { idempotencyKey: 'clamp-seed-01', kind: 'grant' })
    // limit 0 -> falsy -> 50; negative -> 1; huge -> 200; NaN -> 50; offset negative -> 0
    expect(await economy.listTransactions(ALICE, 0)).toHaveLength(1)
    expect(await economy.listTransactions(ALICE, -5)).toHaveLength(1)
    expect(await economy.listTransactions(ALICE, 99999)).toHaveLength(1)
    expect(await economy.listTransactions(ALICE, NaN)).toHaveLength(1)
    expect(await economy.listTransactions(ALICE, 50, -10)).toHaveLength(1)
    expect(await economy.listTransactions(ALICE, 50, 5)).toHaveLength(0)
  })
})

describe('statement builders', () => {
  it('buildTransferStatements appends debitGate clause/args and extra statements', () => {
    const { statements, debitIndex, creditIndex } = buildTransferStatements({
      fromUserId: ALICE,
      toUserId: BOB,
      amount: 25,
      reference: 'mkt:1',
      operationId: 'op-gate-01',
      debitLedgerId: 'led-a',
      creditLedgerId: 'led-b',
      idempotencyKey: 'gate-key-0001',
      fingerprint: 'fp',
      payload: {},
      result: {},
      nowIso: new Date().toISOString(),
      debitGate: { clause: 'AND EXISTS (SELECT 1 FROM Users WHERE id = ?)', args: [BOB] },
      extra: [{ sql: 'SELECT 1', args: [] }],
    })
    expect(debitIndex).toBe(2)
    expect(creditIndex).toBe(3)
    expect(statements[2].sql).toContain('AND EXISTS')
    expect(statements[2].args).toEqual([25, expect.any(String), ALICE, 25, BOB])
    expect(statements[statements.length - 1].sql).toBe('SELECT 1')
  })

  it('buildDebitStatements appends debitGate and extra statements', () => {
    const { statements, balanceIndex } = buildDebitStatements({
      userId: ALICE,
      amount: 15,
      kind: 'purchase',
      reference: null,
      operationId: 'op-debit-01',
      ledgerId: 'led-c',
      idempotencyKey: 'dbgate-key-1',
      fingerprint: 'fp',
      payload: {},
      result: {},
      nowIso: new Date().toISOString(),
      debitGate: { clause: 'AND balance >= 100', args: [] },
      extra: [{ sql: 'SELECT 2', args: [] }],
    })
    expect(balanceIndex).toBe(1)
    expect(statements[1].sql).toContain('AND balance >= 100')
    expect(statements[statements.length - 1].sql).toBe('SELECT 2')
  })

  it('debitGate can veto a debit even with sufficient funds (atomic no-op)', async () => {
    await economy.credit(ALICE, 100, { idempotencyKey: 'gate-seed-01', kind: 'grant' })
    const { statements, balanceIndex } = buildDebitStatements({
      userId: ALICE,
      amount: 10,
      kind: 'purchase',
      reference: null,
      operationId: 'op-veto-001',
      ledgerId: 'led-veto',
      idempotencyKey: 'veto-key-0001',
      fingerprint: 'fp',
      payload: {},
      result: {},
      nowIso: new Date().toISOString(),
      debitGate: { clause: 'AND 0 = 1', args: [] },
    })
    const res = await db.atomicBatch(statements)
    expect(res[balanceIndex].rows).toHaveLength(0) // gate blocked the UPDATE
    expect(await economy.getBalance(ALICE)).toBe(100)
    const ledger = await db.prepare('SELECT count(*) AS n FROM LedgerTransactions WHERE operation_id = ?').bind('op-veto-001').first<{ n: number }>()
    expect(Number(ledger!.n)).toBe(0)
  })
})
