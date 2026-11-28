"use client";

import { useState, useEffect, useMemo } from 'react';
import { Search, Users, X, MessageSquare, Swords } from 'lucide-react';
import type { OrbitIdentity } from '@orbit/crypto';
import { generateFallbackName, type User } from '@orbit/shared';
import { playPress } from '../../utils/sounds';
import { Avatar } from '../Avatar';
import { parseSeenMs } from '../../utils/presence';
import { usePresence } from '../../game/presenceStore';
import { usePresencePoll } from '../../hooks/usePresencePoll';
import { swarmTransportLabel } from '../../hooks/useP2P';
import type { PeerRoster } from '../../utils/peerRoster';
import { swarmTransportRegistry } from '../../utils/transportState';
import { FeedbackState } from '../../ui/kit';
import { classes, PRESENCE } from '../../ui/tokens';

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
  /** Start (or reopen) a DM with this player. */
  onMessagePlayer?: (peer: { orbitId: string; name?: string; pfp?: string }) => void;
  /** Send a game invite through the existing server-authoritative protocol. */
  onInvitePlayer?: (userId: string) => void;
  /** Why invites are unavailable on this node. Never null on a blind courier,
   *  so the button explains itself instead of 404-ing. */
  inviteUnavailableReason?: string | null;
  /** THE one roster. When supplied, the header count reads it instead of the
   *  node dashboard's snapshot (which is an input, not a second authority). */
  roster?: PeerRoster;
  /** When true the list body is hidden and the header stays as the toggle. */
  collapsed?: boolean;
  /** Toggle the collapsed state from the Players header label. */
  onToggleCollapse?: () => void;
}

