import type { FeedPost } from '../../components/feed/GMatchFeed'

/**
 * Durable snapshot of the last timeline this device read.
 *
 * The node is a local Bun sidecar that has to boot before it can answer, and a
 * packaged install can be offline entirely. Without this cache the timeline
 * said "Loading…" (or "This node hosts no feed") while the player had already
 * downloaded every row on this machine — the content was there, the SHELL was
 * what was missing.
 *
 * Rules that keep it honest:
 *  - **Never the authority.** A snapshot is a stale read. The controller still
 *    revalidates against the node and replaces it the moment a fresh one lands.
 *  - **Scoped per identity.** Another player on the same PC must not inherit
 *    this one's feed (same rule as `utils/scopedSeen.ts`).
 *  - **Bounded.** A fixed number of rows, so a big feed cannot grow the value
 *    without limit.
 *  - **Best-effort.** Quota/private-mode failures are a cache miss, never an
 *    error the player sees.
 */

const KEY = 'gmatch.feed.snapshot.v1'

/** Rows kept. Enough to fill several screens; small enough to stay cheap. */
const MAX_ROWS = 200

/** Age past which a snapshot is only shown as a labelled fallback. */
export const SNAPSHOT_STALE_MS = 10 * 60_000

export interface FeedSnapshot {
  posts: FeedPost[]
  /** Epoch ms the snapshot was written. */
  at: number
}

function scopedKey(orbitId: string): string {
  return `${KEY}:${orbitId}`
}

function read(orbitId: string): FeedSnapshot | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(scopedKey(orbitId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as { posts?: unknown; at?: unknown }
    if (!Array.isArray(parsed.posts)) return null
    const at = typeof parsed.at === 'number' && Number.isFinite(parsed.at) ? parsed.at : 0
    return { posts: parsed.posts.slice(0, MAX_ROWS) as FeedPost[], at }
  } catch {
    return null
  }
}

/** Read the cached timeline for this identity. Null when nothing is cached. */
export function readCachedFeed(orbitId: string | null | undefined): FeedSnapshot | null {
  if (!orbitId) return null
  return read(orbitId)
}

/** Persist a timeline. Replaces the previous one; never appends. */
export function writeCachedFeed(orbitId: string | null | undefined, posts: readonly FeedPost[]): void {
  if (!orbitId || posts.length === 0) return
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(scopedKey(orbitId), JSON.stringify({
      posts: posts.slice(0, MAX_ROWS),
      at: Date.now(),
    }))
  } catch {
    /* quota / private mode: the live read still works */
  }
}

/** Drop the cached timeline (identity switch / sign-out). */
export function clearCachedFeed(orbitId: string | null | undefined): void {
  if (!orbitId) return
  try {
    localStorage.removeItem(scopedKey(orbitId))
  } catch {
    /* nothing to clear */
  }
}

/** True when a snapshot is old enough that the UI should label it. */
export function isStaleSnapshot(snapshot: FeedSnapshot | null, now = Date.now()): boolean {
  if (!snapshot) return false
  return now - snapshot.at > SNAPSHOT_STALE_MS
}