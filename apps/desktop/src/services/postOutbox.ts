"use client";

import { orbitFetch, type OrbitIdentityLike } from '../utils/api';
import { gossipOwnPost, type GossipPostInput } from './gossip';
import { isPostDeleted } from '../utils/deletedPosts';

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

/**
 * Sync the local outbox copy of a post with an edited caption.
 *
 * The outbox copy is what the tile renders BEFORE the node echoes the post
 * back, and a pending re-register would push its `registerBody` to the node.
 * After the author edits the caption on the node, the local copy still carries
 * the old text — so the pre-echo window showed the old caption and a
 * re-register could push it back. Returns false when the object was never
 * outboxed (a post published elsewhere).
 */
export function updateOutboxCaption(objectId: string, caption: string): boolean {
  const list = readAll();
  const found = list.find((e) => e.objectId === objectId);
  if (!found) return false;
  const body = { ...(found.registerBody || {}) };
  body.caption = caption;
  body.post_caption = caption;
  found.registerBody = body;
  found.updatedAt = Date.now();
  writeAll(list);
  return true;
}

/**
 * Remove one object from the outbox and report what it was.
 *
 * Deleting a post that only exists locally (a publish that never reached the
 * node, or an offline compose) must not send a DELETE to the node: there is no
 * row there, so the request could only 404. This is the one place that knows
 * whether a post is local-only, so the delete path asks it instead of guessing.
 *
 * Returns null when the object was not in the outbox at all.
 */
export function removeOutboxEntry(objectId: string): PostOutboxEntry | null {
  const list = readAll()
  const found = list.find((e) => e.objectId === objectId)
  if (!found) return null
  writeAll(list.filter((e) => e.objectId !== objectId))
  return found
}

export function setOutboxState(objectId: string, state: OutboxState, force = false): void {
  const list = readAll();
  const found = list.find((e) => e.objectId === objectId);
  if (!found) return;
  // Monotonic: states only advance (retries never move replicated backwards).
  // `force` is the one exception: a re-arm deliberately moves a replicated entry
  // back to pending when the current node does not hold the object.
  if (!force && rank[state] < rank[found.state]) return;
  found.state = state;
  found.updatedAt = Date.now();
  writeAll(list);
}

/** Ids already re-armed this session (a re-arm costs one node probe each). */
const rearmChecked = new Set<string>();

/**
 * Re-arm replicated entries whose object is NOT on the current node.
 *
 * A post replicated to a retired host (the old `fly.dev`) is marked `replicated`
 * and `flushPostOutbox` skips it forever — so it never reaches THIS node and the
 * timeline never shows it. Probe the current node once per entry; a 404 means the
 * row is not here, so move it back to `pending` and let the normal flush register
 * it locally. Bounded and session-idempotent.
 */
export async function rearmMissingReplicated(
  identity: OrbitIdentityLike,
  max = 50,
): Promise<void> {
  for (const e of listOutbox()) {
    if (rearmChecked.size >= max) break;
    if (e.state !== 'replicated' || rearmChecked.has(e.objectId)) continue;
    if (isPostDeleted(e.objectId)) continue; // tombstoned: never re-register
    rearmChecked.add(e.objectId);
    try {
      const res = await orbitFetch(`/api/objects/${e.objectId}`, {}, identity);
      // A row can exist on the node and still deliver no picture: the node
      // answers 200 with a `p2p` descriptor when it holds no bytes. That row is
      // just as undelivered as a 404, and the outbox copy may still carry the
      // attached bytes (`data_base64`) the first register failed to store.
      // Treat both as "this node has nothing for me" and send the entry back to
      // `local` (not `pending`): `pending` means "already registered", so the
      // flush would only re-stamp it replicated without ever registering here.
      let missing = res.status === 404
      if (res.ok && !missing) {
        try {
          const ct = typeof res.headers?.get === 'function' ? (res.headers.get('content-type') || '') : ''
          if (!ct || /json/i.test(ct)) {
            const data = await res.json().catch(() => null)
            if (data && typeof data === 'object' && (data as { type?: unknown }).type === 'p2p') missing = true
          }
        } catch {
          /* a body we cannot read is not proof of missing bytes */
        }
      }
      if (missing) setOutboxState(e.objectId, 'local', true);
    } catch {
      /* node unreachable: leave it replicated, retry on the next boot */
    }
  }
}

function bumpAttempts(objectId: string): void {
  const list = readAll();
  const found = list.find((e) => e.objectId === objectId);
  if (!found) return;
  found.attempts += 1;
  found.updatedAt = Date.now();
  writeAll(list);
}

function removeOutbox(objectId: string): void {
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
/** Drop replicated entries past the grace window. The server row is authoritative,
 *  but the local mirror is what re-registers the post if the node loses it, so
 *  the window is a day (the entry is a few hundred bytes) instead of 5 min. */
export function pruneOutbox(graceMs = 24 * 60 * 60_000, now = Date.now()): void {
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
