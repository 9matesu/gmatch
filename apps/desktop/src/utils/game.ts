import type { LikeDecision } from '@orbit/shared'

/**
 * Pure game logic helpers extracted from useGame.ts / page.tsx so the
 * queue/spin/decision rules are unit-testable (see game.test.ts).
 */

interface QueueItem {
  id: string
  owner_id?: string
  is_story?: number
}

/** True for locally-synced p2p-only objects (never shared with the server). */
export function isP2pLocal(id: string): boolean {
  return typeof id === 'string' && id.startsWith('p2p-obj-')
}

/** Should a newly received item be enqueued for a decision? (T-U6) */
export function shouldEnqueue(
  item: QueueItem,
  decisions: Record<string, LikeDecision>,
  selfId: string
): boolean {
  if (!item || !item.id) return false
  if (isP2pLocal(item.id)) return false
  if (item.owner_id === selfId) return false
  if (item.is_story) return false
  if (decisions[item.id]) return false
  return true
}

/** Append an item to the decision queue, never duplicating by id. (F-C1) */
export function dedupeQueue<T extends QueueItem>(queue: T[], item: T): T[] {
  if (!item || !item.id) return queue
  if (queue.some(i => i.id === item.id)) return queue
  return [...queue, item]
}

/** Remove an item by id, or shift the head when no id is given. (T-U1) */
export function dismissFromQueue<T extends QueueItem>(queue: T[], objectId?: string): T[] {
  if (!objectId) return queue.length > 0 ? queue.slice(1) : queue
  return queue.filter(i => i.id !== objectId)
}

/** True only when the server confirmed a brand-new pair match. */
export function isNewMatch(matched: boolean | undefined, matches: number | undefined): boolean {
  return Boolean(matched) && (matches ?? 0) >= 1
}

export interface SpinPick {
  target: QueueItem | null
  nextHistory: string[]
}

/**
 * Pick a random spin candidate, excluding self and blocked users, preferring
 * users not seen in recent history, and keeping history capped at 10.
 * Returns null when no eligible candidates exist.
 */
export function spinPick(
  pool: QueueItem[],
  selfId: string,
  blockedIds: string[],
  history: string[] = []
): SpinPick {
  const blocked = new Set(blockedIds)
  const eligible = pool.filter(u => u.id !== selfId && !blocked.has(u.id))
  if (eligible.length === 0) return { target: null, nextHistory: history }

  const seen = new Set(history)
  let candidates = eligible.filter(u => !seen.has(u.id))
  if (candidates.length === 0) candidates = eligible

  const target = candidates[Math.floor(Math.random() * candidates.length)]
  const nextHistory = [target.id, ...history.filter(id => id !== target.id)].slice(0, 10)

  return { target, nextHistory }
}

/**
 * Record a local decision ONLY when the server confirmed it (a valid
 * `like`/`reject`/`pass` decision was echoed back). Failed / offline-fallback
 * attempts return null and must not be persisted so the item can be retried.
 * (T-U2 / F-B4)
 */
export function recordDecision(
  map: Record<string, LikeDecision>,
  objectId: string,
  decision: LikeDecision,
  serverResult: { decision?: string } | null | undefined
): Record<string, LikeDecision> {
  if (!isConfirmedDecision(serverResult?.decision)) return map
  return { ...map, [objectId]: decision }
}

/** True only when the server echoed a real decision back (not a mock fallback). */
export function isConfirmedDecision(value: unknown): value is LikeDecision {
  return value === 'like' || value === 'reject' || value === 'pass'
}

/**
 * Merge a decision map broadcast from another tab (via the `storage` event)
 * into the local map. Local decisions are always preserved; new entries from
 * the other tab are added. (F-C1)
 */
export function mergeLocalDecisions(
  local: Record<string, LikeDecision>,
  incoming: Record<string, LikeDecision> | null | undefined
): Record<string, LikeDecision> {
  if (!incoming) return local
  return { ...local, ...incoming }
}

/**
 * Cap the decision map to the most recent `max` entries (by insertion order),
 * pruning the oldest objectIds so `goonorbit-decisions` cannot grow unbounded.
 * (F-U8)
 */
export function pruneDecisionMap(
  map: Record<string, LikeDecision>,
  max: number
): Record<string, LikeDecision> {
  const keys = Object.keys(map)
  if (keys.length <= max) return map
  const pruned: Record<string, LikeDecision> = {}
  for (let i = keys.length - max; i < keys.length; i++) {
    pruned[keys[i]] = map[keys[i]]
  }
  return pruned
}

/**
 * Subset of freshly-received items that should be enqueued for a decision:
 * excludes stories, own items, already-decided items, and items this tab has
 * already notified/enqueued. Used by the server-inbox load path to match the
 * p2p sync path. (F-U7)
 */
export function enqueueableItems<T extends QueueItem>(
  items: T[],
  decisions: Record<string, LikeDecision>,
  selfId: string,
  alreadyNotified: Set<string> | string[]
): T[] {
  const notified = alreadyNotified instanceof Set ? alreadyNotified : new Set(alreadyNotified)
  return items.filter(item => !notified.has(item.id) && shouldEnqueue(item, decisions, selfId))
}
