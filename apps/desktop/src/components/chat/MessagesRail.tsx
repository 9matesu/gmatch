"use client";

// Desktop messages rail: replaces the old inline left chat panel. Collapsed
// handle on the right edge (single unicode chevron, no button casing);
// expands into a bottom-right drawer — chat on the left (children),
// players/groups info on the right. Instagram-style.

import { useState } from 'react';
import type { User } from '@orbit/shared';
import { playPress } from '../../utils/sounds';

interface Props {
  open: boolean;
  onToggle: () => void;
  unreadCount: number;
  children: React.ReactNode;
  users: User[];
  profilePics: Record<string, string>;
  onOpenProfile: (userId: string) => void;
  groups: { id: string; name: string; member_count: number }[];
  onOpenGroup?: (groupId: string) => void;
}

export function MessagesRail({
  open,
  onToggle,
  unreadCount,
  children,
  users,
  profilePics,
  onOpenProfile,
  groups,
  onOpenGroup,
}: Props) {
  const [railTab, setRailTab] = useState<'players' | 'groups'>('players');
  const online = users.filter((u) => u.online);
  const people = railTab === 'players' ? online : users;

  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={open ? 'Collapse messages' : 'Expand messages'}
        title="Messages"
        className="hidden md:flex fixed right-0 bottom-24 z-[var(--z-dropdown)] flex-col items-center gap-1.5 py-3 px-1 rounded-l-md hover:bg-glass-w10 text-retro-muted hover:text-retro-fg cursor-pointer select-none"
      >
        <span className="text-lg leading-none" aria-hidden>{open ? '⌄' : '⌃'}</span>
        <span className="text-[10px] tracking-wider" style={{ writingMode: 'vertical-rl' }}>Messages</span>
        {unreadCount > 0 && !open && <span className="w-2 h-2 rounded-full bg-retro-fg" />}
      </button>

      {open && (
        <div className="hidden md:flex fixed right-2 bottom-2 z-[var(--z-dropdown)] h-[60vh] w-[min(920px,calc(100vw-2rem))] rounded-xl border border-border-glass bg-retro-panel shadow-2xl overflow-hidden">
          <div className="flex-1 min-w-0 p-2 border-r border-border-glass">
            {children}
          </div>
          <aside className="w-56 shrink-0 flex flex-col">
            <div className="flex items-center gap-1 p-2 border-b border-border-glass text-xs">
              {(['players', 'groups'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => { playPress(700); setRailTab(t); }}
                  className={`px-2 py-1 rounded-md capitalize cursor-pointer transition-colors ${railTab === t ? 'bg-glass-w12 text-retro-fg' : 'text-retro-muted hover:text-retro-fg'}`}
                >
                  {t}
                </button>
              ))}
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto styled-scrollbar">
              {railTab === 'players' ? (
                people.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => onOpenProfile(u.id)}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-glass-w5 text-left cursor-pointer"
                  >
                    {profilePics[u.id] ? (
                      <img src={profilePics[u.id]} alt="" className="w-6 h-6 rounded-full object-cover shrink-0" />
                    ) : (
                      <span className="w-6 h-6 rounded-full bg-glass-w10 flex items-center justify-center text-[10px] text-retro-muted shrink-0">
                        {(u.display_name || '?').slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    <span className="text-xs text-retro-body truncate flex-1">{u.display_name || 'Unknown User'}</span>
                    {u.online && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />}
                  </button>
                ))
              ) : (
                groups.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => onOpenGroup?.(g.id)}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-glass-w5 text-left cursor-pointer"
                  >
                    <span className="w-6 h-6 rounded-md bg-glass-w10 flex items-center justify-center text-[10px] text-retro-muted shrink-0">
                      {g.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="text-xs text-retro-body truncate flex-1">{g.name}</span>
                    <span className="text-[10px] text-retro-muted shrink-0">{g.member_count}</span>
                  </button>
                ))
              )}
              {railTab === 'players' && people.length === 0 && (
                <p className="p-3 text-xs text-retro-muted">Nobody online.</p>
              )}
              {railTab === 'groups' && groups.length === 0 && (
                <p className="p-3 text-xs text-retro-muted">No groups yet.</p>
              )}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
