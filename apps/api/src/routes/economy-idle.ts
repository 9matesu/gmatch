import { Hono } from 'hono'
import { orbitAuth } from '../middleware/auth'
import type { D1Turso } from '../db'
import { EconomyService } from '../economy'
import { badRequest, toDomainError } from '../common/errors'

type Bindings = { DB: D1Turso }

/**
 * Idle-credit endpoint (GoonGrid merge, plan §4.4): the desktop idle game
 * flushes offline-earned g$ into the authoritative server ledger. One credit
 * per 60s per identity; idempotent via Idempotency-Key so a retry after a
 * dropped response never double-pays.
 */
export const economyIdle = new Hono<{ Bindings: Bindings, Variables: { orbitId: string } }>()

economyIdle.use('*', orbitAuth)

economyIdle.onError((err, c) => {
  const d = toDomainError(err)
  return c.json({ error: d.message }, d.status as any)
})

// last idle-credit per identity -> { at, key }. In-memory: the sidecar is
// single-user-per-machine; the server deployment resets on boot, which is
// acceptable for a 60s throttle.
const lastCredit = new Map<string, { at: number; key: string }>()
const CREDIT_COOLDOWN_MS = 60_000

/** Test-only: clear the in-memory throttle between cases. */
export function __resetIdleThrottle() {
  lastCredit.clear()
}

economyIdle.post('/idle-credit', async (c) => {
  const orbitId = c.get('orbitId')
  const body = await c.req.json().catch(() => ({}))
  const amount = Number(body?.amount)
  const session = String(body?.session || '').trim()

  if (!Number.isInteger(amount) || amount < 1 || amount > 1_000_000) {
    throw badRequest('amount must be an integer between 1 and 1000000')
  }
  if (!session || session.length > 128) {
    throw badRequest('session must be 1-128 characters')
  }
  const key = c.req.header('Idempotency-Key') || c.req.header('X-Idempotency-Key') || (body?.idempotency_key as string | undefined)
  if (!key || key.length < 8 || key.length > 128) {
    throw badRequest('idempotencyKey must be 8-128 characters (Idempotency-Key header or idempotency_key body)')
  }

  const now = Date.now()
  const prev = lastCredit.get(orbitId)
  // A retry of the SAME key is a replay (no double-pay) — let it through the
  // throttle so the client can safely re-send after a dropped response.
  const isReplay = prev !== undefined && prev.key === key
  if (prev && !isReplay && now - prev.at < CREDIT_COOLDOWN_MS) {
    return c.json({ error: 'Idle credits are limited to one per 60 seconds' }, 429)
  }

  const service = new EconomyService(c.env.DB)
  const result = await service.credit(orbitId, amount, {
    idempotencyKey: key,
    kind: 'reward',
    reference: `idle:${session}`,
  })
  lastCredit.set(orbitId, { at: now, key })

  return c.json({ balance: result.balance, delta: result.delta, replayed: result.replayed === true })
})

/**
 * Symmetric debit: idle purchases (tags, caps, gallery keepsakes) spend from
 * the same authoritative ledger. No throttle — debits can only reduce the
 * balance, so spamming them cannot exploit; idempotency still required.
 */
economyIdle.post('/idle-debit', async (c) => {
  const orbitId = c.get('orbitId')
  const body = await c.req.json().catch(() => ({}))
  const amount = Number(body?.amount)
  const reference = String(body?.reference || '').trim()

  if (!Number.isInteger(amount) || amount < 1 || amount > 1_000_000) {
    throw badRequest('amount must be an integer between 1 and 1000000')
  }
  if (!reference || reference.length > 100) {
    throw badRequest('reference must be 1-100 characters')
  }
  const key = c.req.header('Idempotency-Key') || c.req.header('X-Idempotency-Key') || (body?.idempotency_key as string | undefined)
  if (!key || key.length < 8 || key.length > 128) {
    throw badRequest('idempotencyKey must be 8-128 characters (Idempotency-Key header or idempotency_key body)')
  }

  const service = new EconomyService(c.env.DB)
  const result = await service.debit(orbitId, amount, {
    idempotencyKey: key,
    kind: 'purchase',
    reference: `idle:${reference}`,
  })

  return c.json({ balance: result.balance, delta: -amount, replayed: result.replayed === true })
})
