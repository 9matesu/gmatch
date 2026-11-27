"use client";

import { useState } from 'react';
import { ArrowsClockwise, CheckCircle } from '@phosphor-icons/react';
import type { OrbitIdentity } from '@orbit/crypto';
import { sharedSocialOperationLog } from '../../services/socialOperationLog';
import { importOwnPosts, type ImportSummary } from '../../services/socialPostImport';

/**
 * Settings > Preferences: the OPT-IN migration of the player's own older posts
 * into the signed operation log.
 *
 * A post published before the local-first path existed lives only as a node
 * row, so a peer cannot address it and it disappears from the feed the moment
 * the node stops answering. One explicit click turns those posts into signed
 * `post.create` operations and seeds their bytes locally, so peers can fetch
 * them from this machine instead. Nothing runs at boot: re-publishing old
 * content is the player's decision.
 */

function describe(summary: ImportSummary): string {
  const imported = summary.imported.length;
  const skipped = summary.skipped;
  if (imported === 0 && skipped.length === 0) {
    return 'Nothing to share yet — posts you publish from now on already travel to your peers.';
  }
  const counts = new Map<string, number>();
  for (const entry of skipped) counts.set(entry.reason, (counts.get(entry.reason) ?? 0) + 1);
  const reasonText: Record<string, string> = {
    already: 'already shared',
    'no-bytes': 'media not on this device',
    'hash-mismatch': 'media did not match the post',
    deleted: 'deleted',
    'not-public': 'not a public post',
    invalid: 'could not be shared',
  };
  const parts: string[] = [];
  for (const [reason, count] of counts) parts.push(`${count} ${reasonText[reason] ?? reason}`);
  const shared = `${imported} post${imported === 1 ? '' : 's'} shared`;
  return parts.length > 0 ? `${shared} · skipped ${parts.join(', ')}` : shared;
}

export function ImportPostsSection({
  identity,
  toast,
}: {
  identity: OrbitIdentity | null;
  toast?: (message: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  const run = async () => {
    if (!identity || running) return;
    setRunning(true);
    try {
      const result = await importOwnPosts(identity, sharedSocialOperationLog());
      setSummary(result);
      if (result.imported.length > 0) {
        toast?.(`Shared ${result.imported.length} existing post${result.imported.length === 1 ? '' : 's'} with peers`, 'success');
      } else {
        toast?.(describe(result), 'info');
      }
    } catch {
      toast?.('Could not share your existing posts', 'error');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="p-4 bg-glass-w5 border border-edge rounded-lg space-y-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-2xs font-medium uppercase tracking-wider text-retro-muted">
          Your existing posts
        </span>
        <ArrowsClockwise className={`w-4 h-4 text-retro-fg ${running ? 'animate-spin' : ''}`} />
      </div>
      <p className="text-xs text-retro-body">
        Older posts live on this machine&apos;s node. Share them once so peers can
        receive them directly, even when the node is not running. Nothing is
        uploaded anywhere new.
      </p>
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <button
          type="button"
          onClick={() => void run()}
          disabled={!identity || running}
          aria-busy={running}
          className="inline-flex items-center gap-1.5 rounded-md border border-edge bg-glass-w8 px-2.5 py-1.5 text-xs font-medium text-retro-fg hover:bg-glass-w12 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          <ArrowsClockwise className="w-3.5 h-3.5" />
          {running ? 'Sharing…' : 'Share my existing posts'}
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