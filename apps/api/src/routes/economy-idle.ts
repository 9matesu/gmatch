import { Hono } from 'hono'
import { orbitAuth } from '../middleware/auth'
import type { D1Turso } from '../db'
import { EconomyService } from '../economy'
import { badRequest, toDomainError } from '../common/errors'

type Bindings = { DB: D1Turso }

/**
 * Idle-credit endpoint (gMatch merge, plan §4.4): the desktop idle game
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

// last idle-credit per identity -> { at, key, gps }. In-memory: the sidecar is
// single-user-per-machine; the server deployment resets on boot, which is
// acceptable for a 60s throttle. `gps` is the earning rate the client claimed
// at its FIRST credit after a server reset (trusted boot-of-trust); every
// later credit must fit floor(elapsed * claimedGps * 1.5) + 5 (see
// idleEnvelope) — a modified client cannot mint g$ faster than its own
// registered rate on someone else's leaderboard. On YOUR OWN node the
// envelope only disciplines honest crashes; documented best-effort (SPEC §2).
const lastCredit = new Map<string, { at: number; key: string; gps: number }>()
let CREDIT_COOLDOWN_MS = 60_000

/** Test hook: shorten the throttle so envelope tests can age the anchor. */
export function __setIdleCooldown(ms: number) {
  CREDIT_COOLDOWN_MS = ms
}

/** Max claimed g$/s the envelope math honors (caps bogus-gps tricks). */
export const MAX_CLAIMED_GPS = 50_000

/**
 * Ceiling for a credit `elapsedMs` after the anchor, given claimed `gps`.
 * The 1.5x headroom (vs the 50% offline rule) plus the +5 slop covers
 * legitimate offline resumes and tick rounding. `firstCredit` (no anchor yet
 * after a server restart) is a full trusted flush.
 */
export function idleEnvelope(gps: number, elapsedMs: number, firstCredit: boolean): number {
  if (firstCredit) return 1_000_000
  const capped = Math.min(Math.max(0, Math.floor(gps)), MAX_CLAIMED_GPS)
  return Math.floor((Math.max(0, elapsedMs) / 1000) * capped * 1.5) + 5
}

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
  const rawGps = body?.gps
  if (rawGps !== undefined && (!Number.isFinite(Number(rawGps)) || Number(rawGps) < 0)) {
    throw badRequest('gps must be a non-negative number (your current passive g$/s)')
  }
  const claimGps = rawGps === undefined ? null : Math.floor(Number(rawGps))

  const now = Date.now()
  const prev = lastCredit.get(orbitId)
  // A retry of the SAME key is a replay (no double-pay) — let it through the
  // throttle AND the envelope so the client can safely re-send after a
  // dropped response.
  const isReplay = prev !== undefined && prev.key === key
  if (prev && !isReplay && now - prev.at < CREDIT_COOLDOWN_MS) {
    const retryInMs = CREDIT_COOLDOWN_MS - (now - prev.at)
    // Retry-After (seconds, rounded up) so generic clients — orbitFetch's 429
    // handler reads it — honor the real cadence instead of a fixed 5s guess.
    return c.json({ error: 'Idle credits are limited to one per 60 seconds', retryInMs }, 429, {
      'Retry-After': String(Math.ceil(retryInMs / 1000)),
    })
  }

  // Earnings envelope (SPEC §2): the FIRST credit after a server start is a
  // trusted flush (honest resume with offline earnings — the bundled sidecar
  // restarts with the app, so the anchor is genuinely you). From the NEXT
  // credit on, the flush must fit floor(elapsed * claimedGps * 1.5) + 5:
  // the client MEASURES its velocity (totalEarned samples) and can only
  // over-claim up to the MAX_CLAIMED_GPS ceiling — which is the documented
  // best-effort bound: a modified client on a shared node mints at most 1.5x
  // the highest sane rate, not unlimited. A missing claim after registration
  // fails loudly; a zero claim (client's first sample window) keeps the
  // registered rate — measured beats estimated, never jamming honest flows.
  let effectiveGps: number
  if (!prev || prev.gps === 0) {
    effectiveGps = claimGps === null ? 0 : Math.min(Math.max(claimGps, 0), MAX_CLAIMED_GPS)
  } else {
    if (claimGps === null && !isReplay) {
      return c.json({ error: 'gps (current passive g$/s) is required once a rate is registered' }, 400)
    }
    effectiveGps = !claimGps ? prev.gps : Math.min(claimGps, MAX_CLAIMED_GPS)
    const maxAllowed = idleEnvelope(effectiveGps, now - prev.at, false)
    if (!isReplay && amount > maxAllowed) {
      return c.json({ error: `Credit exceeds your registered earning rate (max ${maxAllowed} now)`, maxAllowed }, 400)
    }
  }

  const service = new EconomyService(c.env.DB)
  const result = await service.credit(orbitId, amount, {
    idempotencyKey: key,
    kind: 'reward',
    reference: `idle:${session}`,
  })
  lastCredit.set(orbitId, { at: now, key, gps: effectiveGps })

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
