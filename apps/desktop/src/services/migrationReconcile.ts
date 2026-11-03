"use client";

import { durableCustodyHolders, SWARM_REPLICATION_TARGET } from '../utils/p2pSwarm';
import type { RecoveryEntry } from './recoveryStatus';

/**
 * Migration reconciliation (plan Phase 6, Stages D/E).
 *
 * Stage D — a durable `created_at` watermark cursor over the migration
 * manifest: each reconcile pass only takes targets NEWER than the cursor,
 * deduped by objectId (a repeated post is the same object, never a second
 * import) and bounded. Nothing here signs, re-authors or uploads anything:
 * this is a pure metadata reading layer the (out-of-repo, signed) manifest
 * importer composes — the graph of posts has already been imported once.
 *
 * Stage E — the verification table. Per object, one honest class derived
 * from the Phase 5 scan status and the Phase 3 replication receipts. The
 * report is the artifact: importing metadata is NEVER reported as media
 * migration.
 */

export const WATERMARK_KEY = 'gmatch_recovery_watermark_v1';

export interface ManifestTarget {
  id: string
  contentHash?: string | null
  mime?: string
  /** Manifest row time in epoch ms — the Stage D watermark. */
  createdAt?: number
}

export type StageEClass =
  | 'recovered+replicated'
  | 'recovered (under-replicated)'
  | 'metadata only'
  | 'corrupt'

export function readWatermark(): number {
  try {
    if (typeof localStorage === 'undefined') return 0;
    const raw = localStorage.getItem(WATERMARK_KEY);
    const ts = raw === null ? NaN : Number(raw);
    return Number.isSafeInteger(ts) && ts >= 0 ? ts : 0;
  } catch {
    return 0;
  }
}

/** Monotonic cursor: reconciliation never rewinds, so a stale manifest
 *  (or a re-import of old rows) can never re-watermark Newer work. */
export function saveWatermark(ts: number): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (!Number.isSafeInteger(ts) || ts < 0) return;
    if (ts <= readWatermark()) return;
    localStorage.setItem(WATERMARK_KEY, String(ts));
  } catch {
    /* quota/private mode: the next pass re-derives the same batch honestly */
  }
}

export interface ReconcileBatch {
  /** Deduped by objectId, ordered oldest→newest, bounded to `limit`. */
  batch: ManifestTarget[]
  /** The cursor the caller should persist AFTER handling this batch (the
   *  newest createdAt seen; unchanged when the batch is empty). */
  newCursor: number
}

/**
 * Stage D: the next slice of the manifest a reconcile pass should work on.
 * A target repeated with a newer timestamp is merged into its own row (same
 * objectId — metadata updates in place, never a second object).
 */
export function nextReconcileBatch(
  targets: ManifestTarget[],
  opts: { cursor?: number; limit?: number } = {},
): ReconcileBatch {
  const cursor = opts.cursor ?? readWatermark();
  const byId = new Map<string, ManifestTarget>();
  for (const t of targets) {
    if (!t || typeof t.id !== 'string' || !t.id) continue;
    if (typeof t.createdAt !== 'number' || !Number.isSafeInteger(t.createdAt) || t.createdAt <= cursor) continue;
    const existing = byId.get(t.id);
    if (!existing || (existing.createdAt ?? 0) < (t.createdAt ?? 0)) byId.set(t.id, t);
  }
  const batch = [...byId.values()]
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
    .slice(0, Math.max(1, opts.limit ?? 8));
  return { batch, newCursor: batch.length ? Math.max(...batch.map((t) => t.createdAt ?? 0)) : cursor };
}

/**
 * Stage E classification for ONE scanned object. `custodyHolders` counts
 * DISTINCT verified custody holders (Phase 3 receipts + this node's own
 * read-back-proven copy); `SWARM_REPLICATION_TARGET` (3) is the target.
 */
export function classifyStageE(
  entry: RecoveryEntry,
  custodyHolders: (id: string) => number = durableCustodyHolders,
): StageEClass {
  if (entry.status === 'corrupt') return 'corrupt';
  if (entry.status === 'cached') {
    return custodyHolders(entry.objectId) >= SWARM_REPLICATION_TARGET
      ? 'recovered+replicated'
      : 'recovered (under-replicated)';
  }
  // downloadable / retryable / missing: the bytes are not on this device,
  // whatever their provenance beyond. Metadata migration ≠ media migration.
  return 'metadata only';
}

export interface StageEReport {
  rows: Array<{ objectId: string; contentHash: string | null; mime: string; status: RecoveryEntry['status']; class: StageEClass; reason?: string }>
  counts: Record<StageEClass, number>
  completedAt: number
}

/** The Stage E artifact: per-object verification rows + honest totals. */
export function buildStageE(entries: RecoveryEntry[], custodyHolders?: (id: string) => number): StageEReport {
  const counts: Record<StageEClass, number> = { 'recovered+replicated': 0, 'recovered (under-replicated)': 0, 'metadata only': 0, corrupt: 0 };
  const rows = entries.map((entry) => {
    const cls = classifyStageE(entry, custodyHolders);
    counts[cls] += 1;
    return {
      objectId: entry.objectId,
      contentHash: entry.contentHash,
      mime: entry.mime,
      status: entry.status,
      class: cls,
      reason: entry.reason,
    };
  });
  return { rows, counts, completedAt: Date.now() };
}
