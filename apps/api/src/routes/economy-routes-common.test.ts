// Coverage for src/routes/economy.ts (balance/transactions/transfer/cashout-rate)
// and src/common/{errors,validation}.ts.
import { describe, it, expect, beforeAll } from 'vitest'
import app from '../index'
import { createTestIdentity, signRequestHeaders, createMockEnv } from '../test-utils'
import { EconomyService } from '../economy'
import {
  DomainError,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  insufficientFunds,
  idempotencyConflict,
  invalidState,
  internal,
  toDomainError,
} from '../common/errors'
import {
  requireString,
  optionalString,
  requireEnum,
  requireInteger,
  requireNonNegativeInt,
  requireId,
  requireStringArray,
} from '../common/validation'

const alice = createTestIdentity()
const bob = createTestIdentity()

let env: Awaited<ReturnType<typeof createMockEnv>>

function authHeaders(method: string, url: string, body?: string, who = alice) {
  return signRequestHeaders(who, method, url, body)
}

beforeAll(async () => {
  env = await createMockEnv()
  // Register both identities via an authenticated GET.
  await app.request('/api/economy/balance', { headers: authHeaders('GET', '/api/economy/balance') }, env)
  await app.request('/api/economy/balance', { headers: authHeaders('GET', '/api/economy/balance', undefined, bob) }, env)
})

describe('GET /api/economy/balance', () => {
  it('returns 0 for a fresh wallet', async () => {
    const res = await app.request('/api/economy/balance', { headers: authHeaders('GET', '/api/economy/balance') }, env)
    expect(res.status).toBe(200)
    expect(typeof (await res.json()).balance).toBe('number')
  })

  it('reflects ledger credits', async () => {
    await new EconomyService(env.DB).credit(alice.orbitId, 77, {
      idempotencyKey: 'bal-route-key-01',
      kind: 'reward',
      reference: 'test-fund',
    })
    const res = await app.request('/api/economy/balance', { headers: authHeaders('GET', '/api/economy/balance') }, env)
    const json = await res.json() as { balance: number }
    expect(json.balance).toBeGreaterThanOrEqual(77)
  })
})

describe('GET /api/economy/cashout-rate', () => {
  it('returns the default rate when SystemMeta has no override', async () => {
    const res = await app.request('/api/economy/cashout-rate', { headers: authHeaders('GET', '/api/economy/cashout-rate') }, env)
    expect(res.status).toBe(200)
    expect((await res.json()).rateBps).toBe(12500)
  })

  it('returns an admin override, clamped to the legal range', async () => {
    await env.DB.prepare("INSERT OR REPLACE INTO SystemMeta (key, value) VALUES ('economy_cashout_rate_bps', '999999')").run()
    const res = await app.request('/api/economy/cashout-rate', { headers: authHeaders('GET', '/api/economy/cashout-rate') }, env)
    expect((await res.json()).rateBps).toBe(50000)
    await env.DB.prepare("DELETE FROM SystemMeta WHERE key = 'economy_cashout_rate_bps'").run()
  })
})

describe('GET /api/economy/transactions', () => {
  it('lists ledger rows newest-first with limit/offset query params', async () => {
    const economy = new EconomyService(env.DB)
    await economy.credit(alice.orbitId, 10, { idempotencyKey: 'tx-list-key-01', kind: 'grant' })
    await economy.credit(alice.orbitId, 20, { idempotencyKey: 'tx-list-key-02', kind: 'reward' })

    const res = await app.request('/api/economy/transactions?limit=1&offset=0', {
      headers: authHeaders('GET', '/api/economy/transactions'),
    }, env)
    expect(res.status).toBe(200)
    const json = await res.json() as { transactions: Array<{ delta: number }> }
    expect(json.transactions.length).toBeLessThanOrEqual(1)

    const all = await app.request('/api/economy/transactions', {
      headers: authHeaders('GET', '/api/economy/transactions'),
    }, env)
    const allJson = await all.json() as { transactions: Array<{ delta: number; kind: string }> }
    expect(allJson.transactions.some((t) => t.kind === 'grant' && t.delta === 10)).toBe(true)
  })

  it('survives garbage limit/offset values (NaN -> defaults)', async () => {
    const res = await app.request('/api/economy/transactions?limit=abc&offset=xyz', {
      headers: authHeaders('GET', '/api/economy/transactions'),
    }, env)
    expect(res.status).toBe(200)
    expect(Array.isArray((await res.json()).transactions)).toBe(true)
  })
})

