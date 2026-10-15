"use client";

import { orbitFetch, type OrbitIdentityLike } from '../utils/api';
import { gossipOwnPost, type GossipPostInput } from './gossip';

export const OUTBOX_KEY = 'gmatch_post_outbox_v1';

export type OutboxState = 'local' | 'pending' | 'replicated';

export interface PostOutboxEntry {
  objectId: string;
  postGroup: string | null;
  registerBody: Record<string, unknown>;
  /** Null for non-gossipable rows (stories, chats, avatars, private). */
  gossipInput: GossipPostInput | null;
  state: OutboxState;
  attempts: number;
  createdAt: number;
  updatedAt: number;
}

function readAll(): PostOutboxEntry[] {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(OUTBOX_KEY) : null;
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((e) => e && typeof e.objectId === 'string') : [];
  } catch {
    return [];
  }
}

function writeAll(list: PostOutboxEntry[]): void {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(list));
  } catch { /* quota/private mode: outbox degrades to memory-only no-op */ }
  notifyChanged();
}

/** UI signal: outbox advanced/failed. Listeners recompute tile badges. */
function notifyChanged(): void {
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('gmatch:post-outbox-changed'));
    }
  } catch { /* SSR/tests */ }
}

const rank: Record<OutboxState, number> = { local: 0, pending: 1, replicated: 2 };

export function listOutbox(): PostOutboxEntry[] {
  return readAll().sort((a, b) => a.createdAt - b.createdAt);
}

/** Enqueue (or refresh payload of) an entry. Never downgrades an entry that
 *  already progressed — a re-forge of the same bytes resumes, not restarts. */
export function enqueueOutbox(entry: {
  objectId: string;
  postGroup?: string | null;
  registerBody: Record<string, unknown>;
  gossipInput?: GossipPostInput | null;
}): PostOutboxEntry {
  const list = readAll();
  const now = Date.now();
  const found = list.find((e) => e.objectId === entry.objectId);
  if (found) {
    found.registerBody = entry.registerBody;
    if (entry.gossipInput) found.gossipInput = entry.gossipInput;
    if (entry.postGroup) found.postGroup = entry.postGroup;
    found.updatedAt = now;
    writeAll(list);
    return found;
  }
  const created: PostOutboxEntry = {
    objectId: entry.objectId,
    postGroup: entry.postGroup ?? null,
    registerBody: entry.registerBody,
    gossipInput: entry.gossipInput ?? null,
    state: 'local',
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  };
  list.push(created);
  writeAll(list);
  return created;
}

export function setOutboxState(objectId: string, state: OutboxState): void {
  const list = readAll();
  const found = list.find((e) => e.objectId === objectId);
  if (!found) return;
  // Monotonic: states only advance (retries never move replicated backwards).
  if (rank[state] < rank[found.state]) return;
  found.state = state;
  found.updatedAt = Date.now();
  writeAll(list);
}

function bumpAttempts(objectId: string): void {
  const list = readAll();
  const found = list.find((e) => e.objectId === objectId);
  if (!found) return;
  found.attempts += 1;
  found.updatedAt = Date.now();
  writeAll(list);
}

export function removeOutbox(objectId: string): void {
  writeAll(readAll().filter((e) => e.objectId !== objectId));
}

/** Worst (least-progressed) state per post group: the optimistic feed tile
 *  keys on postGroup, and every media row in a multi-post shares one state. */
export function outboxStatesByGroup(): Record<string, OutboxState> {
  const out: Record<string, OutboxState> = {};
  for (const e of readAll()) {
    const key = e.postGroup || e.objectId;
    const cur = out[key];
    if (!cur || rank[e.state] < rank[cur]) out[key] = e.state;
  }
  return out;
}

/** Drop replicated entries past the grace window (server rows authoritative).
 *  Default grace keeps the stub visible until reconciliation refreshes. */
export function pruneOutbox(graceMs = 5 * 60_000, now = Date.now()): void {
  writeAll(readAll().filter((e) => !(e.state === 'replicated' && now - e.updatedAt > graceMs)));
}

export interface FlushDeps {
  postRegister: (body: Record<string, unknown>) => Promise<{ ok: boolean; terminal?: boolean }>;
  postGossip: (input: GossipPostInput) => Promise<boolean>;
}

async function defaultRegister(
  identity: OrbitIdentityLike,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; terminal?: boolean }> {
  try {
    const res = await orbitFetch('/api/objects/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, identity);
    if (res.ok) return { ok: true };
    // 409 = id squatted by another owner: retrying can never succeed.
    if (res.status === 409) return { ok: false, terminal: true };
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

/**
 * Retry driver (Phase 3b). Advances every non-replicated entry one step:
 * local entries attempt metadata registration, pending entries attempt
 * gossip (or complete immediately when non-gossipable). Safe to call on
 * boot, reconnect, and after every publish — retries reuse the client's own
 * objectId, so the server dedupes instead of duplicating.
 */
export async function flushPostOutbox(
  identity: OrbitIdentityLike,
  deps?: Partial<FlushDeps>,
): Promise<{ registered: number; replicated: number; failed: number }> {
  const postRegister = deps?.postRegister ?? ((body) => defaultRegister(identity, body));
  const postGossip = deps?.postGossip ?? ((input) => gossipOwnPost(identity, input));
  const summary = { registered: 0, replicated: 0, failed: 0 };
  for (const entry of listOutbox()) {
    if (entry.state === 'replicated') continue;
    if (entry.state === 'local') {
      const r = await postRegister(entry.registerBody);
      if (r.ok) {
        summary.registered += 1;
        if (entry.gossipInput) {
          setOutboxState(entry.objectId, 'pending');
        } else {
          setOutboxState(entry.objectId, 'replicated');
          summary.replicated += 1;
        }
      } else if (r.terminal) {
        removeOutbox(entry.objectId);
        summary.failed += 1;
      } else {
        bumpAttempts(entry.objectId);
        summary.failed += 1;
      }
      continue;
    }
    // pending
    if (!entry.gossipInput) {
      setOutboxState(entry.objectId, 'replicated');
      summary.replicated += 1;
      continue;
    }
    try {
      if (await postGossip(entry.gossipInput)) {
        setOutboxState(entry.objectId, 'replicated');
        summary.replicated += 1;
      } else {
        bumpAttempts(entry.objectId);
        summary.failed += 1;
      }
    } catch {
      bumpAttempts(entry.objectId);
      summary.failed += 1;
    }
  }
  pruneOutbox();
  return summary;
}
