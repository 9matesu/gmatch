"use client";

import type { GalleryImage } from '../game/types';
import type { KeepsakePersistResult } from './keepsake';

/**
 * Retroactive legacy re-cache: an OLD vault holds keepsakes as a provider URL
 * (e.g. a redgifs mp4) with NO local bytes, so the URL is never satisfied and
 * the tile stays black. This is the one-shot legacy measure that adapts them to
 * the current format: fetch each URL's bytes, verify them into durable local
 * storage (IndexedDB + optional vault), and stamp the keep `persisted` with its
 * content hash (`localRef`) — exactly what a fresh keep gets.
 *
 * Rules (each one is a test):
 * - **Legacy/uncached only.** A keep with an http(s) url that is not already
 *   `persisted` with a `localRef`. Already-local keeps are never re-fetched.
 * - **Additive.** Nothing is deleted or re-uploaded; a keep that fails to fetch
 *   is left exactly as it was (its url stays retryable).
 * - **Bounded.** One run does at most MAX_RECACHE_PER_RUN, sequentially, so a
 *   click can never become a fetch storm.
 * - **Opt-in.** Nothing calls this at boot (Settings → Preferences).
 */

export interface RecacheSummary {
  /** Keeps examined this run. */
  scanned: number;
  /** Keeps whose bytes are now durable locally. */
  cached: number;
  /** Keeps that could not be fetched/persisted (left untouched). */
  failed: number;
}

export interface RecacheDeps {
  listKeepsakes(): GalleryImage[];
  persist(url: string, kind?: 'image' | 'video'): Promise<KeepsakePersistResult>;
  update(id: string, patch: Partial<Pick<GalleryImage, 'saveState' | 'localRef'>>): void;
}

export interface RecacheOptions {
  limit?: number;
  /** Test seam: replace one or more leaf operations. */
  deps?: Partial<RecacheDeps>;
}

export const MAX_RECACHE_PER_RUN = 200;

const HTTP_RE = /^https?:\/\//i;

/** A legacy keep: a provider URL but no verified local bytes yet. */
export function isLegacyUncached(g: GalleryImage): boolean {
  if (!g.url || !HTTP_RE.test(g.url)) return false;
  if (g.saveState === 'persisted' && g.localRef) return false;
  return true;
}

export async function recacheLegacyMedia(opts: RecacheOptions = {}): Promise<RecacheSummary> {
  const deps: RecacheDeps = {
    listKeepsakes: () => [],
    persist: async () => ({ status: 'failed', reason: 'no-deps' }),
    update: () => {},
    ...opts.deps,
  };
  const limit = Math.max(1, Math.min(opts.limit ?? MAX_RECACHE_PER_RUN, MAX_RECACHE_PER_RUN));
  const summary: RecacheSummary = { scanned: 0, cached: 0, failed: 0 };

  let keeps: GalleryImage[];
  try {
    keeps = deps.listKeepsakes();
  } catch {
    return summary;
  }

  // Sequential on purpose: a bounded, gentle drain rather than a parallel burst
  // that would hammer the provider (and Cloudflare) at once.
  for (const g of keeps.filter(isLegacyUncached).slice(0, limit)) {
    summary.scanned += 1;
    let res: KeepsakePersistResult;
    try {
      res = await deps.persist(g.url, g.kind);
    } catch {
      res = { status: 'failed', reason: 'fetch' };
    }
    if (res.status === 'local' && res.ref) {
      deps.update(g.id, { saveState: 'persisted', localRef: res.ref });
      summary.cached += 1;
    } else {
      summary.failed += 1;
    }
  }
  return summary;
}