function formatRelativeTime(iso?: string | null): string {
  if (!iso) return 'recently';
  const s = typeof iso === 'string' && !iso.endsWith('Z') && !iso.includes('+')
    ? (iso.includes('T') ? `${iso}Z` : `${iso.replace(' ', 'T')}Z`)
    : iso;
  const t = new Date(s).getTime();
  if (isNaN(t) || t <= 0) return 'recently';
  const ms = Date.now() - t;
  if (ms < 0 && ms >= -15_000) return 'just now';
  if (ms < 0) return 'recently';
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
  onMessagePlayer,
  onInvitePlayer,
  inviteUnavailableReason = null,
  roster,
  collapsed = false,
  onToggleCollapse,
}: ChatPlayerListProps) {
  const [searchQuery, setSearchQuery] = useState('');
  // A dial can validate/fail without touching the roster, so the list needs
  // the transport registry's own change event to show "connecting" live.
  const [transportTick, setTransportTick] = useState(0);
  useEffect(() => swarmTransportRegistry.subscribe(() => setTransportTick((n) => n + 1)), []);
  // Presence now lives in one app-wide store fed by one ref-counted poll, so
  // this list and the profile modal can no longer disagree about who is online.
  // Previously each surface ran its own 30s dashboard poll and derived its own
  // answer from whatever user object it happened to hold.
  const isOnline = usePresence((s) => s.isOnline);
  const records = usePresence((s) => s.records);
  const counts = usePresence((s) => s.counts);
  const countsAt = usePresence((s) => s.countsAt);
  const ingest = usePresence((s) => s.ingest);
  const setSelfId = usePresence((s) => s.setSelfId);

  usePresencePoll(identity);

  // Props users are a second, independently-fresh presence source (peer
  // updates, the profile directory). Feed them to the same store rather than
  // merging them privately, so every consumer sees the same record.
  useEffect(() => {
    if (users.length > 0) ingest(users as never);
  }, [users, ingest]);

  useEffect(() => {
    setSelfId(identity?.orbitId ?? null);
  }, [identity?.orbitId, setSelfId]);

  // The roster is the one authority for who is online AND for the rows a peer
  // discovered outside this node (a cross-node presence beacon never appears
  // in the node's /api/users snapshot). One subscription drives both: the
  // header count and the list body must change together, and unmount cleans up.
  const [rosterPeers, setRosterPeers] = useState<User[]>([]);
  const [rosterCount, setRosterCount] = useState<number | null>(null);
  useEffect(() => {
    if (!roster) {
      setRosterPeers([]);
      setRosterCount(null);
      return undefined;
    }
    return roster.subscribe((peers) => {
      setRosterPeers(peers);
      setRosterCount(roster.countOnline(identity?.orbitId));
    });
  }, [roster, identity?.orbitId]);

  const mergedPlayers = useMemo(() => {
    const map = new Map<string, ChatPlayerItem>();
    const now = Date.now();
    const seenMs = parseSeenMs;
    const phaseFor = (id: string) => swarmTransportRegistry.phaseFor(id);
    const isConnecting = (id: string) => phaseFor(id) === 'connecting-direct';

    // 1. Seed from the shared presence store — the same record the profile
    // modal and the roster read, so the three can never disagree.
    for (const [id, rec] of records) {
      map.set(id, {
        id,
        display_name: rec.displayName,
        pfp_url: rec.pfpUrl || profilePics[id],
        last_seen: rec.lastSeenMs > 0 ? new Date(rec.lastSeenMs).toISOString() : null,
        online: isOnline(id, now),
      });
    }

    // 2. Merge with props users (which may have fresher peer updates or profile pictures)
    for (const u of users) {
      if (!u.id) continue;
      const lastSeenMs = seenMs(u.last_seen);
      const online = isOnline(u.id, now);

      const existing = map.get(u.id);
      if (existing) {
        existing.display_name = u.display_name || existing.display_name;
        existing.pfp_url = u.pfp_url || profilePics[u.id] || existing.pfp_url;
        // Keep the NEWEST sighting; a stale snapshot must not revive presence.
        const existingSeenMs = seenMs(existing.last_seen);
        if (lastSeenMs >= existingSeenMs) existing.last_seen = u.last_seen || existing.last_seen;
        existing.online = isOnline(u.id, now);
      } else if (online || isConnecting(u.id) || (identity && u.id === identity.orbitId)) {
        map.set(u.id, {
          id: u.id,
          display_name: u.display_name,
          pfp_url: u.pfp_url || profilePics[u.id],
          last_seen: u.last_seen,
          online,
        });
      }
    }

    // 3. Merge the one roster. A peer found only through a cross-node presence
    //    beacon is not in `users` or the node dashboard, so without this step
    //    its row was missing entirely (or nameless). A signed name wins; an
    //    empty one never blanks a name learned from another source. The roster
    //    owns the online flag for rows it carries.
    for (const p of rosterPeers) {
      if (!p?.id || p.id === identity?.orbitId) continue;
      const name = p.display_name?.trim();
      const online = p.online === true;
      const existing = map.get(p.id);
      if (existing) {
        if (name) existing.display_name = name;
        existing.pfp_url = p.pfp_url || profilePics[p.id] || existing.pfp_url;
        existing.online = online;
      } else if (online || isConnecting(p.id)) {
        map.set(p.id, {
          id: p.id,
          display_name: name || undefined,
          pfp_url: p.pfp_url || profilePics[p.id],
          last_seen: p.last_seen || null,
          online,
        });
      }
    }

    // 4. Ensure self is always present and online
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

    // 5. Only live players: a confirmed-online peer, or one with a dial in
    //    flight. "Seen 6h ago" rows are dead weight, not a roster.
    const list: ChatPlayerItem[] = [];
    for (const p of map.values()) {
      if (p.online || isConnecting(p.id) || (identity && p.id === identity.orbitId)) list.push(p);
    }

    // 6. Online first, then connecting, each group named alphabetically.
    list.sort((a, b) => {
      const rank = (p: ChatPlayerItem) => (p.online ? 0 : 1);
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      return (a.display_name || a.id).toLowerCase().localeCompare((b.display_name || b.id).toLowerCase());
    });

    return list;
  }, [records, isOnline, users, rosterPeers, profilePics, identity, transportTick]);

  const localOnlineCount = useMemo(() => mergedPlayers.filter((p) => p.online).length, [mergedPlayers]);
  // Server counts are only trustworthy while the snapshot carrying them is
  // fresh. Two polls can be missed inside the 60s presence window, so the
  // fallback is 75s — after that the number is a lie and we use our own count.
  const isDashboardCountsFresh = Boolean(counts && countsAt > 0 && (Date.now() - countsAt) < 75_000);
  const displayOnlineCount = rosterCount ?? (isDashboardCountsFresh && counts ? counts.online : localOnlineCount);
  // The second number is a dial in flight, not a 24h-seen tally: the list
  // shows only live players, so there is no stale row to count any more.
  const connectingCount = mergedPlayers.filter(
    (p) => swarmTransportRegistry.phaseFor(p.id) === 'connecting-direct',
  ).length;

  const filteredPlayers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return mergedPlayers;
    return mergedPlayers.filter((p) => {
      const name = (p.display_name?.trim() || generateFallbackName(p.id)).toLowerCase();
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
      {/* Header — the Players label with its icon is the collapse toggle. When
          collapsed the column shrinks to the icon, so the label and counts hide. */}
      <div className={classes('border-b border-edge flex items-center shrink-0', collapsed ? 'p-3 justify-center' : 'p-3 sm:p-4 justify-between')}>
        <button
          type="button"
          onClick={onToggleCollapse}
          disabled={!onToggleCollapse}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand players' : 'Collapse players'}
          title={collapsed ? 'Expand players' : 'Collapse players'}
          className="flex items-center gap-2 min-w-0 cursor-pointer disabled:cursor-default text-left"
        >
          <Users className="w-4 h-4 text-retro-muted shrink-0" />
          {!collapsed && (
            <h2 className="font-semibold text-sm text-retro-fg truncate">
              Players
            </h2>
          )}
        </button>
        {!collapsed && (
          <div className="flex items-center gap-1.5 text-xs font-mono shrink-0">
            <span className="flex items-center gap-1 font-medium">
              <span className={classes('w-2 h-2 rounded-full inline-block', PRESENCE.currentDot)} />
              <span className={PRESENCE.currentText}>{displayOnlineCount}</span>
            </span>
            <span className="text-retro-muted">/</span>
            <span className={classes('text-retro-muted', connectingCount > 0 && PRESENCE.connectingText)} title="Players with a connection in flight">
              {connectingCount} connecting
            </span>
          </div>
        )}
      </div>

      {!collapsed && (
        <>
      {/* Quick Search */}
      <div className="p-2.5 border-b border-edge shrink-0">
        <div className="flex items-center gap-2 bg-surface-raised border border-edge rounded-md px-2.5 py-1.5 text-xs text-retro-body">
          <Search className="w-3.5 h-3.5 text-retro-muted shrink-0" />
          <input
            type="text"
            aria-label="Search players"
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
          <FeedbackState
            compact
            title={searchQuery ? `No players matching "${searchQuery}"` : 'No players online or connecting right now'}
          />
        ) : (
          filteredPlayers.map((player) => {
            const isSelf = identity?.orbitId === player.id;
            const knownName = player.display_name?.trim();
            const usableName = knownName && knownName.toLowerCase() !== 'user' ? knownName : null;
            const displayName = usableName || (isSelf ? 'You' : generateFallbackName(player.id));
            const pfp = player.pfp_url || profilePics[player.id];
            // Only a SETTLED live path may claim a route; a dial in flight has
            // no transport to name yet.
            const connecting = swarmTransportRegistry.phaseFor(player.id) === 'connecting-direct';
            const route = player.online && !connecting ? swarmTransportLabel(player.id) : null;

            return (
              <div
                key={player.id}
                data-testid="chat-player-row"
                className="group flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-glass-w8 active:bg-glass-w12 transition-colors"
              >
                <button
                  type="button"
                  onClick={() => handlePlayerClick(player)}
                  title={`View ${displayName}'s profile`}
                  className="flex items-center gap-2.5 flex-1 min-w-0 text-left cursor-pointer"
                >
                  {/* Avatar with Status Indicator Dot */}
                  <div className="relative shrink-0">
                    <Avatar
                      id={player.id}
                      size={32}
                      imageUrl={pfp}
                    />
                    <span
                      className={classes(
                        'absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-surface-raised',
                        connecting ? PRESENCE.connectingDot : player.online ? PRESENCE.currentDot : PRESENCE.idleDot,
                      )}
                      aria-label={connecting ? 'Connecting' : player.online ? 'Online' : 'Offline'}
                    />
                  </div>

                  {/* Player details */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 justify-between">
                      <span className="text-xs font-medium text-retro-body group-hover:text-retro-fg truncate">
                        {displayName}
                      </span>
                      {isSelf && (
                        <span className="text-2xs font-semibold text-retro-accent shrink-0 px-1 py-0.2 rounded bg-glass-w8">
                          You
                        </span>
                      )}
                    </div>
                    <span className="block text-2xs text-retro-muted truncate tabular-nums">
                      {connecting ? (
                        <span className={classes(PRESENCE.connectingText, 'font-medium')}>Connecting…</span>
                      ) : player.online ? (
                        <>
                          <span className={classes(PRESENCE.currentText, 'font-medium')}>Active now</span>
                          {route && <span> · {route}</span>}
                        </>
                      ) : (
                        <span>Seen {formatRelativeTime(player.last_seen)}</span>
                      )}
                    </span>
                  </div>
                </button>

                {/* Row actions. Always visible on touch (no hover), revealed on
                    hover/focus for pointer devices. Each has its own label. */}
                {!isSelf && (
                  <div className="flex items-center gap-0.5 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100 transition-opacity">
                    <button
                      type="button"
                      title={`Message ${displayName}`}
                      aria-label={`Message ${displayName}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        playPress(800);
                        onMessagePlayer?.({ orbitId: player.id, name: player.display_name, pfp });
                      }}
                      className="p-1.5 rounded-md text-retro-muted hover:text-retro-fg hover:bg-glass-w12 cursor-pointer"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      title={inviteUnavailableReason || `Invite ${displayName} to a game`}
                      aria-label={`Invite ${displayName} to a game`}
                      aria-disabled={!onInvitePlayer || !!inviteUnavailableReason}
                      disabled={!onInvitePlayer || !!inviteUnavailableReason}
                      onClick={(e) => {
                        e.stopPropagation();
                        playPress(820);
                        onInvitePlayer?.(player.id);
                      }}
                      className="p-1.5 rounded-md text-retro-muted hover:text-retro-fg hover:bg-glass-w12 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                    >
                      <Swords className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
        </>
      )}
    </div>
  );
}
