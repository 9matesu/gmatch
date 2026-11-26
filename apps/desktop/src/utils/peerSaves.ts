"use client";

/**
 * Durable, identity-scoped bookmarks for posts read from a PEER.
 *
 * A node post's save is a node row: `POST /api/posts/:id/save` writes `Saves`,
 * and the profile's Saved tab reads it back with `?saved=1`. A peer-replicated
 * post has no `Objects` row at all, so the node answers that same call with
 * `404 Post not found` — the save used to be dropped in silence, `is_saved`
 * stayed false, and the bookmark did not survive a reload.
 *
 * The save therefore lives HERE, and it is deliberately LOCAL. A bookmark is
 * the reader's private intent with no shared signal; unlike a like (a public
 * count peers fold into the feed) it has no business being gossiped, so it is
 * not a signed operation. It is scoped per identity, so switching accounts on
 * one machine never shows the other's bookmarks.
 */
const KEY_PREFIX = 'gmatch_peer_saves_v1';

/** Raised on every write so a mounted projection re-reads without a reload. */
export const PEER_SAVES_CHANGED_EVENT = 'gmatch:peer-saves-changed';

function key(orbitId: string): string {
  return `${KEY_PREFIX}:${orbitId}`;
}

/** The ids this identity has bookmarked from peers, read from durable storage. */
export function readPeerSavedIds(orbitId: string | null | undefined): Set<string> {
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
  } catch { /* quota/private mode */ }
}

/**
 * Add or remove one bookmark. A no-op write does not raise the event, so the
 * projection is not asked to re-read for nothing.
 */
export function setPeerSaved(orbitId: string | null | undefined, postId: string, saved: boolean): void {
  if (!orbitId || !postId) return;
  const set = readPeerSavedIds(orbitId);
  if (saved === set.has(postId)) return;
  if (saved) set.add(postId);
  else set.delete(postId);
  write(orbitId, set);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(PEER_SAVES_CHANGED_EVENT));
}
