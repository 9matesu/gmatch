"use client";

/**
 * Durable pending P2P transfers (Phase 4). When a swarm fetch fails because
 * the seeder is offline, the object id (+ its content hash) is persisted so a
 * later boot or peer-online event can resume the transfer — the notification
 * is not proof the bytes arrived, and a disconnected peer retries later.
 * Bytes are only accepted after hash verification (see p2pSwarm).
 */

export const PENDING_TRANSFERS_KEY = 'gmatch_pending_transfers_v1';
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

/**
 * Re-issue WANTs for every persisted transfer. `resolve` is injectable for
 * tests; production passes a hash-verifying swarm fetch. A transfer that
 * resolves is removed; a failure keeps it queued for the next reconnect.
 */
export async function resumePendingTransfers(
  resolve: (id: string, hash: string | null) => Promise<unknown>,
): Promise<ResumeResult> {
  const list = readAll();
  let resolved = 0;
  for (const entry of list) {
    try {
      await resolve(entry.id, entry.hash);
      removePendingTransfer(entry.id);
      resolved += 1;
    } catch {
      const fresh = readAll();
      const found = fresh.find((e) => e.id === entry.id);
      if (found) {
        found.attempts += 1;
        writeAll(fresh);
      }
    }
  }
  return { resolved, stillPending: listPendingTransfers().length };
}
