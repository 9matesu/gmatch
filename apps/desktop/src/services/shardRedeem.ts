"use client";

/**
 * One-way shard -> g$ redemption. Shards are LOCAL (the idle save); g$ is the
 * node's authoritative ledger. This service only reports what the node did —
 * it never credits g$ locally and never decides the rate or the cap.
 */
import { orbitFetch, type OrbitIdentityLike } from '../utils/api'

export interface ShardRedemption {
  ok: boolean
  /** g$ actually credited to the signed-in wallet. */
  grantedG: number
  /** Shards the caller should deduct from its local counter (only on ok). */
  shardsSpent: number
  balance: number
  remaining24h: number
  nextRedeemAt: string
  replayed?: boolean
  error?: string
  retryAfterMs?: number
}

function idempotencyKey(identity: OrbitIdentityLike): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  return `sr:${identity.orbitId.slice(0, 16)}:${uuid ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`
}

/** Post a signed redemption; every field comes from the node's real response. */
export async function redeemShards(
  identity: OrbitIdentityLike,
  shards: number,
  fetchImpl: typeof orbitFetch = orbitFetch,
): Promise<ShardRedemption> {
  if (!Number.isSafeInteger(shards) || shards <= 0) {
    return { ok: false, grantedG: 0, shardsSpent: 0, balance: 0, remaining24h: 0, nextRedeemAt: '', error: 'No shards to redeem.' }
  }
  let res: Response
  try {
    res = await fetchImpl('/api/shard-redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey(identity) },
      body: JSON.stringify({ shards }),
    }, identity)
  } catch {
    return { ok: false, grantedG: 0, shardsSpent: 0, balance: 0, remaining24h: 0, nextRedeemAt: '', error: 'Could not reach the node — nothing was redeemed.' }
  }
  const data = await res.json().catch(() => null) as Partial<ShardRedemption> | null
  if (!res.ok || data?.ok !== true) {
    return {
      ok: false,
      grantedG: 0,
      shardsSpent: 0,
      balance: 0,
      remaining24h: typeof data?.remaining24h === 'number' ? data.remaining24h : 0,
      nextRedeemAt: typeof data?.nextRedeemAt === 'string' ? data.nextRedeemAt : '',
      error: data?.error || `The node refused the redemption (${res.status}).`,
      retryAfterMs: typeof data?.retryAfterMs === 'number' ? data.retryAfterMs : undefined,
    }
  }
  return {
    ok: true,
    grantedG: Number(data.grantedG) || 0,
    shardsSpent: Number(data.shardsSpent) || 0,
    balance: Number(data.balance) || 0,
    remaining24h: Number(data.remaining24h) || 0,
    nextRedeemAt: typeof data.nextRedeemAt === 'string' ? data.nextRedeemAt : '',
    replayed: data.replayed === true,
  }
}