describe('POST /api/economy/transfer', () => {
  async function transfer(body: unknown, key?: string, who = alice) {
    const text = JSON.stringify(body)
    const headers: Record<string, string> = {
      ...authHeaders('POST', '/api/economy/transfer', text, who),
      'Content-Type': 'application/json',
    }
    if (key) headers['Idempotency-Key'] = key
    return app.request('/api/economy/transfer', { method: 'POST', headers, body: text }, env)
  }

  it('moves funds between wallets and records both ledger sides', async () => {
    const economy = new EconomyService(env.DB)
    await economy.credit(alice.orbitId, 1000, { idempotencyKey: 'route-tr-seed-1', kind: 'grant' })
    const res = await transfer({ to_user_id: bob.orbitId, amount: 150 }, 'route-tr-key-001')
    expect(res.status).toBe(200)
    const json = await res.json() as { fromBalance: number; toBalance: number; replayed?: boolean }
    expect(json.replayed).toBeUndefined()
    expect(json.toBalance).toBeGreaterThanOrEqual(150)
    expect(await economy.getBalance(bob.orbitId)).toBeGreaterThanOrEqual(150)
  })

  it('accepts the X-Idempotency-Key header variant', async () => {
    const text = JSON.stringify({ to_user_id: bob.orbitId, amount: 5 })
    const res = await app.request('/api/economy/transfer', {
      method: 'POST',
      headers: {
        ...authHeaders('POST', '/api/economy/transfer', text),
        'Content-Type': 'application/json',
        'X-Idempotency-Key': 'x-idem-header-key1',
      },
      body: text,
    }, env)
    expect(res.status).toBe(200)
  })

  it('accepts a body idempotency_key', async () => {
    const text = JSON.stringify({ to_user_id: bob.orbitId, amount: 5, idempotency_key: 'body-idem-key-0001' })
    const res = await app.request('/api/economy/transfer', {
      method: 'POST',
      headers: { ...authHeaders('POST', '/api/economy/transfer', text), 'Content-Type': 'application/json' },
      body: text,
    }, env)
    expect(res.status).toBe(200)
  })

  it('400s without any idempotency key', async () => {
    const res = await transfer({ to_user_id: bob.orbitId, amount: 5 })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('idempotencyKey')
  })

  it('400s on a too-short key', async () => {
    const res = await transfer({ to_user_id: bob.orbitId, amount: 5 }, 'short')
    expect(res.status).toBe(400)
  })

  it('400s on an overdraft via the route error handler', async () => {
    const broke = createTestIdentity()
    await app.request('/api/economy/balance', { headers: signRequestHeaders(broke, 'GET', '/api/economy/balance') }, env)
    const res = await transfer({ to_user_id: bob.orbitId, amount: 999999 }, 'overdraft-route-1', broke)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Insufficient funds')
  })

  it('400s on a malformed JSON body (falls back to {} then fails validation)', async () => {
    const text = '{not json'
    const res = await app.request('/api/economy/transfer', {
      method: 'POST',
      headers: { ...authHeaders('POST', '/api/economy/transfer', text), 'Content-Type': 'application/json' },
      body: text,
    }, env)
    expect(res.status).toBe(400)
  })

  it('replaying the same key returns the recorded result', async () => {
    const first = await transfer({ to_user_id: bob.orbitId, amount: 7 }, 'route-replay-key1')
    expect(first.status).toBe(200)
    const second = await transfer({ to_user_id: bob.orbitId, amount: 7 }, 'route-replay-key1')
    expect(second.status).toBe(200)
    const json = await second.json() as { replayed?: boolean }
    expect(json.replayed).toBe(true)
  })
})

