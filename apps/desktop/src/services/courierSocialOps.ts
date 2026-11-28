import { sha256Hex } from '@orbit/protocol'
import { getCentralApiUrl } from '../utils/central'
import { OPERATION_LOG_CHANGED_EVENT, type SocialOperationLog } from './socialOperationLog'
import { acceptInboundOperation } from './socialOpTransport'

/**
 * Signed social-operation path through the FREE rendezvous (docs/SPEC §12b).
 *
 * Operations already cross the direct mesh and a node's SWARM_FRAME relay. Two
 * installs on different nodes with no reachable node and no TURN could see each
 * other and DM but never exchanged a post: this is an ADDITIONAL path, not a
 * replacement. The Worker stores the very same `announce` envelope presence
 * uses, under a well-known public token, for ~120s. It cannot read, rewrite or
 * authenticate anything inside: every op is re-validated by the existing
 * authorizer before it reaches the durable log.
 *
 * shortcut: one PUT per op per session and a ~2min box, so a peer arriving much
 * later still relies on the mesh/node relay and the log's boot wave; upgrade
 * only if a durable cross-node op log is ever required.
 */
export const OPS_TOKEN = sha256Hex(new TextEncoder().encode('orbit-global-social-ops-v1'))
export const SOCIAL_OPS_TTL_MS = 120_000
export const SOCIAL_OPS_DRAIN_MS = 60_000

function randomHex(bytesLen: number): string {
  const bytes = new Uint8Array(bytesLen)
  crypto.getRandomValues(bytes)
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

/**
 * Hand each NEW self-authored, not-yet-delivered operation to the hosted box.
 * `publishedIds` is a session-scoped claim: a burst of log-change events cannot
 * PUT the same op twice, and an undelivered op is not re-sent on every tick.
 * A failed PUT releases the claim so a later commit wave can retry it.
 */
export async function publishSocialOpsToMailbox(
  log: SocialOperationLog,
  selfId: string,
  publishedIds: Set<string>,
  base: string,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<number> {
  const trimmed = base.replace(/\/+$/, '')
  if (!trimmed || !selfId) return 0
  let entries
  try {
    entries = await log.listAllOperations()
  } catch {
    return 0
  }
  let sent = 0
  for (const entry of entries) {
    if (entry.actorId !== selfId || entry.status === 'delivered' || publishedIds.has(entry.operationId)) continue
    publishedIds.add(entry.operationId)
    try {
      const envelope = {
        v: 2,
        kind: 'announce',
        to: OPS_TOKEN,
        id: randomHex(16),
        sealed: btoa(unescape(encodeURIComponent(JSON.stringify({ op: entry.record })))),
        exp: Date.now() + SOCIAL_OPS_TTL_MS,
      }
      const res = await fetchImpl(`${trimmed}/api/mail/${OPS_TOKEN}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ env: envelope }),
      })
      if (res.ok) sent++
      else publishedIds.delete(entry.operationId)
    } catch {
      publishedIds.delete(entry.operationId)
      /* best effort: the mesh/node paths still carry the operation */
    }
  }
  return sent
}

export interface SocialOpsDrain {
  accepted: number
  duplicate: number
  rejected: number
}

/**
 * Read the public box and feed every op through the SAME apply path SWARM_OP
 * uses (`acceptInboundOperation` validates signature, manifest, chain and
 * dedupes by operation id). Envelopes are NOT deleted: an out-of-order chain
 * needs the next drain to see its predecessor, and the Worker's TTL bounds the
 * replay window.
 */
export async function drainSocialOpsFromMailbox(
  log: SocialOperationLog,
  selfId: string,
  base: string,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<SocialOpsDrain> {
  const result: SocialOpsDrain = { accepted: 0, duplicate: 0, rejected: 0 }
  const trimmed = base.replace(/\/+$/, '')
  if (!trimmed || !selfId) return result
  try {
    const res = await fetchImpl(`${trimmed}/api/mail/${OPS_TOKEN}`, { method: 'GET' })
    if (!res.ok) return result
    const data = await res.json().catch(() => null) as { envelopes?: unknown[] } | null
    if (!data || !Array.isArray(data.envelopes)) return result
    for (const raw of data.envelopes) {
      if (!raw || typeof raw !== 'object') continue
      const env = raw as Record<string, unknown>
      if (env.v !== 2 || env.kind !== 'announce' || env.to !== OPS_TOKEN || typeof env.sealed !== 'string') continue
      let op: unknown
      try {
        const decoded = JSON.parse(decodeURIComponent(escape(atob(env.sealed)))) as { op?: unknown } | null
        op = decoded?.op
      } catch {
        continue
      }
      if (!op || typeof op !== 'object') continue
      const actorId = (op as { actorId?: unknown }).actorId
      if (typeof actorId !== 'string' || !actorId || actorId === selfId) continue
      result[await acceptInboundOperation(log, op)]++
    }
  } catch {
    /* unreachable rendezvous: never block the existing transports */
  }
  return result
}

export interface CourierSocialOpsOptions {
  log: SocialOperationLog
  selfId: string
  /** Rendezvous origin. Defaults to the configured central Worker. */
  base?: string
  fetchImpl?: typeof globalThis.fetch
  target?: EventTarget | null
  drainIntervalMs?: number
}

/**
 * Wire publish-on-commit, boot drain and a bounded periodic drain. Returns the
 * teardown (the P2P hook calls it on unmount / identity change).
 */
export function wireCourierSocialOps(options: CourierSocialOpsOptions): () => void {
  if (!options.selfId) return () => {}
  const base = options.base ?? getCentralApiUrl()
  if (!base.replace(/\/+$/, '')) return () => {}
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const publishedIds = new Set<string>()
  const publish = () => {
    void publishSocialOpsToMailbox(options.log, options.selfId, publishedIds, base, fetchImpl).catch(() => {})
  }
  const drain = () => {
    void drainSocialOpsFromMailbox(options.log, options.selfId, base, fetchImpl).catch(() => {})
  }
  const target = options.target === undefined
    ? (typeof window !== 'undefined' ? window : null)
    : options.target
  if (target) target.addEventListener(OPERATION_LOG_CHANGED_EVENT, publish)
  drain()
  const timer = setInterval(drain, options.drainIntervalMs ?? SOCIAL_OPS_DRAIN_MS)
  return () => {
    clearInterval(timer)
    if (target) target.removeEventListener(OPERATION_LOG_CHANGED_EVENT, publish)
  }
}
