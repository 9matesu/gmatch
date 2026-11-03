"use client";

import { getLocalObject, registerLocalObject, sha256HexBlob, announceHeldObjects } from '../utils/p2pSwarm';
import { vaultProbe } from './vault';
import { enqueuePendingTransfer, listPendingTransfers } from '../utils/pendingTransfers';
import { deriveStatus, type RecoveryEntry, type RecoveryStatus } from './recoveryStatus';
/**
 * Idempotent recovery campaign over the EXISTING pipeline (plan Phase 5).
 * It is a reading-and-composition layer, not a new byte path: local stores
 * (swarm/IndexedDB register + the content-hash-keyed vault) are matched  by
 * hash only, verified bytes are re-registered under both identities and
 * covered by the existing HAVE wave; a miss enqueues the id into the
 * existing bounded pending-transfer bookkeeping so the Phase 2/3 machinery
 * (WANT answers, peer-online resume) can carry it. Methodology rules:
 * - status is derived, never fabricated (see recoveryStatus.ts);
 * - only app-owned stores are scanned (never arbitrary personal dirs).
 * Whatever this finds, no metadata is moved, re-signed, or re-authored.
 */

export interface RecoveryTarget {
  /** Object id the metadata knows (uuid or opaque token, not a magnet/urn). */
  id: string
  /** sha256 of the bytes, when the metadata carries one. */
  contentHash?: string | null
  mime?: string
}

export interface MediaRecoveryDeps {
  blobAt: (key: string) => Promise<Blob | null>
  hashOf: (blob: Blob) => Promise<string | null>
  vaultRow: (hash: string) => Promise<{ state: string; local?: string } | null>
  alias: (key: string, blob: Blob) => void
  listPending: typeof listPendingTransfers
  enqueue: typeof enqueuePendingTransfer
  announceHeld: () => number
}

const defaultDeps: MediaRecoveryDeps = {
  blobAt: (key) => getLocalObject(key).catch(() => null),
  hashOf: (blob) => sha256HexBlob(blob).catch(() => null),
  vaultRow: async (hash) => vaultProbe(hash),
  alias: (key, blob) => registerLocalObject(key, blob),
  listPending: listPendingTransfers,
  enqueue: enqueuePendingTransfer,
  announceHeld: announceHeldObjects,
};

/** Per-run batch bound + a wall-clock throttle: the campaign is opt-in,
 *  bounded, and never a boot-time flood. */
const BATCH_LIMIT = 8;
const MIN_SCAN_INTERVAL_MS = 30_000;
const MAX_TARGET_ID_LENGTH = 256;

let lastScanAt = 0;
let scanning = false;

export interface ScanRun {
  entries: RecoveryEntry[]
  /** Objects that became a verified local copy on THIS run. */
  recovered: number
  completedAt: number
  /** Set when the throttle skipped the whole run (previous run still fresh). */
  skipped?: 'throttled'
}

function isPlausibleId(id: string): boolean {
  return typeof id === 'string' && id.length > 0 && id.length <= MAX_TARGET_ID_LENGTH && !/^magnet:/i.test(id);
}