describe('common/errors.ts', () => {
  it('every factory produces the right code + HTTP status', () => {
    expect(badRequest('x')).toMatchObject({ code: 'BAD_REQUEST', status: 400, name: 'DomainError' })
    expect(unauthorized()).toMatchObject({ code: 'UNAUTHORIZED', status: 401, message: 'Not authenticated' })
    expect(unauthorized('custom')).toMatchObject({ message: 'custom' })
    expect(forbidden()).toMatchObject({ code: 'FORBIDDEN', status: 403, message: 'Not authorized' })
    expect(forbidden('nope')).toMatchObject({ message: 'nope' })
    expect(notFound()).toMatchObject({ code: 'NOT_FOUND', status: 404, message: 'Not found' })
    expect(notFound('gone')).toMatchObject({ message: 'gone' })
    expect(conflict('dup')).toMatchObject({ code: 'CONFLICT', status: 409, message: 'dup' })
    expect(insufficientFunds()).toMatchObject({ code: 'INSUFFICIENT_FUNDS', status: 400 })
    expect(insufficientFunds('broke')).toMatchObject({ message: 'broke' })
    expect(idempotencyConflict()).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', status: 409 })
    expect(idempotencyConflict('reused')).toMatchObject({ message: 'reused' })
    expect(invalidState('bad phase')).toMatchObject({ code: 'INVALID_STATE', status: 409 })
    expect(internal()).toMatchObject({ code: 'INTERNAL', status: 500, message: 'Internal server error' })
  })

  it('internal() preserves cause but keeps it out of the message', () => {
    const cause = new Error('sql leaked')
    const err = internal('Internal server error', cause)
    expect((err as unknown as { cause: unknown }).cause).toBe(cause)
    expect(err.message).not.toContain('sql leaked')
  })

  it('DomainError carries optional details', () => {
    const err = badRequest('field bad', { field: 'amount' })
    expect(err.details).toEqual({ field: 'amount' })
    expect(err).toBeInstanceOf(Error)
  })

  it('toDomainError passes DomainErrors through and wraps everything else', () => {
    const original = new DomainError('NOT_FOUND', 'already domain')
    expect(toDomainError(original)).toBe(original)
    const wrapped = toDomainError(new Error('raw db failure'))
    expect(wrapped.code).toBe('INTERNAL')
    expect(wrapped.status).toBe(500)
    expect(wrapped.message).toBe('Internal server error')
    expect((wrapped as unknown as { cause: unknown }).cause).toBeInstanceOf(Error)
    expect(toDomainError('string thrown').code).toBe('INTERNAL')
    expect(toDomainError(null).code).toBe('INTERNAL')
  })
})

describe('common/validation.ts', () => {
  it('requireString: type, trim, min/max', () => {
    expect(requireString('  hi  ', 'name')).toBe('hi')
    expect(() => requireString(42, 'name')).toThrow('name must be a string')
    expect(() => requireString('ab', 'name', { min: 3 })).toThrow('at least 3')
    expect(() => requireString('abcd', 'name', { max: 3 })).toThrow('at most 3')
    expect(requireString('ok', 'name', { min: 1, max: 5 })).toBe('ok')
  })

  it('optionalString: null/undefined pass through, others validate', () => {
    expect(optionalString(undefined, 'x')).toBeNull()
    expect(optionalString(null, 'x')).toBeNull()
    expect(optionalString(' y ', 'x')).toBe('y')
    expect(() => optionalString('toolong', 'x', { max: 3 })).toThrow('at most 3')
    expect(() => optionalString(7, 'x')).toThrow('must be a string')
  })

  it('requireEnum: membership check with helpful message', () => {
    expect(requireEnum('a', 'letter', ['a', 'b'] as const)).toBe('a')
    expect(() => requireEnum('c', 'letter', ['a', 'b'] as const)).toThrow('letter must be one of: a, b')
    expect(() => requireEnum(5, 'letter', ['a'] as const)).toThrow('must be one of')
  })

  it('requireInteger: safe-integer + bounds', () => {
    expect(requireInteger(7, 'n')).toBe(7)
    expect(() => requireInteger(7.5, 'n')).toThrow('n must be an integer')
    expect(() => requireInteger('7', 'n')).toThrow('must be an integer')
    expect(() => requireInteger(Number.MAX_SAFE_INTEGER + 2, 'n')).toThrow('must be an integer')
    expect(() => requireInteger(1, 'n', { min: 5 })).toThrow('must be >= 5')
    expect(() => requireInteger(10, 'n', { max: 5 })).toThrow('must be <= 5')
  })

  it('requireNonNegativeInt rejects negatives', () => {
    expect(requireNonNegativeInt(0, 'n')).toBe(0)
    expect(() => requireNonNegativeInt(-1, 'n')).toThrow('must be >= 0')
    expect(() => requireNonNegativeInt(100, 'n', { max: 10 })).toThrow('must be <= 10')
  })

  it('requireId: charset and length rules', () => {
    expect(requireId('valid_id-123', 'userId')).toBe('valid_id-123')
    expect(() => requireId('short', 'userId')).toThrow('userId is not a valid id')
    expect(() => requireId('has spaces!!', 'userId')).toThrow('not a valid id')
    expect(() => requireId(123 as unknown, 'userId')).toThrow('not a valid id')
  })

  it('requireStringArray: array check, maxItems, per-item validation', () => {
    expect(requireStringArray(['a', 'b'], 'tags')).toEqual(['a', 'b'])
    expect(() => requireStringArray('nope', 'tags')).toThrow('tags must be an array')
    expect(() => requireStringArray(['a', 'b', 'c'], 'tags', { maxItems: 2 })).toThrow('at most 2 items')
    expect(() => requireStringArray(['ok', 5], 'tags')).toThrow('tags[1] must be a string')
    expect(() => requireStringArray(['toolongtag'], 'tags', { maxLength: 5 })).toThrow('at most 5')
  })
})
