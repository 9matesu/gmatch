"use client";

/**
 * Durable tombstones for deleted posts.
 *
 * A post can be deleted while its row still lives on a node (a 503/timeout, or
 * a replica that has not heard the tombstone yet). Without a tombstone the next
 * snapshot re-adds it and the outbox re-arm can re-register it — "deleted posts
 * come back on reload". The id is remembered here and every read path drops it.
 */
const KEY = 'gmatch_deleted_posts_v1';

function read(): Set<string> {
  try {
    if (typeof localStorage === 'undefined') return new Set();
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function write(set: Set<string>): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(KEY, JSON.stringify([...set]));
  } catch { /* quota/private mode */ }
}

export function isPostDeleted(id: string): boolean {
  return !!id && read().has(id);
}

export function tombstonePost(id: string): void {
  if (!id) return;
  const set = read();
  if (set.has(id)) return;
  set.add(id);
  write(set);
}

export function filterDeleted<T extends { id?: string }>(rows: T[]): T[] {
  const dead = read();
  if (dead.size === 0) return rows;
  return rows.filter((r) => !r.id || !dead.has(r.id));
}