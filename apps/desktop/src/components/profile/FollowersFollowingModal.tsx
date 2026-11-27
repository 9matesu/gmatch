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
import {
  classes, COLOR, GAP, ICON, MONO, PADDING, PADDING_X, PADDING_Y,
  RADIUS, SHADOW, STATUS, TRANSITION, TYPE, WEIGHT,
} from '../../ui/tokens';

/** One chrome recipe per repeated shape — no per-call colour/size/weight. */
const OVERLAY = classes(
  'fixed inset-0 z-[var(--z-modal)] flex items-center justify-center',
  'backdrop-blur-sm p-3 sm:p-4 select-none font-sans animate-orbit-fade-in',
  COLOR.scrim,
);
const DIALOG = classes(
  'bg-glass backdrop-blur-2xl border w-full max-w-md overflow-hidden flex flex-col',
  'max-h-[88vh] animate-orbit-slide-up',
  COLOR.edge, RADIUS.panel, SHADOW.sheet, COLOR.fg,
);
const LIST_TAB = classes(
  'flex-1 py-1.5 text-center cursor-pointer',
  TYPE.body, WEIGHT.medium, TRANSITION.micro, RADIUS.chip,
);

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
      className={OVERLAY}
      onClick={onClose}
    >
      <div
        className={DIALOG}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header Bar */}
        <div className={classes('flex items-center justify-between shrink-0 border-b', PADDING_X[4], PADDING_Y[3], COLOR.edge)}>
          <div className={classes('flex items-center min-w-0', GAP[2])}>
            <Users className={classes(ICON.md, COLOR.muted, 'shrink-0')} />
            <div className="min-w-0">
              <h3 className={classes(TYPE.sub, WEIGHT.medium, COLOR.fg, 'capitalize')}>
                {activeTab}
              </h3>
              {isTargetMode && targetDisplayName && (
                <p className={classes(TYPE.caption, COLOR.muted, 'truncate')}>
                  @{targetDisplayName}
                </p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className={classes('p-1 cursor-pointer', RADIUS.chip, COLOR.muted, COLOR.hoverFg)}
            aria-label="Close"
          >
            <X className={ICON.md} />
          </button>
        </div>

        {/* Tab Selector */}
        <div className={classes('flex border-b shrink-0', COLOR.edge)}>
          <button
            type="button"
            onClick={() => {
              playPress(650);
              setActiveTab('followers');
            }}
            className={classes(LIST_TAB, activeTab === 'followers'
              ? classes(COLOR.glassW12, COLOR.fg)
              : classes(COLOR.muted, COLOR.hoverFg),
            )}
          >
            <span>{followerRows.length} Followers</span>
          </button>

          <button
            type="button"
            onClick={() => {
              playPress(650);
              setActiveTab('following');
            }}
            className={classes(LIST_TAB, activeTab === 'following'
              ? classes(COLOR.glassW12, COLOR.fg)
              : classes(COLOR.muted, COLOR.hoverFg),
            )}
          >
            <span>{followingRows.length} Following</span>
          </button>
        </div>

        {/* Search Bar Input */}
        <div className={classes('border-b shrink-0', PADDING_X[3], PADDING_Y[2], COLOR.edge)}>
          <div className={classes(
            'flex items-center border focus-within:border-edge',
            GAP[2], COLOR.interactive, RADIUS.control,
            PADDING_X[3], PADDING_Y[1.5], TYPE.body, COLOR.fg, COLOR.edge, TRANSITION.micro,
          )}>
            <Search className={classes(ICON.sm, COLOR.muted, 'shrink-0')} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search..."
              className={classes('w-full bg-transparent border-none outline-none placeholder:text-retro-muted', TYPE.body, WEIGHT.medium)}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className={classes('p-0.5', COLOR.muted, COLOR.hoverBody)}
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* User Rows List */}
        <div className={classes('flex-1 overflow-y-auto space-y-1 styled-scrollbar', PADDING[3])}>
          {networkLoading && filteredList.length === 0 && (
            <div className={classes('py-14 text-center space-y-3')}>
              <div className={classes('w-7 h-7 border-2 border-t-transparent animate-spin mx-auto', RADIUS.pill, COLOR.accentEdge)} />
              <p className={classes(TYPE.body, COLOR.muted)}>Loading {activeTab}...</p>
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
                className={classes('flex items-center justify-between group', PADDING[2], RADIUS.panel, COLOR.hoverW5, TRANSITION.micro)}
              >
                {/* User Avatar + Display Name. A real button: this was a
                    clickable div with only a title, so it had no accessible
                    name and no way to be targeted by a test. */}
                <button
                  type="button"
                  onClick={() => handleAvatarClick(user.id)}
                  aria-label={`View profile of ${user.display_name?.trim() || 'user'}`}
                  className={classes('flex items-center text-left min-w-0 flex-1 cursor-pointer', GAP[3])}
                >
                  <div
                    className={classes(
                      'w-11 h-11 p-[2px] shrink-0 transition-transform group-hover:scale-105',
                      RADIUS.pill, hasStory ? classes(COLOR.accentBg, SHADOW.xs) : COLOR.glassW20,
                    )}
                  >
                    <div className={classes(
                      'w-full h-full overflow-hidden border flex items-center justify-center',
                      RADIUS.pill, COLOR.surfaceRaised, COLOR.edge, TYPE.body, WEIGHT.heading, COLOR.fg,
                    )}>
                      {userPfp ? (
                        <img src={resolveMediaUrl(userPfp)} alt="" className="w-full h-full object-cover" />
                      ) : (
                        (user.display_name || user.id).charAt(0).toUpperCase()
                      )}
                    </div>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className={classes('flex items-center', GAP[1])}>
                      <span className={classes(TYPE.body, WEIGHT.bold, COLOR.fg, 'truncate hover:underline')}>
                        @{user.display_name?.trim() || 'Unknown User'}
                      </span>
                      {user.online && (
                        <span className={classes('w-1.5 h-1.5 shrink-0', RADIUS.pill, 'bg-success')} />
                      )}
                      {(user.matches_won ?? 0) > 5 && (
                        <CheckCircle2 className={classes(ICON.sm, STATUS.info, 'fill-info shrink-0')} />
                      )}
                    </div>

                    <div className={classes('flex items-center truncate', GAP[2], TYPE.body, COLOR.muted, MONO)}>
                      <span>{user.id.slice(0, 12)}...</span>
                      {user.score ? (
                        <span className={classes(STATUS.warning, WEIGHT.bold, 'font-sans')}>
                          g$ {user.score}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </button>

                {/* Action Buttons */}
                <div className={classes('flex items-center shrink-0 ml-2', GAP[1.5])}>
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
                      className={classes(
                        'p-2 cursor-pointer', RADIUS.panel, TRANSITION.micro,
                        COLOR.muted, COLOR.hoverFg, COLOR.hoverW12Soft,
                      )}
                    >
                      <MessageCircle className={ICON.md} />
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
                      className={classes(
                        'p-2 cursor-pointer', RADIUS.panel, TRANSITION.micro,
                        COLOR.muted, STATUS.info, STATUS.warningHoverSoft,
                      )}
                    >
                      <Send className={ICON.md} />
                    </button>
                  )}

                  {/* Follow / Following Toggle Button */}
                  {!isSelf && onToggleFollow && (
                    <button
                      type="button"
                      onClick={() => handleToggleFollow(user)}
                      className={classes(
                        'px-3.5 py-1.5 cursor-pointer flex items-center border',
                        GAP[1], RADIUS.panel, TYPE.body, WEIGHT.bold, TRANSITION.micro,
                        isFollowing
                          ? classes(COLOR.interactive, STATUS.dangerHoverHard, COLOR.fg, STATUS.dangerFgHover, COLOR.edge)
                          : classes(COLOR.accentBg, COLOR.accentHover, COLOR.onAccent, 'border-transparent', SHADOW.xs),
                      )}
                    >
                      {isFollowing ? (
                        <>
                          <UserCheck className={ICON.sm} />
                          <span>Following</span>
                        </>
                      ) : (
                        <>
                          <UserPlus className={ICON.sm} />
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
              <Search className={classes('w-8 h-8 mx-auto', COLOR.body)} />
              <p className={classes(TYPE.body, WEIGHT.bold, COLOR.body)}>No results found</p>
              <p className={classes(TYPE.body, COLOR.muted)}>
                No users found matching &ldquo;{searchQuery}&rdquo;
              </p>
            </div>
          )}

          {/* Empty List State */}
          {filteredList.length === 0 && !searchQuery && !networkLoading && (
            <div className={classes('py-14 text-center space-y-3', PADDING_X[4])}>
              <div className={classes('w-12 h-12 flex items-center justify-center mx-auto', RADIUS.pill, COLOR.interactive, COLOR.muted)}>
                <Users className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h4 className={classes(TYPE.sub, WEIGHT.bold, COLOR.fg)}>
                  {activeTab === 'followers' ? 'No Followers Yet' : 'Not Following Anyone'}
                </h4>
                <p className={classes(TYPE.body, COLOR.muted, 'max-w-xs mx-auto')}>
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