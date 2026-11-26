"use client";

/**
 * Durable, identity-scoped read state for the PEER notification lane.
 *
 * The notification centre has three lanes: server rows (a node `Notifications`
 * table, whose `read` flag the node persists), courier rows (DMs/rooms, read via
 * the chat `seen` stamps), and peer rows (signed operations about MY content —
 * a report, and soon a follow/like/comment). A peer row has no node row and no
 * chat stamp, so nothing persisted whether the player had read it.
 *
 * The consequence was worse than a cosmetic gap: a peer report counted toward
 * the unread badge forever (its row is derived from the operation log, which
 * never changes when you merely look at it), so the badge could never clear.
 *
 * The read state therefore lives here — durable and scoped per identity, keyed
 * by the operation id that produced the row, so switching accounts on one
 * machine never shows the other's read state.
 */
const KEY_PREFIX = 'gmatch_peer_notifications_read_v1';

/** Raised on every real write so a mounted centre re-reads without a reload. */
export const PEER_NOTIFICATIONS_CHANGED_EVENT = 'gmatch:peer-notifications-changed';

function key(orbitId: string): string {
  return `${KEY_PREFIX}:${orbitId}`;
}

/** The peer-notification operation ids this identity has already read. */
export function readPeerNotificationReads(orbitId: string | null | undefined): Set<string> {
  if (!orbitId) return new Set();
  try {
    if (typeof localStorage === 'undefined') return new Set();
    const raw = localStorage.getItem(key(orbitId));
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function write(orbitId: string, set: Set<string>): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key(orbitId), JSON.stringify([...set]));
  } catch {
    /* quota/private mode: read state stays session-only, never fabricated */
  }
}

/**
 * Mark peer rows read. A no-op (the ids were already read) does not raise the
 * event, so the centre is not asked to re-read for nothing.
 */
export function markPeerNotificationsRead(
  orbitId: string | null | undefined,
  operationIds: readonly string[],
): void {
  if (!orbitId) return;
  const ids = operationIds.filter((id) => typeof id === 'string' && id);
  if (ids.length === 0) return;
  const set = readPeerNotificationReads(orbitId);
  let changed = false;
  for (const id of ids) {
    if (!set.has(id)) {
      set.add(id);
      changed = true;
    }
  }
  if (!changed) return;
  write(orbitId, set);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(PEER_NOTIFICATIONS_CHANGED_EVENT));
}
