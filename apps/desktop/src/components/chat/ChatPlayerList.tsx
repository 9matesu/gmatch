"use client";

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Search, Users, X } from 'lucide-react';
import type { OrbitIdentity } from '@orbit/crypto';
import type { User } from '@orbit/shared';
import { orbitFetch } from '../../utils/api';
import { playPress } from '../../utils/sounds';
import { Avatar } from '../Avatar';

export interface ChatPlayerItem {
  id: string;
  display_name?: string;
  pfp_url?: string;
  last_seen?: string | null;
  online: boolean;
}

export interface ChatPlayerListProps {
  identity: OrbitIdentity | null;
  users?: User[];
  profilePics?: Record<string, string>;
  onOpenProfile?: (userId: string, user?: User) => void;
}

function formatRelativeTime(iso?: string | null): string {
  if (!iso) return 'recently';
  const ms = Date.now() - new Date(iso).getTime();
  if (isNaN(ms) || ms < 0) return 'just now';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function ChatPlayerList({
  identity,
  users = [],
  profilePics = {},
  onOpenProfile,
}: ChatPlayerListProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [dashboardUsers, setDashboardUsers] = useState<ChatPlayerItem[]>([]);

  const fetchDashboardUsers = useCallback(async () => {
    try {
      const res = await orbitFetch('/api/servers/dashboard', { method: 'GET' }, identity);
      if (res.ok) {
        const data = (await res.json()) as { users?: ChatPlayerItem[] };
        if (Array.isArray(data?.users)) {
          setDashboardUsers(data.users);
        }
      }
    } catch {
      /* Fallback to users prop */
    }
  }, [identity]);

  useEffect(() => {
    void fetchDashboardUsers();
    const timer = setInterval(() => {
      void fetchDashboardUsers();
    }, 30_000);
    return () => clearInterval(timer);
  }, [fetchDashboardUsers]);

  const mergedPlayers = useMemo(() => {
    const map = new Map<string, ChatPlayerItem>();
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;

    // 1. Seed from dashboard 24h query
    for (const du of dashboardUsers) {
      if (!du.id) continue;
      map.set(du.id, {
        id: du.id,
        display_name: du.display_name,
        pfp_url: du.pfp_url || profilePics[du.id],
        last_seen: du.last_seen,
        online: Boolean(du.online),
      });
    }

    // 2. Merge with props users (which may have fresher peer updates or profile pictures)
    for (const u of users) {
      if (!u.id) continue;
      const lastSeenMs = u.last_seen ? new Date(u.last_seen).getTime() : 0;
      const isOnline = Boolean(u.online) || (lastSeenMs > 0 && (now - lastSeenMs) < 60_000);
      const isWithin24h = isOnline || (lastSeenMs > 0 && (now - lastSeenMs) <= oneDayMs);

      const existing = map.get(u.id);
      if (existing) {
        existing.display_name = u.display_name || existing.display_name;
        existing.pfp_url = u.pfp_url || profilePics[u.id] || existing.pfp_url;
        existing.last_seen = u.last_seen || existing.last_seen;
        existing.online = isOnline || existing.online;
      } else if (isWithin24h || (identity && u.id === identity.orbitId)) {
        map.set(u.id, {
          id: u.id,
          display_name: u.display_name,
          pfp_url: u.pfp_url || profilePics[u.id],
          last_seen: u.last_seen,
          online: isOnline,
        });
      }
    }

    // 3. Ensure self is always present and online
    if (identity?.orbitId) {
      const self = map.get(identity.orbitId);
      let localName = '';
      try {
        localName = (localStorage.getItem('orbit_display_name') || '').trim();
      } catch {
        /* ignore */
      }
      if (self) {
        self.online = true;
        if (localName && (!self.display_name || self.display_name === 'User')) {
          self.display_name = localName;
        }
      } else {
        map.set(identity.orbitId, {
          id: identity.orbitId,
          display_name: localName || 'You',
          pfp_url: profilePics[identity.orbitId],
          online: true,
          last_seen: new Date().toISOString(),
        });
      }
    }

    // 4. Filter for only active in last 24h or online
    const list: ChatPlayerItem[] = [];
    for (const p of map.values()) {
      const lastSeenMs = p.last_seen ? new Date(p.last_seen).getTime() : 0;
      const isOnline = p.online || (lastSeenMs > 0 && (now - lastSeenMs) < 60_000);
      const is24h = isOnline || (lastSeenMs > 0 && (now - lastSeenMs) <= oneDayMs);

      if (is24h || (identity && p.id === identity.orbitId)) {
        list.push({ ...p, online: isOnline });
      }
    }

    // 5. Sort: online first, then offline by last_seen desc
    list.sort((a, b) => {
      if (a.online !== b.online) {
        return a.online ? -1 : 1;
      }
      if (a.online) {
        const nameA = (a.display_name || a.id).toLowerCase();
        const nameB = (b.display_name || b.id).toLowerCase();
        return nameA.localeCompare(nameB);
      }
      const timeA = a.last_seen ? new Date(a.last_seen).getTime() : 0;
      const timeB = b.last_seen ? new Date(b.last_seen).getTime() : 0;
      return timeB - timeA;
    });

    return list;
  }, [dashboardUsers, users, profilePics, identity]);

  const onlineCount = useMemo(() => mergedPlayers.filter((p) => p.online).length, [mergedPlayers]);

  const filteredPlayers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return mergedPlayers;
    return mergedPlayers.filter((p) => {
      const name = (p.display_name || '').toLowerCase();
      const id = p.id.toLowerCase();
      return name.includes(q) || id.includes(q);
    });
  }, [mergedPlayers, searchQuery]);

  const handlePlayerClick = (p: ChatPlayerItem) => {
    playPress(740);
    const fullUser = users.find((u) => u.id === p.id);
    const userObj: User = fullUser || ({
      id: p.id,
      display_name: p.display_name,
      pfp_url: p.pfp_url,
      last_seen: p.last_seen || undefined,
      online: p.online,
      publicKey: '',
      createdAt: '',
    } as User);
    onOpenProfile?.(p.id, userObj);
  };

  return (
    <div className="h-full min-h-0 flex flex-col select-none overflow-hidden" data-testid="chat-player-list">
      {/* Header */}
      <div className="p-3 sm:p-4 border-b border-border-glass flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Users className="w-4 h-4 text-retro-muted shrink-0" />
          <h2 className="font-semibold text-sm text-retro-fg truncate">
            Players
          </h2>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] font-mono shrink-0">
          <span className="flex items-center gap-1 text-retro-online font-medium">
            <span className="w-2 h-2 rounded-full bg-retro-online inline-block" />
            {onlineCount}
          </span>
          <span className="text-retro-muted">/</span>
          <span className="text-retro-muted" title="Total active in the last 24 hours">
            {mergedPlayers.length} 24h
          </span>
        </div>
      </div>

      {/* Quick Search */}
      <div className="p-2.5 border-b border-border-glass shrink-0">
        <div className="flex items-center gap-2 bg-surface-raised border border-border-glass rounded-md px-2.5 py-1.5 text-xs text-retro-body">
          <Search className="w-3.5 h-3.5 text-retro-muted shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search players..."
            className="w-full bg-transparent focus:outline-none placeholder:text-retro-muted text-retro-fg border-none text-xs"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="text-retro-muted hover:text-retro-fg cursor-pointer p-0.5"
              aria-label="Clear player search"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Player List */}
      <div className="flex-1 min-h-0 overflow-y-auto styled-scrollbar p-2 space-y-1">
        {filteredPlayers.length === 0 ? (
          <div className="text-center py-8 text-xs text-retro-muted">
            {searchQuery ? `No players matching "${searchQuery}"` : 'No players active in last 24h'}
          </div>
        ) : (
          filteredPlayers.map((player) => {
            const isSelf = identity?.orbitId === player.id;
            const displayName = player.display_name?.trim() || (isSelf ? 'You' : 'User');
            const pfp = player.pfp_url || profilePics[player.id];

            return (
              <button
                key={player.id}
                type="button"
                onClick={() => handlePlayerClick(player)}
                title={`View ${displayName}'s profile`}
                className="w-full flex items-center gap-2.5 p-2 rounded-lg text-left hover:bg-glass-w8 active:bg-glass-w12 transition-colors cursor-pointer group"
              >
                {/* Avatar with Status Indicator Dot */}
                <div className="relative shrink-0">
                  <Avatar
                    id={player.id}
                    size={32}
                    imageUrl={pfp}
                  />
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-surface-raised ${
                      player.online
                        ? 'bg-retro-online'
                        : 'bg-retro-muted/60'
                    }`}
                    aria-label={player.online ? 'Online' : 'Offline'}
                  />
                </div>

                {/* Player details */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 justify-between">
                    <span className="text-xs font-medium text-retro-body group-hover:text-retro-fg truncate">
                      {displayName}
                    </span>
                    {isSelf && (
                      <span className="text-[10px] font-semibold text-retro-accent shrink-0 px-1 py-0.2 rounded bg-glass-w8">
                        You
                      </span>
                    )}
                  </div>
                  <span className="block text-[10px] text-retro-muted truncate">
                    {player.online ? (
                      <span className="text-retro-online font-medium">Active now</span>
                    ) : (
                      <span>Seen {formatRelativeTime(player.last_seen)}</span>
                    )}
                  </span>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
