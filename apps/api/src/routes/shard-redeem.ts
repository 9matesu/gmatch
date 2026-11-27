import { Hono } from 'hono'
import { orbitAuth } from '../middleware/auth'
import type { D1Turso } from '../db'
import {
  EconomyService,
  assertReplayMatches,
  findRecordedOperation,
  parseRecordedResult,
} from '../economy'
import { badRequest, toDomainError } from '../common/errors'

type Bindings = { DB: D1Turso }

/** The one authorised shard -> g$ bridge. Shards stay local; this ledger caps the payout. */
export const SHARDS_PER_G = 1000
export const MAX_G_PER_REDEEM = 1
export const MAX_G_PER_24H = 5
export const REDEEM_COOLDOWN_MS = 6 * 60 * 60 * 1000
/**
 * Honest limitation: shards live only in the client's local save, so the node
 * cannot verify their provenance or balance. It enforces rate, cooldown and
 * cap only — a client that claims shards is trusted to have earned them.
 */
export const SHARD_PROVENANCE_NOTE = 'Shards are local and client-asserted; the node cannot verify provenance, only the payout cap.'
const WINDOW_MS = 24 * 60 * 60 * 1000
// `reward` is an existing ledger kind; `reference` is the redemption marker.
const LEDGER_KIND = 'reward'
const REFERENCE = 'shard_redeem'

export interface RedeemResult {
  ok: boolean
  grantedG: number
  shardsSpent: number
  balance: number
  granted24h: number
  remaining24h: number
  nextRedeemAt: string
  replayed?: boolean
}

interface RedeemRecord {
  grantedG: number
  shardsSpent: number
  balance: number
  nextRedeemAt: string
}

export const shardRedeem = new Hono<{ Bindings: Bindings, Variables: { orbitId: string } }>()

shardRedeem.use('*', orbitAuth)

shardRedeem.onError((err, c) => {
  const d = toDomainError(err)
  return c.json({ error: d.message }, d.status as any)
})

function idempotencyKey(c: { req: { header(n: string): string | undefined } }, body: any): string {
  const key = c.req.header('Idempotency-Key') || c.req.header('X-Idempotency-Key') || (body?.idempotency_key as string | undefined)
  if (!key || key.length < 8 || key.length > 128) {
    throw badRequest('idempotencyKey must be 8-128 characters (Idempotency-Key header or idempotency_key body)')
  }
  return key
}

/** Cap state IS the authoritative ledger: each redemption writes one marked reward row. */
async function recentGrants(db: D1Turso, userId: string, now: number) {
  const rows = await db
    .prepare("SELECT delta, created_at FROM LedgerTransactions WHERE user_id = ? AND kind = ? AND reference = ? ORDER BY created_at DESC LIMIT 64")
    .bind(userId, LEDGER_KIND, REFERENCE)
    .all<{ delta: number; created_at: string }>()
  let granted = 0
  let lastAt: number | null = null
  for (const row of rows.results) {
    const at = Date.parse(row.created_at)
    if (!Number.isFinite(at)) continue
    if (lastAt === null) lastAt = at
    if (now - at < WINDOW_MS) granted += Math.max(0, Number(row.delta))
  }
  return { granted, lastAt }
}

// One sidecar process: serialise a user's check-and-credit so two concurrent
// requests cannot both read a free window before either writes its ledger row.
const redeeming = new Set<string>()

shardRedeem.post('/', async (c) => {
  const userId = c.get('orbitId')
  const body = await c.req.json().catch(() => ({}))
  const key = idempotencyKey(c, body)
  const shards = Number(body?.shards)
  if (!Number.isSafeInteger(shards) || shards <= 0) {
    throw badRequest('shards must be a positive integer')
  }

  const service = new EconomyService(c.env.DB)
  const existing = await findRecordedOperation(c.env.DB, key)
  if (existing) {
    assertReplayMatches(existing, { userId })
    // EconomyService records the credit's delta — that IS the granted g$.
    const stored = parseRecordedResult<{ delta?: number }>(existing)
    const grantedG = typeof stored?.delta === 'number' && Number.isSafeInteger(stored.delta)
      ? Math.max(0, stored.delta)
      : 0
    if (grantedG > 0) {
      const now = Date.now()
      const { granted, lastAt } = await recentGrants(c.env.DB, userId, now)
      return c.json({
        ok: true,
        grantedG,
        // The credit already happened on the first call: a replay must not
        // ask the client to deduct its local shards a second time.
        shardsSpent: 0,
        balance: await service.getBalance(userId),
        granted24h: granted,
        remaining24h: Math.max(0, MAX_G_PER_24H - granted),
        nextRedeemAt: new Date((lastAt ?? now) + REDEEM_COOLDOWN_MS).toISOString(),
        replayed: true,
      } satisfies RedeemResult)
    }
  }

  if (redeeming.has(userId)) {
    return c.json({ error: 'A redemption is already in progress', retryAfterMs: 1000 }, 429)
  }
  redeeming.add(userId)
  try {
    const now = Date.now()
    const { granted, lastAt } = await recentGrants(c.env.DB, userId, now)
    const remaining24h = Math.max(0, MAX_G_PER_24H - granted)
    const retryAfterMs = lastAt === null ? 0 : Math.max(0, REDEEM_COOLDOWN_MS - (now - lastAt))
    if (remaining24h === 0 || retryAfterMs > 0) {
      return c.json({
        error: 'Shard redemption is cooling down',
        granted24h: granted,
        remaining24h,
        retryAfterMs,
        nextRedeemAt: new Date(Math.max(now, (lastAt ?? now) + REDEEM_COOLDOWN_MS)).toISOString(),
      }, 429)
    }
    const grantedG = Math.min(
      Math.floor(shards / SHARDS_PER_G),
      MAX_G_PER_REDEEM,
      remaining24h,
    )
    if (grantedG < 1) {
      return c.json({ error: `Need ${SHARDS_PER_G} shards to redeem 1 g$`, grantedG: 0 }, 400)
    }
    const shardsSpent = grantedG * SHARDS_PER_G
    const credited = await service.credit(userId, grantedG, {
      idempotencyKey: key,
      kind: LEDGER_KIND,
      reference: REFERENCE,
    })
    const record: RedeemRecord = {
      grantedG,
      shardsSpent,
      balance: credited.balance,
      nextRedeemAt: new Date(Date.now() + REDEEM_COOLDOWN_MS).toISOString(),
    }
    return c.json({
      ok: true,
      ...record,
      granted24h: granted + grantedG,
      remaining24h: remaining24h - grantedG,
    } satisfies RedeemResult)
  } finally {
    redeeming.delete(userId)
  }
})