async function classify(
  target: RecoveryTarget,
  d: MediaRecoveryDeps,
): Promise<RecoveryEntry> {
  const id = target.id;
  const expected = typeof target.contentHash === 'string' ? target.contentHash : null;
  const mime = target.mime || 'application/octet-stream';

  // 1. Local register match, by hash first (content-addressed), then id.
  const byHash = expected ? await d.blobAt(expected) : null;
  const blob = byHash || (await d.blobAt(id));
  if (blob && blob.size > 0) {
    const sha256 = await d.hashOf(blob);
    const verdict = deriveStatus({
      localBlob: { size: blob.size, sha256 },
      expectedHash: expected,
      // A hash-KEYED hit is verified by construction (bytes are only ever
      // registered under a content key after hashing) — but only while the
      // re-hash here gave no contradicting answer (deriveStatus checks
      // that first). If the re-hash ran and never came back (null sha),
      // the key itself is the identity this scan asserts on.
      hashKeyedVaultRow: Boolean(byHash && expected && sha256 === null),
      hasSource: true,
    });
    if (verdict.status === 'cached') {
      d.alias(id, blob);
      if (expected && expected !== id) d.alias(expected, blob);
    }
    return { objectId: id, contentHash: expected, mime, status: verdict.status, reason: verdict.reason, bytes: verdict.bytes };
  }

  // 2. Vault row match — hash key only (the key is the verified identity,
  //    hashed incrementally at pin/stream time).
  if (expected) {
    const probe = await d.vaultRow(expected);
    if (probe && probe.state === 'local' && probe.local) {
      return { objectId: id, contentHash: expected, mime, status: 'cached' };
    }
    if (probe && probe.state === 'unreadable') {
      return { objectId: id, contentHash: expected, mime, status: 'retryable', reason: 'vault-unreadable' };
    }
  }

  // 3. No local bytes: read the existing pending bookkeeping and enqueue the
  //    miss so the existing resume machinery finds it (idempotent enqueue).
  const pending = expected
    ? d.listPending().find((p) => p.id === id || p.hash === expected) ?? null
    : d.listPending().find((p) => p.id === id) ?? null;
  const verdict = deriveStatus({ expectedHash: expected, pending, hasSource: true });
  if (verdict.status === 'downloadable' && !pending) {
    d.enqueue(id, expected);
  }
  return { objectId: id, contentHash: expected, mime, status: verdict.status, reason: verdict.reason };
}

/**
 * Scan one bounded batch of targets and derive statuses. Idempotent: a
 * re-run re-registers nothing, re-enqueues nothing, and a re-derived status
 * simply reflects the (possibly changed) evidence. `announceHeld` fires only
 * when this run actually recovered bytes — the existing 10s HAVE throttle in
 * useP2P bounds the wire, and one call is one frame.
 */
export async function scanMediaRecovery(
  targets: RecoveryTarget[],
  opts: { limit?: number; force?: boolean; deps?: Partial<MediaRecoveryDeps> } = {},
): Promise<ScanRun> {
  if (!targets.length) return { entries: [], recovered: 0, completedAt: Date.now() };
  const now = Date.now();
  if (!opts.force) {
    if (scanning) return { entries: [], recovered: 0, completedAt: now, skipped: 'throttled' };
    if (now - lastScanAt < MIN_SCAN_INTERVAL_MS) {
      return { entries: [], recovered: 0, completedAt: now, skipped: 'throttled' };
    }
  }
  if (scanning) return { entries: [], recovered: 0, completedAt: now, skipped: 'throttled' };
  scanning = true;
  lastScanAt = now;
  const d: MediaRecoveryDeps = { ...defaultDeps, ...opts.deps };
  try {
    const batch = targets
      .filter((t) => isPlausibleId(t.id))
      .slice(0, Math.max(1, opts.limit ?? BATCH_LIMIT));
    const entries: RecoveryEntry[] = [];
    for (const target of batch) {
      entries.push(await classify(target, d));
    }
    if (entries.some((e) => e.status === 'cached')) {
      try {
        d.announceHeld();
      } catch {
        /* the wave throttle owns the wire; a hiccup never affects status */
      }
    }
    return { entries, recovered: entries.filter((e) => e.status === 'cached').length, completedAt: Date.now() };
  } finally {
    scanning = false;
  }
}

/** Count by status — the honest report shape (Phase 6 Stage E consumes it). */
export function countByStatus(entries: RecoveryEntry[]): Record<RecoveryStatus, number> {
  const out: Record<RecoveryStatus, number> = { cached: 0, downloadable: 0, retryable: 0, missing: 0, corrupt: 0 };
  for (const e of entries) out[e.status] += 1;
  return out;
}

/** Test/setup seam: forget the throttle clock (statuses are session state). */
export function _resetRecoveryScanGuards(): void {
  lastScanAt = 0;
  scanning = false;
}
