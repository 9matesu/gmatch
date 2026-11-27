"use client";

/**
 * Durable pending P2P transfers (Phase 4). When a swarm fetch fails because
 * the seeder is offline, the object id (+ its content hash) is persisted so a
 * later boot or peer-online event can resume the transfer — the notification
 * is not proof the bytes arrived, and a disconnected peer retries later.
 * Bytes are only accepted after hash verification (see p2pSwarm).
 */

const PENDING_TRANSFERS_KEY = 'gmatch_pending_transfers_v1';
const MAX_PENDING_TRANSFERS = 128
const MAX_TRANSFER_ID_LENGTH = 256
const MAX_ATTEMPTS = 1000

export interface PendingTransfer {
  id: string;
  hash: string | null;
  attempts: number;
  addedAt: number;
}

function readAll(): PendingTransfer[] {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(PENDING_TRANSFERS_KEY) : null;
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list
      .filter((e) => e && typeof e.id === 'string' && e.id.length > 0 && e.id.length <= MAX_TRANSFER_ID_LENGTH)
      .slice(-MAX_PENDING_TRANSFERS)
      .map((e) => ({
        id: e.id,
        hash: typeof e.hash === 'string' && /^[a-f\d]{64}$/i.test(e.hash) ? e.hash : null,
        attempts: Number.isSafeInteger(e.attempts) && e.attempts >= 0 ? Math.min(e.attempts, MAX_ATTEMPTS) : 0,
        addedAt: Number.isSafeInteger(e.addedAt) && e.addedAt > 0 ? e.addedAt : Date.now(),
      })) : [];
  } catch {
    return [];
  }
}

function writeAll(list: PendingTransfer[]): void {
  try {
    localStorage.setItem(PENDING_TRANSFERS_KEY, JSON.stringify(list));
  } catch { /* quota/private mode: degrades to no-op */ }
}

export function listPendingTransfers(): PendingTransfer[] {
  return readAll().sort((a, b) => a.addedAt - b.addedAt);
}

export function enqueuePendingTransfer(id: string, hash: string | null): void {
  if (!id || id.length > MAX_TRANSFER_ID_LENGTH || (hash !== null && !/^[a-f\d]{64}$/i.test(hash))) return;
  const list = readAll();
  if (list.some((e) => e.id === id)) return;
  if (list.length >= MAX_PENDING_TRANSFERS) list.shift();
  list.push({ id, hash: hash || null, attempts: 0, addedAt: Date.now() });
  writeAll(list);
}

export function removePendingTransfer(id: string): void {
  writeAll(readAll().filter((e) => e.id !== id));
}

export interface ResumeResult {
  resolved: number;
  stillPending: number;
}

/** How many transfers are chased at once. */
const RESUME_CONCURRENCY = 4;

/**
 * Re-issue WANTs for every persisted transfer. `resolve` is injectable for
 * tests; production passes a hash-verifying swarm fetch. A transfer that
 * resolves is removed; a failure keeps it queued for the next reconnect.
 *
 * The list is read ONCE, the fetches run at a bounded concurrency, and the
 * survivors are written ONCE. This used to walk the list strictly serially,
 * calling `resolve` one at a time — each with a 5 s swarm timeout, so 128
 * stuck entries could block a peer-online wave for ten minutes — and it
 * rewrote the WHOLE localStorage key after every single entry, twice on a
 * failure (once to bump the attempt counter, once to persist). Up to 256 full
 * rewrites of the same key for one resume.
 */
export async function resumePendingTransfers(
  resolve: (id: string, hash: string | null) => Promise<unknown>,
): Promise<ResumeResult> {
  const list = readAll();
  if (list.length === 0) return { resolved: 0, stillPending: 0 };

  const settled = new Map<string, 'resolved' | 'failed'>();
  let cursor = 0;

  const worker = async () => {
    while (cursor < list.length) {
      const entry = list[cursor++];
      try {
        await resolve(entry.id, entry.hash);
        settled.set(entry.id, 'resolved');
      } catch {
        settled.set(entry.id, 'failed');
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(RESUME_CONCURRENCY, list.length) }, worker),
  );

  // ONE write of the surviving list, with the attempt counters bumped.
  // The list is RE-READ here: an `enqueuePendingTransfer` that landed while
  // the fetches were in flight must survive the write (the old per-entry
  // removePendingTransfer re-read for exactly this reason).
  const resolvedIds = new Set(
    list.filter((entry) => settled.get(entry.id) === 'resolved').map((entry) => entry.id),
  );
  const failedIds = new Set(
    list.filter((entry) => settled.get(entry.id) === 'failed').map((entry) => entry.id),
  );
  const fresh = readAll().filter((entry) => !resolvedIds.has(entry.id));
  for (const entry of fresh) {
    if (failedIds.has(entry.id)) {
      entry.attempts = Math.min(entry.attempts + 1, MAX_ATTEMPTS);
    }
  }
  writeAll(fresh);

  return {
    resolved: resolvedIds.size,
    stillPending: fresh.length,
  };
}
