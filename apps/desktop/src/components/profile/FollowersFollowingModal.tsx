"use client";

import React, { useState, useMemo, useEffect } from 'react';
import type { User, OrbitObject } from '@orbit/shared';
import type { OrbitIdentity } from '@orbit/crypto';
import {
  X,
  Search,
  UserCheck,
  UserPlus,
  MessageCircle,
  Send,
  Users,
  CheckCircle2,
} from 'lucide-react';
import { playPress } from '../../utils/sounds';
import { resolveMediaUrl } from '../../utils/media';
import { orbitFetch } from '../../utils/api';
import { mergeFollowIds, mergeFollowRows, type FollowListRow, type FollowListSourceRow } from '../../utils/followList';
import { usePeerFollowEdges } from '../../hooks/usePeerFollows';

export interface FollowersFollowingModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'followers' | 'following';
  currentUserId?: string;
  users: User[];
  followingIds: string[];
  profilePics?: Record<string, string>;
  stories?: OrbitObject[];
  onToggleFollow?: (userId: string) => void;
  onSelectUser?: (userId: string) => void;
  onOpenStory?: (userId: string) => void;
  onStartPm?: (user: { id: string; display_name?: string }) => void;
  onSendCard?: (userId: string) => void;
  toast?: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  identity?: OrbitIdentity | null;
  targetUserId?: string | null;
  targetDisplayName?: string | null;
}

