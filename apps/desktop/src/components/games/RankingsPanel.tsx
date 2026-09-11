"use client";

import { useMemo, useState } from 'react';
import { Trophy, MousePointerClick, Swords, Heart, Search } from 'lucide-react';
import { Avatar } from '../Avatar';
import type { User } from '@orbit/shared';

type Board = 'idle' | 'arena' | 'social';
type SocialMetric = 'all' | 'today';

const BOARDS: { id: Board; label: string; icon: typeof Trophy }[] = [
  { id: 'idle', label: 'Idle Clicker', icon: MousePointerClick },
  { id: 'arena', label: 'Card Duel', icon: Swords },
  { id: 'social', label: 'Social', icon: Heart },
];

function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 6)}\u2026${id.slice(-3)}` : id;
}

function displayName(user: User): string {
  const name = user.display_name?.trim();
  return name || shortId(user.id);
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function primaryScore(board: Board, metric: SocialMetric, u: User): number {
  if (board === 'idle') return u.balance ?? 0;
  if (board === 'arena') return u.matches_won ?? 0;
  return metric === 'today' ? (u.daily_score ?? u.score ?? 0) : (u.reputation ?? 0);
}

function scoreLabel(board: Board, value: number): string {
  if (board === 'idle') return `${formatNum(value)} g$`;
  if (board === 'arena') return `${value} win${value === 1 ? '' : 's'}`;
  return `${formatNum(value)} ${value === 1 ? 'pt' : 'pts'}`;
}

function secondaryLine(board: Board, u: User): string {
  if (board === 'idle') {
    const kos = u.gacha_items_collected ?? 0;
    return `${u.objects_sent_count ?? 0} cards \u00b7 ${kos} finds`;
  }
  if (board === 'arena') {
    const won = u.matches_won ?? 0;
    const lost = u.matches_lost ?? 0;
    return `${u.matches_total ?? 0} duels \u00b7 ${won}W ${lost}L`;
  }
  return `${u.likes_received ?? 0} likes \u00b7 ${u.followers_count ?? 0} followers`;
}

export function RankingsPanel({
  users,
  onSelectUser,
}: {
  users: User[];
  onSelectUser: (userId: string) => void;
}) {
  const [board, setBoard] = useState<Board>('idle');
  const [socialMetric, setSocialMetric] = useState<SocialMetric>('all');
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [query, setQuery] = useState('');

  const ranked = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users
      .filter((u) => (onlineOnly ? u.online : true))
      .filter((u) => (q ? displayName(u).toLowerCase().includes(q) || u.id.toLowerCase().startsWith(q) : true))
      .filter((u) => primaryScore(board, socialMetric, u) > 0)
      .sort((a, b) => {
        const diff = primaryScore(board, socialMetric, b) - primaryScore(board, socialMetric, a);
        if (diff !== 0) return diff;
        return a.id.localeCompare(b.id);
      })
      .slice(0, 100);
  }, [users, board, socialMetric, onlineOnly, query]);

  return (
    <div className="glass-surface rounded-lg p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-glass pb-3">
        <div className="flex items-center gap-2">
          <Trophy className="w-4 h-4 text-retro-accent" />
          <h2 className="text-sm font-medium text-retro-fg">Rankings</h2>
        </div>
        <div className="flex bg-surface-interactive border border-border-glass p-0.5 rounded-md text-xs">
          {BOARDS.map((b) => {
            const Icon = b.icon;
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => setBoard(b.id)}
                aria-pressed={board === b.id}
                className={`px-2.5 py-1 rounded transition-colors cursor-pointer font-medium flex items-center gap-1.5 ${board === b.id ? 'bg-surface-raised text-retro-fg' : 'text-retro-muted hover:text-retro-fg'
                  }`}
              >
                <Icon className="w-3 h-3" />
                {b.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[140px]">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-retro-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search players"
            aria-label="Search players"
            className="w-full bg-surface-interactive border border-border-glass rounded-md pl-8 pr-3 py-1.5 text-xs text-retro-fg outline-none focus:border-border-glass placeholder:text-retro-muted"
          />
        </div>
        <button
          type="button"
          onClick={() => setOnlineOnly((v) => !v)}
          aria-pressed={onlineOnly}
          className={`px-2.5 py-1.5 rounded-md text-xs border transition-colors cursor-pointer ${onlineOnly
            ? 'border-retro-accent text-retro-fg bg-surface-raised'
            : 'border-border-glass text-retro-muted hover:text-retro-fg bg-surface-interactive'
            }`}
        >
          Online only
        </button>
        {board === 'social' && (
          <div className="flex bg-surface-interactive border border-border-glass p-0.5 rounded-md text-xs">
            {(['all', 'today'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setSocialMetric(m)}
                aria-pressed={socialMetric === m}
                className={`px-2.5 py-1 rounded transition-colors cursor-pointer capitalize font-medium ${socialMetric === m ? 'bg-surface-raised text-retro-fg' : 'text-retro-muted hover:text-retro-fg'}`}
              >
                {m === 'all' ? 'XP' : 'Today'}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-1 max-h-[calc(100dvh-360px)] min-h-[200px] overflow-y-auto styled-scrollbar pr-1">
        {ranked.length === 0 ? (
          <p className="text-xs text-retro-muted text-center py-10">
            Nobody on this board yet{query ? ' for your search' : ''}.
          </p>
        ) : (
          ranked.map((user, idx) => {
            const value = primaryScore(board, socialMetric, user);
            const rank = idx + 1;
            return (
              <button
                key={user.id}
                type="button"
                onClick={() => onSelectUser(user.id)}
                className="w-full text-left bg-surface-interactive border border-border-glass rounded-lg p-2.5 flex items-center gap-3 hover:border-border-glass transition-colors cursor-pointer"
              >
                <span className="w-6 flex-shrink-0 text-center text-xs font-mono text-retro-muted">
                  {rank <= 3 && rank === 1 ? (
                    <Trophy className="w-3.5 h-3.5 text-retro-accent mx-auto" />
                  ) : (
                    `#${rank}`
                  )}
                </span>
                <div className="relative flex-shrink-0">
                  <Avatar id={user.id} imageUrl={user.pfp_url || undefined} size={32} />
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-surface-interactive ${user.online ? 'bg-retro-online' : 'bg-retro-muted'
                      }`}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-retro-fg truncate">{displayName(user)}</div>
                  <div className="text-[10px] text-retro-muted mt-0.5 truncate">{secondaryLine(board, user)}</div>
                </div>
                <span className="flex-shrink-0 text-xs font-mono text-retro-accent tabular-nums">
                  {scoreLabel(board, value)}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
