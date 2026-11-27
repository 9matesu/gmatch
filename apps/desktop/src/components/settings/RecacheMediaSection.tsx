"use client";

import { useState } from 'react';
import { ArrowsClockwise, CheckCircle } from '@phosphor-icons/react';
import { useGame } from '../../game/store';
import { persistKeepsake } from '../../services/keepsake';
import { recacheLegacyMedia, type RecacheSummary } from '../../services/legacyRecache';
import { isPermanentlySaved } from '../../utils/mediaVault';

/**
 * Settings > Preferences: the OPT-IN legacy re-cache.
 *
 * An old vault holds keepsakes as a provider URL with no local bytes, so the
 * tile never resolves. One click fetches those bytes into durable local storage
 * (the current format) and stamps each keep `persisted`. Additive and bounded;
 * nothing runs at boot.
 */

function describe(summary: RecacheSummary): string {
  // "0 cached" used to read as "no keepsakes were saved", when in fact a
  // manually viewed keep is already permanent in the vault. Say that instead.
  const saved = summary.permanent
    ? `${summary.permanent} already saved permanently in the vault`
    : null;
  if (summary.scanned === 0) {
    return saved
      ? `${saved}. Nothing to re-cache.`
      : 'Nothing to re-cache — every keepsake already has local bytes.';
  }
  const parts = [`${summary.cached} cached permanently`];
  if (saved) parts.push(saved);
  if (summary.failed > 0) parts.push(`${summary.failed} could not be fetched`);
  return parts.join(' · ');
}

export function RecacheMediaSection({
  toast,
}: {
  toast?: (message: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<RecacheSummary | null>(null);

  const run = async () => {
    if (running) return;
    setRunning(true);
    try {
      const result = await recacheLegacyMedia({
        deps: {
          listKeepsakes: () => useGame.getState().gallery,
          persist: (url, kind) => persistKeepsake(url, {}, kind),
          update: (id, patch) =>
            useGame.setState((s) => ({
              gallery: s.gallery.map((g) => (g.id === id ? { ...g, ...patch } : g)),
            })),
          isPermanent: isPermanentlySaved,
        },
      });
      setSummary(result);
      toast?.(describe(result), result.cached > 0 ? 'success' : 'info');
    } catch {
      toast?.('Could not re-cache your keepsakes', 'error');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="p-4 bg-glass-w5 border border-edge rounded-lg space-y-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-2xs font-medium uppercase tracking-wider text-retro-muted">
          Legacy keepsakes
        </span>
        <ArrowsClockwise className={`w-4 h-4 text-retro-fg ${running ? 'animate-spin' : ''}`} />
      </div>
      <p className="text-xs text-retro-body">
        Older keepsakes point at their original link with no local copy, so they
        never load. Re-cache them once to fetch the bytes onto this device.
        Nothing is uploaded anywhere.
      </p>
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <button
          type="button"
          onClick={() => void run()}
          disabled={running}
          aria-busy={running}
          className="inline-flex items-center gap-1.5 rounded-md border border-edge bg-glass-w8 px-2.5 py-1.5 text-xs font-medium text-retro-fg hover:bg-glass-w12 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          <ArrowsClockwise className="w-3.5 h-3.5" />
          {running ? 'Re-caching…' : 'Re-cache legacy keepsakes'}
        </button>
        {summary && !running && (
          <span role="status" className="inline-flex items-center gap-1.5 text-xs text-retro-muted">
            <CheckCircle className="w-3.5 h-3.5 text-success-fg" />
            {describe(summary)}
          </span>
        )}
      </div>
    </div>
  );
}