export function FollowersFollowingModal({
  isOpen,
  onClose,
  initialTab = 'followers',
  currentUserId = '',
  users,
  followingIds = [],
  profilePics = {},
  stories = [],
  onToggleFollow,
  onSelectUser,
  onOpenStory,
  onStartPm,
  onSendCard,
  identity,
  targetUserId,
  targetDisplayName,
}: FollowersFollowingModalProps) {
  const [activeTab, setActiveTab] = useState<'followers' | 'following'>(initialTab);
  const [searchQuery, setSearchQuery] = useState('');
  const [networkFollowers, setNetworkFollowers] = useState<FollowListSourceRow[]>([]);
  const [networkFollowing, setNetworkFollowing] = useState<FollowListSourceRow[]>([]);
  const [networkLoading, setNetworkLoading] = useState(false);
  // This modal's own optimistic nudge for the Follow button. The durable truth
  // is `followingIds` (already the node list merged with my signed follows); the
  // override only keeps the button from lagging one render behind the click.
  const [followOverrides, setFollowOverrides] = useState<Record<string, boolean>>({});

  // Keep activeTab in sync with initialTab when opened
  React.useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
      setSearchQuery('');
      setFollowOverrides({});
    }
  }, [isOpen, initialTab]);

  // The list ALWAYS comes from the server (Followers table): the old local
  // derivation (relationships + users.slice(0,5) fallback) showed a stale,
  // fabricated network — the "modal desatualizado" bug. Own profile fetches
  // under currentUserId; viewing someone else fetches under targetUserId.
  // The node's rows are then merged with the peer operation log below, because
  // a follow made while the node was unreachable never reached that table.
  const listUserId = targetUserId || currentUserId
  useEffect(() => {
    if (!isOpen || !listUserId || !identity) {
      setNetworkFollowers([])
      setNetworkFollowing([])
      setNetworkLoading(false)
      return;
    }
    let cancelled = false;
    setNetworkLoading(true);
    Promise.all([
      orbitFetch(`/api/users/${encodeURIComponent(listUserId)}/followers`, {}, identity)
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []),
      orbitFetch(`/api/users/${encodeURIComponent(listUserId)}/following`, {}, identity)
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []),
    ])
      .then(([followers, following]) => {
        if (cancelled) return;
        setNetworkFollowers(Array.isArray(followers) ? followers : []);
        setNetworkFollowing(Array.isArray(following) ? following : []);
      })
      .finally(() => {
        if (!cancelled) setNetworkLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, listUserId, identity]);

  // Both tabs are local-first: the node's list UNION what the peers signed,
  // MINUS what the peers withdrew. An id that exists only as an operation still
  // gets a row (named from the roster, never a truncated hash), so a follow made
  // off-node shows up here instead of vanishing until the next successful sync.
  const peerEdges = usePeerFollowEdges(isOpen ? listUserId : null);

  const followerRows = useMemo(
    () => mergeFollowRows(
      networkFollowers,
      mergeFollowIds(networkFollowers.map((u) => u.id), {
        added: peerEdges.followers,
        removed: peerEdges.withdrawnFollowers,
      }),
      users,
      profilePics,
    ),
    [networkFollowers, peerEdges, users, profilePics],
  );

  const followingRows = useMemo(
    () => mergeFollowRows(
      networkFollowing,
      mergeFollowIds(networkFollowing.map((u) => u.id), {
        added: peerEdges.following,
        removed: peerEdges.withdrawnFollowing,
      }),
      users,
      profilePics,
    ),
    [networkFollowing, peerEdges, users, profilePics],
  );

  const activeList: FollowListRow[] =
    activeTab === 'followers' ? followerRows : followingRows;

  const isTargetMode = Boolean(targetUserId);

  // Filter list by search query
  const filteredList = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return activeList;
    return activeList.filter((u) => {
      const name = (u.display_name || '').toLowerCase();
      const id = (u.id || '').toLowerCase();
      const tags = (Array.isArray(u.tags) ? u.tags.join(' ') : '').toLowerCase();
      return name.includes(q) || id.includes(q) || tags.includes(q);
    });
  }, [activeList, searchQuery]);

  if (!isOpen) return null;

  const handleAvatarClick = (uId: string) => {
    playPress(750);
    const hasStories = (stories || []).some(
      (s) => s.owner_id === uId || (s as any).user_id === uId
    );
    if (hasStories && onOpenStory) {
      onClose();
      onOpenStory(uId);
    } else if (onSelectUser) {
      onClose();
      onSelectUser(uId);
    }
  };

  const handleToggleFollow = (u: FollowListRow) => {
    playPress(800);
    onToggleFollow?.(u.id);
    const current = followOverrides[u.id] ?? followingIds.includes(u.id);
    setFollowOverrides((prev) => ({ ...prev, [u.id]: !current }));
  };

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-black/70 backdrop-blur-sm p-3 sm:p-4 select-none font-sans animate-orbit-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-glass backdrop-blur-2xl border border-edge w-full max-w-md rounded-xl overflow-hidden shadow-2xl flex flex-col text-retro-fg max-h-[88vh] animate-orbit-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header Bar */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-edge shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Users className="w-4 h-4 text-retro-muted shrink-0" />
            <div className="min-w-0">
              <h3 className="text-sm font-medium text-retro-fg capitalize">
                {activeTab}
              </h3>
              {isTargetMode && targetDisplayName && (
                <p className="text-2xs text-retro-muted truncate">
                  @{targetDisplayName}
                </p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1 text-retro-muted hover:text-retro-fg rounded cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Selector */}
        <div className="flex border-b border-edge shrink-0">
          <button
            type="button"
            onClick={() => {
              playPress(650);
              setActiveTab('followers');
            }}
            className={`flex-1 py-1.5 text-xs font-medium transition-colors cursor-pointer text-center rounded-md ${activeTab === 'followers'
                ? 'bg-glass-w12 text-retro-fg'
                : 'text-retro-muted hover:text-retro-fg'
              }`}
          >
            <span>{followerRows.length} Followers</span>
          </button>

          <button
            type="button"
            onClick={() => {
              playPress(650);
              setActiveTab('following');
            }}
            className={`flex-1 py-1.5 text-xs font-medium transition-colors cursor-pointer text-center rounded-md ${activeTab === 'following'
                ? 'bg-glass-w12 text-retro-fg'
                : 'text-retro-muted hover:text-retro-fg'
              }`}
          >
            <span>{followingRows.length} Following</span>
          </button>
        </div>

        {/* Search Bar Input */}
        <div className="px-3 py-2 border-b border-edge shrink-0">
          <div className="flex items-center gap-2 bg-surface-interactive rounded-lg px-3 py-1.5 text-xs text-retro-fg focus-within:border-edge border border-edge transition-colors">
            <Search className="w-3.5 h-3.5 text-retro-muted shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search..."
              className="w-full bg-transparent border-none outline-none text-xs placeholder:text-retro-muted font-medium"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="text-retro-muted hover:text-retro-body p-0.5"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* User Rows List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1 styled-scrollbar">
          {networkLoading && filteredList.length === 0 && (
            <div className="py-14 text-center space-y-3">
              <div className="w-7 h-7 border-2 border-retro-accent border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-xs text-retro-muted">Loading {activeTab}...</p>
            </div>
          )}
          {filteredList.map((user) => {
            const isFollowing = followOverrides[user.id] ?? followingIds.includes(user.id);
            const userPfp = user.pfp_url;
            const hasStory = (stories || []).some(
              (s) => s.owner_id === user.id || (s as any).user_id === user.id
            );
            const isSelf = user.id === currentUserId;

            return (
              <div
                key={user.id}
                className="flex items-center justify-between p-2 rounded-xl hover:bg-glass-w5 transition-colors group"
              >
                {/* User Avatar + Display Name. A real button: this was a
                    clickable div with only a title, so it had no accessible
                    name and no way to be targeted by a test. */}
                <button
                  type="button"
                  onClick={() => handleAvatarClick(user.id)}
                  aria-label={`View profile of ${user.display_name?.trim() || 'user'}`}
                  className="flex items-center gap-3 text-left min-w-0 flex-1 cursor-pointer"
                >
                  <div
                    className={`w-11 h-11 rounded-full p-[2px] shrink-0 transition-transform group-hover:scale-105 ${hasStory
                        ? 'bg-retro-accent shadow-xs'
                        : 'bg-glass-w20'
                      }`}
                  >
                    <div className="w-full h-full rounded-full bg-surface-raised overflow-hidden border border-edge flex items-center justify-center text-xs font-black text-retro-fg">
                      {userPfp ? (
                        <img src={resolveMediaUrl(userPfp)} alt="" className="w-full h-full object-cover" />
                      ) : (
                        (user.display_name || user.id).charAt(0).toUpperCase()
                      )}
                    </div>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1">
                      <span className="text-xs font-bold text-retro-fg truncate hover:underline">
                        @{user.display_name?.trim() || 'Unknown User'}
                      </span>
                      {user.online && (
                        <span className="w-1.5 h-1.5 rounded-full bg-success shrink-0" />
                      )}
                      {(user.matches_won ?? 0) > 5 && (
                        <CheckCircle2 className="w-3.5 h-3.5 text-info-fg fill-info shrink-0" />
                      )}
                    </div>

                    <div className="flex items-center gap-2 text-xs text-retro-muted truncate font-mono">
                      <span>{user.id.slice(0, 12)}...</span>
                      {user.score ? (
                        <span className="text-warning-fg font-bold font-sans">
                          g$ {user.score}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </button>

                {/* Action Buttons */}
                <div className="flex items-center gap-1.5 shrink-0 ml-2">
                  {/* Quick Message Button */}
                  {onStartPm && !isSelf && (
                    <button
                      type="button"
                      onClick={() => {
                        playPress(750);
                        onClose();
                        onStartPm({ id: user.id, display_name: user.display_name || undefined });
                      }}
                      title="Send Private Message"
                      className="p-2 text-retro-muted hover:text-retro-fg rounded-xl hover:bg-glass-w12/80 transition-colors cursor-pointer"
                    >
                      <MessageCircle className="w-4 h-4" />
                    </button>
                  )}

                  {/* Quick Send Card Button */}
                  {onSendCard && !isSelf && (
                    <button
                      type="button"
                      onClick={() => {
                        playPress(750);
                        onClose();
                        onSendCard(user.id);
                      }}
                      title="Send Duel Card"
                      className="p-2 text-retro-muted hover:text-info-fg rounded-xl hover:bg-warning/20 transition-colors cursor-pointer"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  )}

                  {/* Follow / Following Toggle Button */}
                  {!isSelf && onToggleFollow && (
                    <button
                      type="button"
                      onClick={() => handleToggleFollow(user)}
                      className={`px-3.5 py-1.5 text-xs font-bold rounded-xl transition cursor-pointer flex items-center gap-1 ${isFollowing
                          ? 'bg-surface-interactive hover:bg-danger text-retro-fg hover:text-danger-fg border border-edge'
                          : 'bg-retro-accent hover:bg-retro-accent-hover text-retro-accent-text shadow-xs'
                        }`}
                    >
                      {isFollowing ? (
                        <>
                          <UserCheck className="w-3.5 h-3.5" />
                          <span>Following</span>
                        </>
                      ) : (
                        <>
                          <UserPlus className="w-3.5 h-3.5" />
                          <span>Follow</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {/* Empty Search Results State */}
          {filteredList.length === 0 && searchQuery && !(networkLoading) && (
            <div className="py-12 text-center space-y-2">
              <Search className="w-8 h-8 text-retro-body mx-auto" />
              <p className="text-xs font-bold text-retro-body">No results found</p>
              <p className="text-xs text-retro-muted">
                No users found matching &ldquo;{searchQuery}&rdquo;
              </p>
            </div>
          )}

          {/* Empty List State */}
          {filteredList.length === 0 && !searchQuery && !networkLoading && (
            <div className="py-14 text-center space-y-3 px-4">
              <div className="w-12 h-12 rounded-full bg-surface-interactive flex items-center justify-center mx-auto text-retro-muted">
                <Users className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-retro-fg">
                  {activeTab === 'followers' ? 'No Followers Yet' : 'Not Following Anyone'}
                </h4>
                <p className="text-xs text-retro-muted max-w-xs mx-auto">
                  {isTargetMode
                    ? (activeTab === 'followers'
                        ? 'This profile has no followers yet.'
                        : 'This profile is not following anyone yet.')
                    : activeTab === 'followers'
                      ? 'When people follow you or match with your duel cards, they will appear here.'
                      : 'Discover creators and duelists in the feed, games lounge, or leaderboard!'}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}