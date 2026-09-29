"use client";

import { useMemo, useState } from 'react';
import { Trophy, Swords, Heart, Search, Sparkles } from 'lucide-react';
import { Avatar } from '../Avatar';
import { formatNum } from '../../ui/format';
import type { User } from '@orbit/shared';

type Board = 'collection' | 'arena' | 'social';
type SocialMetric = 'all' | 'today';

const BOARDS: { id: Board; label: string; hint: string; icon: typeof Trophy }[] = [
  {
    id: 'collection',
    label: 'Collection',
    // Wallet balances are deliberately private: the directory only returns
    // `balance` for the caller, so a balance-ranked board was empty for everyone
    // else. Collection finds are public, so the board ranks on those instead.
    hint: 'Most gacha finds collected. Wallet balances stay private.',
    icon: Sparkles,
  },
  { id: 'arena', label: 'Card Duel', hint: 'Ranked by duel wins.', icon: Swords },
  { id: 'social', label: 'Social', hint: 'Ranked by reputation, or by today’s score.', icon: Heart },
];

function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 6)}\u2026${id.slice(-3)}` : id;
}

function displayName(user: User): string {
  const name = user.display_name?.trim();
  return name || shortId(user.id);
}

function primaryScore(board: Board, metric: SocialMetric, u: User): number {
  if (board === 'collection') return u.gacha_items_collected ?? 0;
  if (board === 'arena') return u.matches_won ?? 0;
  return metric === 'today' ? (u.daily_score ?? u.score ?? 0) : (u.reputation ?? 0);
}

function scoreLabel(board: Board, value: number): string {
  if (board === 'collection') return `${formatNum(value)} find${value === 1 ? '' : 's'}`;
  if (board === 'arena') return `${value} win${value === 1 ? '' : 's'}`;
  return `${formatNum(value)} ${value === 1 ? 'pt' : 'pts'}`;
}

function secondaryLine(board: Board, u: User): string {
  if (board === 'collection') {
    return `${u.objects_sent_count ?? 0} cards sent \u00b7 ${u.likes_received ?? 0} likes`;
  }
  if (board === 'arena') {
    const won = u.matches_won ?? 0;
    const lost = u.matches_lost ?? 0;
    // matches_total is a mutual-LIKE count, not duels — the old line printed
    // it as "N duels" next to a W/L from LeagueRank, which are unrelated.
    return `${won + lost} duel${won + lost === 1 ? '' : 's'} \u00b7 ${won}W ${lost}L`;
  }
  return `${u.likes_received ?? 0} likes \u00b7 ${u.followers_count ?? 0} followers`;
}

const MEDALS = ['\u{1F3C6}', '\u{2461}', '\u{2462}'];

/** 1st/2nd/3rd get a medal; everyone else a muted `#n`. Previously only #1 got
 *  an icon, so #2 and #3 rendered identically to #4. */
function RankBadge({ rank }: { rank: number }) {
  if (rank >= 1 && rank <= 3) {
    return (
      <span className="text-sm leading-none" aria-label={`Rank ${rank}`} role="img">
        {MEDALS[rank - 1]}
      </span>
    );
  }
  return <span className="text-xs font-mono text-retro-muted">#{rank}</span>;
}

export function RankingsPanel({
  users,
  currentUserId,
  onSelectUser,
}: {
  users: User[];
  currentUserId?: string;
  onSelectUser: (userId: string) => void;
}) {
  const [board, setBoard] = useState<Board>('collection');
  const [socialMetric, setSocialMetric] = useState<SocialMetric>('all');
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [query, setQuery] = useState('');

  // Rank is assigned ONCE from the full, sorted board, before search and the
  // "Online only" toggle narrow the view. It used to be `idx + 1` on the
  // filtered array, so typing a search restarted the list at #1 and two
  // players could be shown different ranks for the same person.
  const boardList = useMemo(() => {
    return users
      .filter((u) => primaryScore(board, socialMetric, u) > 0)
      .sort((a, b) => {
        const diff = primaryScore(board, socialMetric, b) - primaryScore(board, socialMetric, a);
        if (diff !== 0) return diff;
        return a.id.localeCompare(b.id);
      });
  }, [users, board, socialMetric]);

  const rankById = useMemo(() => {
    const map = new Map<string, number>();
    boardList.forEach((u, i) => map.set(u.id, i + 1));
    return map;
  }, [boardList]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return boardList
      .filter((u) => (onlineOnly ? u.online : true))
      .filter((u) => (q ? displayName(u).toLowerCase().includes(q) || u.id.toLowerCase().startsWith(q) : true))
      .slice(0, 100);
  }, [boardList, onlineOnly, query]);

  const myRank = currentUserId ? rankById.get(currentUserId) : undefined;
  const boardHint = BOARDS.find((b) => b.id === board)?.hint;

  return (
    <div className="glass-surface rounded-lg p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-glass pb-3">
        <div className="flex items-center gap-2">
          <Trophy className="w-4 h-4 text-retro-accent" />
          <h2 className="text-sm font-medium text-retro-fg">Rankings</h2>
        </div>
        <div className="flex bg-surface-interactive border border-border-glass p-0.5 rounded-md text-xs" role="group" aria-label="Ranking boards">
          {BOARDS.map((b) => {
            const Icon = b.icon;
            return (
              <button
                key={b.id}
                type="button"
                aria-pressed={board === b.id}
                onClick={() => setBoard(b.id)}
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
          <div className="flex bg-surface-interactive border border-border-glass p-0.5 rounded-md text-xs" role="group" aria-label="Social metric timeframe">
            {(['all', 'today'] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={socialMetric === m}
                onClick={() => setSocialMetric(m)}
                className={`px-2.5 py-1 rounded transition-colors cursor-pointer capitalize font-medium ${socialMetric === m ? 'bg-surface-raised text-retro-fg' : 'text-retro-muted hover:text-retro-fg'}`}
              >
                {m === 'all' ? 'XP' : 'Today'}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-retro-muted">
        <span>{boardHint}</span>
        {myRank && (
          <span className="font-mono" data-testid="rankings-my-rank">
            Your rank: #{myRank} of {boardList.length}
          </span>
        )}
      </div>

      <div className="space-y-1 max-h-[calc(100dvh-360px)] min-h-[200px] overflow-y-auto styled-scrollbar pr-1">
        {visible.length === 0 ? (
          <p className="text-xs text-retro-muted text-center py-10">
            {boardList.length === 0
              ? 'Nobody on this board yet.'
              : query
                ? `No players match your search on this board.`
                : 'No online players on this board yet.'}
          </p>
        ) : (
          visible.map((user) => {
            const value = primaryScore(board, socialMetric, user);
            const rank = rankById.get(user.id) ?? 0;
            return (
              <button
                key={user.id}
                type="button"
                onClick={() => onSelectUser(user.id)}
                className="w-full text-left bg-surface-interactive border border-border-glass rounded-lg p-2.5 flex items-center gap-3 hover:border-border-glass transition-colors cursor-pointer"
              >
                <span className="w-6 flex-shrink-0 text-center">
                  <RankBadge rank={rank} />
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
