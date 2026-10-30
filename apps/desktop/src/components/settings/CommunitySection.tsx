"use client";

import { useState } from 'react';
import { UsersThree, Copy, Check, ArrowSquareOut } from '@phosphor-icons/react';
import { useCommunityInvite, openCommunityInvite } from '../../services/community';

/**
 * Settings > Preferences: one visible place for the community invite. The URL
 * comes from the node's public settings (`/api/discord-invite`) and falls back
 * to the constant in `services/community.ts`, so a fresh local node still
 * points somewhere useful.
 */
export function CommunitySection({ toast }: { toast?: (message: string, type?: 'success' | 'error' | 'info') => void }) {
  const url = useCommunityInvite();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast?.('Community invite copied', 'success');
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast?.('Could not copy the invite', 'error');
    }
  };

  return (
    <div className="p-4 bg-glass-w5 border border-border-glass rounded-lg space-y-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] font-medium uppercase tracking-wider text-retro-muted">
          Community &amp; support
        </span>
        <UsersThree className="w-4 h-4 text-retro-fg" />
      </div>
      <p className="text-xs text-retro-body">
        Report a problem, ask for help, or find other people on the server.
      </p>
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <code className="flex-1 min-w-0 truncate rounded-md border border-border-glass bg-surface-raised px-2 py-1.5 text-[11px] text-retro-body">
          {url}
        </code>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => openCommunityInvite(url)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border-glass bg-glass-w8 px-2.5 py-1.5 text-xs font-medium text-retro-fg hover:bg-glass-w12 cursor-pointer"
          >
            <ArrowSquareOut className="w-3.5 h-3.5" /> Open
          </button>
          <button
            type="button"
            onClick={() => void copy()}
            className="inline-flex items-center gap-1.5 rounded-md border border-border-glass px-2.5 py-1.5 text-xs font-medium text-retro-muted hover:text-retro-fg hover:bg-glass-w8 cursor-pointer"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
    </div>
  );
}
