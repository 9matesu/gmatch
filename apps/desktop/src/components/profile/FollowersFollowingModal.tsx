"use client";

import React, { useState, useMemo, useEffect } from 'react';
import type { User, OrbitObject, Relationship } from '@orbit/shared';
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

export interface FollowersFollowingModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'followers' | 'following';
  currentUserId?: string;
  users: User[];
  followingIds: string[];
  relationships?: Relationship[];
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

interface NetworkUser {
  id: string;
  display_name: string | null;
  pfp_url: string | null;
  online: boolean;
  is_following: boolean;
}

export function FollowersFollowingModal({
  isOpen,
  onClose,
  initialTab = 'followers',
  currentUserId = '',
  users = [],
  followingIds = [],
  relationships = [],
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
  const [networkFollowers, setNetworkFollowers] = useState<NetworkUser[]>([]);
  const [networkFollowing, setNetworkFollowing] = useState<NetworkUser[]>([]);
  const [networkLoading, setNetworkLoading] = useState(false);

  // Keep activeTab in sync with initialTab when opened
  React.useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
      setSearchQuery('');
    }
  }, [isOpen, initialTab]);

  // When viewing a specific user's network, fetch their real followers/following.
  useEffect(() => {
    if (!isOpen || !targetUserId || !identity) {
      setNetworkFollowers([]);
      setNetworkFollowing([]);
      setNetworkLoading(false);
      return;
    }
    let cancelled = false;
    setNetworkLoading(true);
    Promise.all([
      orbitFetch(`/api/users/${encodeURIComponent(targetUserId)}/followers`, {}, identity)
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []),
      orbitFetch(`/api/users/${encodeURIComponent(targetUserId)}/following`, {}, identity)
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
  }, [isOpen, targetUserId, identity]);

  // Derive Following Users: all users whose id is in followingIds
  const followingUsers = useMemo<User[]>(() => {
    const set = new Set(followingIds);
    const matched = users.filter((u) => set.has(u.id) || set.has((u as any).orbitId));
    // For any ID in followingIds not in users list, provide fallback
    const matchedIds = new Set(matched.map((u) => u.id));
    const missing: User[] = followingIds
      .filter((id) => id && !matchedIds.has(id))
      .map((id) => ({
        id,
        publicKey: id,
        createdAt: new Date().toISOString(),
        display_name: 'Unknown User',
        tags: ['peer'],
        online: false,
        score: 0,
        matches_won: 0,
        matches_lost: 0,
        likes_received: 0,
      }));
    return [...matched, ...missing];
  }, [users, followingIds]);

  // Derive Followers Users: users who have liked/interacted with current user or in relationships
  const followersUsers = useMemo<User[]>(() => {
    const followerIdSet = new Set<string>();

    // From relationships
    for (const rel of relationships) {
      if (rel.user?.id) followerIdSet.add(rel.user.id);
    }

    // Fallback: If no server relationships yet, provide users with high affinity/interaction
    if (followerIdSet.size === 0 && users.length > 0) {
      users.slice(0, 5).forEach((u) => {
        if (u.id !== currentUserId) followerIdSet.add(u.id);
      });
    }

    const matched = users.filter((u) => followerIdSet.has(u.id) || followerIdSet.has((u as any).orbitId));
    const matchedIds = new Set(matched.map((u) => u.id));
    const missing: User[] = Array.from(followerIdSet)
      .filter((id) => id && !matchedIds.has(id))
      .map((id) => ({
        id,
        publicKey: id,
        createdAt: new Date().toISOString(),
        display_name: 'Unknown User',
        tags: ['follower'],
        online: false,
        score: 0,
        matches_won: 0,
        matches_lost: 0,
        likes_received: 0,
      }));

    return [...matched, ...missing];
  }, [users, relationships, currentUserId]);

  const isTargetMode = Boolean(targetUserId);
  const localList = activeTab === 'followers' ? followersUsers : followingUsers;
  const targetList = activeTab === 'followers' ? networkFollowers : networkFollowing;
  const activeList: Array<User | NetworkUser> = isTargetMode ? targetList : localList;

  // Filter list by search query
  const filteredList = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return activeList;
    return activeList.filter((u) => {
      const name = (u.display_name || '').toLowerCase();
      const id = (u.id || '').toLowerCase();
      const tags = (Array.isArray((u as any).tags) ? (u as any).tags.join(' ') : (u as any).tags || '').toLowerCase();
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

  const handleToggleFollow = (u: User | NetworkUser) => {
    playPress(800);
    onToggleFollow?.(u.id);
    if (!isTargetMode) return;
    const flip = (arr: NetworkUser[]) =>
      arr.map((x) => (x.id === u.id ? { ...x, is_following: !x.is_following } : x));
    if (activeTab === 'followers') setNetworkFollowers(flip);
    else setNetworkFollowing(flip);
  };

  return (
    <div
      className="fixed inset-0 z-[var(--z-system)] flex items-center justify-center bg-black/75 backdrop-blur-md p-3 sm:p-4 select-none font-sans animate-orbit-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-glass backdrop-blur-2xl border border-border-glass w-full max-w-md rounded-2xl overflow-hidden shadow-2xl flex flex-col text-retro-fg max-h-[88vh] animate-orbit-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header Bar */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-glass shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Users className="w-4 h-4 text-retro-muted shrink-0" />
            <div className="min-w-0">
              <h3 className="text-sm font-medium text-retro-fg capitalize">
                {activeTab}
              </h3>
              {isTargetMode && targetDisplayName && (
                <p className="text-[10px] text-retro-muted truncate">
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
        <div className="flex border-b border-border-glass shrink-0">
          <button
            type="button"
            onClick={() => {
              playPress(650);
              setActiveTab('followers');
            }}
            className={`flex-1 py-2.5 text-xs font-medium transition-colors cursor-pointer text-center relative border-b-2 ${activeTab === 'followers'
                ? 'text-retro-fg border-retro-accent'
                : 'text-retro-muted hover:text-retro-fg border-transparent'
              }`}
          >
            <span>{isTargetMode ? networkFollowers.length : followersUsers.length} Followers</span>
          </button>

          <button
            type="button"
            onClick={() => {
              playPress(650);
              setActiveTab('following');
            }}
            className={`flex-1 py-2.5 text-xs font-medium transition-colors cursor-pointer text-center relative border-b-2 ${activeTab === 'following'
                ? 'text-retro-fg border-retro-accent'
                : 'text-retro-muted hover:text-retro-fg border-transparent'
              }`}
          >
            <span>{isTargetMode ? networkFollowing.length : followingUsers.length} Following</span>
          </button>
        </div>

        {/* Search Bar Input */}
        <div className="px-3 py-2 border-b border-border-glass shrink-0">
          <div className="flex items-center gap-2 bg-surface-interactive rounded-lg px-3 py-1.5 text-xs text-retro-fg focus-within:border-zinc-500 border border-border-glass transition-colors">
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
          {isTargetMode && networkLoading && filteredList.length === 0 && (
            <div className="py-14 text-center space-y-3">
              <div className="w-7 h-7 border-2 border-retro-accent border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-xs text-retro-muted">Loading {activeTab}…</p>
            </div>
          )}
          {filteredList.map((user) => {
            const isFollowing = isTargetMode
              ? Boolean((user as NetworkUser).is_following)
              : followingIds.includes(user.id) || followingIds.includes((user as any).orbitId);
            const userPfp = isTargetMode
              ? (user as NetworkUser).pfp_url
              : profilePics[user.id] || (user as any).avatar_url;
            const hasStory = (stories || []).some(
              (s) => s.owner_id === user.id || (s as any).user_id === user.id
            );
            const isSelf = user.id === currentUserId;

            return (
              <div
                key={user.id}
                className="flex items-center justify-between p-2 rounded-2xl hover:bg-glass-w5 transition-colors group"
              >
                {/* User Avatar + Display Name */}
                <div
                  className="flex items-center gap-3 cursor-pointer min-w-0 flex-1"
                  onClick={() => handleAvatarClick(user.id)}
                  title={hasStory ? 'Watch live story' : 'View profile'}
                >
                  <div
                    className={`w-11 h-11 rounded-full p-[2px] shrink-0 transition-transform group-hover:scale-105 ${hasStory
                        ? 'bg-gradient-to-tr from-cyan-500 via-teal-500 to-amber-500 shadow-xs'
                        : 'bg-zinc-700'
                      }`}
                  >
                    <div className="w-full h-full rounded-full bg-surface-raised overflow-hidden border border-white flex items-center justify-center text-xs font-black text-retro-fg">
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
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                      )}
                      {(user as any).matches_won > 5 && (
                        <CheckCircle2 className="w-3.5 h-3.5 text-blue-500 fill-blue-500 shrink-0" />
                      )}
                    </div>

                    <div className="flex items-center gap-2 text-[11px] text-retro-muted truncate font-mono">
                      <span>{user.id.slice(0, 12)}...</span>
                      {(user as any).score ? (
                        <span className="text-amber-600 font-bold font-sans">
                          g$ {(user as any).score}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>

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
                      className="p-2 text-retro-muted hover:text-retro-fg rounded-xl hover:bg-white/15/80 transition-colors cursor-pointer"
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
                      className="p-2 text-retro-muted hover:text-cyan-400 rounded-xl hover:bg-amber-500/20 transition-colors cursor-pointer"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  )}

                  {/* Follow / Following Toggle Button */}
                  {!isSelf && onToggleFollow && (
                    <button
                      type="button"
                      onClick={() => handleToggleFollow(user)}
                      className={`px-3.5 py-1.5 text-xs font-bold rounded-xl transition-all cursor-pointer flex items-center gap-1 ${isFollowing
                          ? 'bg-surface-interactive hover:bg-rose-50 text-retro-fg hover:text-rose-600 border border-border-glass'
                          : 'bg-gradient-to-r from-cyan-500 via-teal-500 to-amber-500 hover:opacity-95 text-white shadow-xs'
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
          {filteredList.length === 0 && searchQuery && !(isTargetMode && networkLoading) && (
            <div className="py-12 text-center space-y-2">
              <Search className="w-8 h-8 text-retro-body mx-auto" />
              <p className="text-xs font-bold text-retro-body">No results found</p>
              <p className="text-[11px] text-retro-muted">
                No users found matching &ldquo;{searchQuery}&rdquo;
              </p>
            </div>
          )}

          {/* Empty List State */}
          {filteredList.length === 0 && !searchQuery && !(isTargetMode && networkLoading) && (
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
