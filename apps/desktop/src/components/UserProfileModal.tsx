"use client";

import React, { useState, useEffect, useCallback } from 'react';
import type { OrbitIdentity } from '@orbit/crypto';
import { parseTags, type User, type OrbitObject } from '@orbit/shared';
import { X, Copy, Check, Star, Ban, Send, Grid, MessageCircle, Play, Swords, Flag } from 'lucide-react';
import { playPress } from '../utils/sounds';
import { resolveMediaUrl } from '../utils/media';
import { ObjectImage } from './ObjectImage';
import { useProfilePostLightbox } from './feed/useProfilePostLightbox';
import type { FeedPost, PostComment } from './feed/GMatchFeed';
import { orbitFetch, invalidateCache } from '../utils/api';
import { isUserOnline, fresherPresence } from '../utils/presence';
import { usePresence } from '../game/presenceStore';

interface UserProfileModalProps {
  user: User | null;
  profilePic?: string;
  isContact?: boolean;
  stories?: OrbitObject[];
  cards?: OrbitObject[];
  posts?: FeedPost[];
  identity?: OrbitIdentity | null;
  onClose: () => void;
  onSendCard?: (userId: string) => void;
  onOpenStories?: (userId: string) => void;
  onToggleContact?: (userId: string) => void;
  onToggleFollow?: (userId: string) => void;
  isFollowing?: boolean;
  onBlockUser?: (userId: string) => void;
  onCopyId?: (id: string) => void;
  onStartPm?: (user: { id: string; display_name?: string }) => void;
  onInviteToGame?: (userId: string) => void;
  onOpenFollowers?: (tab: 'followers' | 'following') => void;
  onReportUser?: (userId: string, name: string) => void;
  followingIds?: string[];
  /**
   * Roster for presence cross-checking. Typed with the presence fields
   * because this modal actually reads them — it used to declare
   * `{id, display_name}` and then cast to `User` to reach `last_seen`.
   */
  users?: Array<{ id: string; display_name?: string; last_seen?: string | null; online?: boolean }>;
  shareGroups?: { id: string; name: string; member_count: number }[];
  onSendDm?: (peerId: string, text: string) => Promise<boolean>;
  onPersistLike?: (postId: string, liked: boolean) => Promise<number | undefined>;
  onPersistSave?: (postId: string, saved: boolean) => void;
  onPersistComment?: (postId: string, text: string) => Promise<PostComment | null>;
  onCopyLink?: (post: FeedPost) => void;
  onReportPost?: (post: FeedPost) => void;
  toast?: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

export function UserProfileModal({
  user,
  profilePic,
  isContact,
  stories = [],
  cards = [],
  posts = [],
  identity = null,
  onClose,
  onSendCard,
  onOpenStories,
  onToggleContact,
  onToggleFollow,
  isFollowing = false,
  onBlockUser,
  onCopyId,
  onStartPm,
  onInviteToGame,
  onOpenFollowers,
  onReportUser,
  followingIds = [],
  users = [],
  shareGroups = [],
  onSendDm,
  onPersistLike,
  onPersistSave,
  onPersistComment,
  onCopyLink,
  onReportPost,
  toast,
}: UserProfileModalProps) {
  const [showPic, setShowPic] = useState(false);
  const [copied, setCopied] = useState(false);
  /** Which profile post is open in the right-hand pane. Kept here (not in the
   *  lightbox hook) so the empty state and the pane share one source. */
  const [activePostId, setActivePostId] = useState<string | null>(null);
  const [selectedCardImage, setSelectedCardImage] = useState<string | null>(null);
  const [followersCount, setFollowersCount] = useState<number | null>(null);
  const [followingCount, setFollowingCount] = useState<number | null>(null);
  // Presence is a function of Date.now(), so a modal opened while someone is
  // online silently becomes wrong as the 60s window passes — with no event to
  // re-render it. Re-evaluate on a timer so the dot tracks reality while open.
  const [presenceTick, setPresenceTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setPresenceTick((t) => t + 1), 15_000);
    return () => window.clearInterval(id);
  }, []);
  // Fully-wired inline expansion (like/save/comment/share/options/likers).
  // z-90: this modal lives at z-system(80), so the sub-modals (share/options/
  // must stack above it instead of the default z-modal(50).
  const { openPost, expandedNode, modals: postLightboxModals } = useProfilePostLightbox({
    identity: identity || null,
    profilePics: profilePic ? { [user?.id || '']: profilePic } : {},
    users,
    followingIds,
    shareGroups,
    toast,
    onPersistLike,
    onPersistSave,
    onPersistComment,
    onSendDm,
    onCopyLink,
    onReportPost,
    zIndexClass: 'z-[90]',
  });

  // Fetch follower/following counts for every profile INCLUDING your own:
  // without this, the own-profile fallback rendered likes_received labeled
  // "followers" (the wrong-count report).
  //
  // Split into a callback + two triggers because the deps are [user, identity]
  // only: a live follow (or any roster change) never re-ran it, so the modal
  // could sit on a stale number while the profile tab moved.
  const loadFollowCounts = useCallback(() => {
    if (!identity || !user) return;
    let cancelled = false;
    // Invalidate first: these GETs are served from the 3s response cache, so a
    // refetch straight after a follow would return the pre-follow lists.
    invalidateCache(`/api/users/${encodeURIComponent(user.id)}/followers`);
    invalidateCache(`/api/users/${encodeURIComponent(user.id)}/following`);
    Promise.all([
      orbitFetch(`/api/users/${encodeURIComponent(user.id)}/followers`, {}, identity)
        .then(r => r.ok ? r.json() : [])
        .catch(() => []),
      orbitFetch(`/api/users/${encodeURIComponent(user.id)}/following`, {}, identity)
        .then(r => r.ok ? r.json() : [])
        .catch(() => []),
    ]).then(([followers, following]) => {
      if (!cancelled) {
        setFollowersCount(Array.isArray(followers) ? followers.length : 0);
        setFollowingCount(Array.isArray(following) ? following.length : 0);
      }
    });
    return () => { cancelled = true; };
  }, [user, identity]);

  useEffect(() => {
    const cleanup = loadFollowCounts();
    return typeof cleanup === 'function' ? cleanup : undefined;
  }, [loadFollowCounts]);

  // Someone followed (or unfollowed) this person while the modal is open.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ follower_id?: string; followee_id?: string }>).detail;
      if (!detail) return;
      if (detail.followee_id !== user?.id && detail.follower_id !== user?.id) return;
      loadFollowCounts();
    };
    window.addEventListener('orbit-follow-event', handler);
    window.addEventListener('orbit-profilesync', handler);
    return () => {
      window.removeEventListener('orbit-follow-event', handler);
      window.removeEventListener('orbit-profilesync', handler);
    };
  }, [loadFollowCounts, user?.id]);

  if (!user) return null;

  const displayName = user.display_name?.trim() || 'Unknown User';
  // Canonical presence via the shared helper, taking whichever record carries
  // the FRESHER sighting. The roster entry is not automatically the better one:
  // the chat hub hands us a 30s-dashboard record while the roster's last_seen
  // only moves when the roster poll commits.
  //
  // `presenceTick` is the clock this read: the interval above re-renders the
  // modal so `Date.now()` advances past the 60s window and the dot tracks
  // reality while the modal stays open. It is deliberately not a dependency —
  // it is the trigger, not the input.
  // One presence source for the whole app. The store already holds the newest
  // sighting this client has seen for anyone, from every feed (shared
  // dashboard poll, peer updates, the user directory), so the modal does not
  // have to re-derive an answer from whichever object the opener happened to
  // hand it — the reason the same person showed "Online" in the chat list and
  // "Offline" here. The local fresherPresence/user check is kept only as a
  // fallback for a user the store has never seen.
  const storeOnline = usePresence((s) => s.isOnline(user.id, Date.now()));
  const storeKnows = usePresence((s) => s.records.has(user.id));
  const liveUser = fresherPresence(user, users?.find((u) => u.id === user.id));
  const isOnline = storeKnows ? storeOnline : isUserOnline(liveUser as User | undefined, Date.now());
  void presenceTick;
  const tags: string[] = parseTags(user.tags);
  const userStories = stories.filter((s) => s.owner_id === user.id || (s as any).user_id === user.id);
  const hasStories = userStories.length > 0;
  const userPosts = posts.filter((post) => post.author_id === user.id && !post.is_archived);
  const userCards = cards.filter((c) => (c.owner_id === user.id || (c as any).user_id === user.id) && !!c.content_url);
  const followHandler = onToggleFollow || onToggleContact;
  const following = onToggleFollow ? isFollowing : Boolean(isContact);

  const handleCopy = () => {
    onCopyId?.(user.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleAvatarClick = () => {
    if (profilePic) {
      setShowPic(true);
    } else if (hasStories && onOpenStories) {
      playPress(800);
      onClose();
      onOpenStories(user.id);
    }
  };

  const handleStoryBadgeClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (hasStories && onOpenStories) {
      playPress(800);
      onClose();
      onOpenStories(user.id);
    }
  };

  // Escape walks back one layer at a time (picture -> card -> post -> modal)
  // and focus returns to whatever opened the modal. Neither existed before, so
  // a keyboard user was trapped in the overlay.
  useEffect(() => {
    const previous = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null
    return () => { previous?.focus?.() }
  }, [])
  useEffect(() => {
    if (typeof document === 'undefined') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (showPic) { setShowPic(false); return }
      if (selectedCardImage) { setSelectedCardImage(null); return }
      if (activePostId) { setActivePostId(null); return }
      onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, showPic, selectedCardImage, activePostId])

  return (
    <>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Profile of ${user.display_name?.trim() || 'user'}`}
        className="fixed inset-0 z-[var(--z-system)] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 pb-[var(--island-clearance)] sm:p-4 sm:pb-[calc(1rem+var(--island-clearance))] animate-orbit-fade-in select-none font-sans"
        onClick={onClose}
      >
        <div
          className="bg-retro-panel border border-border-glass w-full max-w-4xl overflow-hidden shadow-2xl rounded-t-2xl sm:rounded-xl animate-orbit-pop text-retro-fg max-h-[calc(100dvh-var(--island-clearance))] sm:max-h-[calc(100vh-var(--island-clearance)-2rem)] flex flex-col"
          role="dialog"
          aria-modal="true"
          aria-label={`${displayName} profile`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border-glass shrink-0">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-glass-w20'}`} />
              <span className="text-xs font-medium text-retro-muted">
                {isOnline ? 'Online' : 'Offline'}
              </span>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close profile"
              className="text-retro-muted hover:text-retro-fg p-1 rounded-md cursor-pointer hover:bg-glass-w12 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Two panes: identity/actions on the left, the opened post on the
              right. The post used to render inline in the flow, so opening one
              pushed everything down and a feed refresh could scroll it away.
              On narrow screens the panes stack (post below the grid). */}
          <div className="flex-1 min-h-0 overflow-y-auto md:overflow-hidden styled-scrollbar">
            <div className="md:h-full md:grid md:grid-cols-[minmax(0,21rem)_minmax(0,1fr)]">
              <div data-testid="profile-pane" className="p-4 sm:p-5 space-y-4 md:h-full md:overflow-y-auto styled-scrollbar">
            {/* Avatar & Stats */}
            <div className="flex items-center gap-4 sm:gap-6">
              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={handleAvatarClick}
                  title={hasStories ? 'Watch story' : 'View picture'}
                  className={`w-18 h-18 sm:w-20 sm:h-20 rounded-full overflow-hidden cursor-pointer group transition-transform hover:scale-105 border-2 ${
                    hasStories
                      ? 'border-border-glass'
                      : 'border-border-glass'
                  }`}
                >
                  {profilePic ? (
                    <img src={resolveMediaUrl(profilePic)} alt={displayName} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-glass-w12 flex items-center justify-center text-lg font-semibold text-retro-muted">
                      {displayName.substring(0, 2).toUpperCase()}
                    </div>
                  )}
                </button>

                {hasStories && (
                  <div
                    onClick={handleStoryBadgeClick}
                    className="absolute -bottom-1 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-white text-retro-bg text-[10px] font-semibold flex items-center gap-0.5 cursor-pointer shadow-xs"
                  >
                    <Play className="w-2 h-2 fill-current" />
                    <span>Story</span>
                  </div>
                )}
              </div>

              <div className="flex-1 flex items-center justify-around text-center">
                <div className="flex flex-col">
                  <span className="text-sm font-semibold text-retro-fg font-mono tabular-nums">{userPosts.length}</span>
                  <span className="text-[10px] text-retro-muted">posts</span>
                </div>

                <div
                  className="flex flex-col cursor-pointer"
                  onClick={() => {
                    playPress(700);
                    onClose();
                    onOpenFollowers?.('followers');
                  }}
                >
                  <span className="text-sm font-semibold text-retro-fg group-hover:underline font-mono tabular-nums">
                    {followersCount !== null ? followersCount : (user.likes_received ?? 0)}
                  </span>
                  <span className="text-[10px] text-retro-muted">followers</span>
                </div>

                <div
                  className="flex flex-col cursor-pointer"
                  onClick={() => {
                    playPress(700);
                    onClose();
                    onOpenFollowers?.('following');
                  }}
                >
                  <span className="text-sm font-semibold text-retro-fg font-mono tabular-nums">
                    {followingCount !== null ? followingCount : (user.following_count ?? 0)}
                  </span>
                  <span className="text-[10px] text-retro-muted">following</span>
                </div>
              </div>
            </div>

            {/* Name & ID */}
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-retro-fg">@{displayName}</h3>
              <div className="flex items-center gap-2 text-xs text-retro-muted font-mono">
                <span className="truncate max-w-[220px]">{user.id}</span>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="text-[10px] text-retro-muted hover:text-retro-fg px-2 py-0.5 border border-border-glass bg-retro-bg rounded-md cursor-pointer flex items-center gap-1 shrink-0 transition-colors"
                  title="Copy ID"
                >
                  {copied ? <Check className="w-2.5 h-2.5 text-emerald-400" /> : <Copy className="w-2.5 h-2.5" />}
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>

            {/* Tags */}
            {tags.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-md bg-retro-bg border border-border-glass text-retro-muted"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-retro-muted italic">No tags set</p>
            )}

            {/* Action Buttons */}
            <div className="grid grid-cols-2 gap-2">
              {onSendCard && (
                <button
                  type="button"
                  onClick={() => {
                    onSendCard(user.id);
                    onClose();
                  }}
                  className="py-2 px-3 bg-white hover:bg-retro-fg text-retro-bg font-semibold text-xs rounded-md transition-all duration-150 active:scale-[0.96] shadow-xs cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5 stroke-[2]" />
                  <span>Send Card</span>
                </button>
              )}

              {onStartPm && (
                <button
                  type="button"
                  onClick={() => {
                    onStartPm({ id: user.id, display_name: displayName });
                    onClose();
                  }}
                  className="py-2 px-3 bg-glass-w12 hover:bg-glass-w20 border border-border-glass text-retro-fg font-semibold text-xs rounded-md transition-all duration-150 active:scale-[0.96] cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <MessageCircle className="w-3.5 h-3.5 stroke-[1.75]" />
                  <span>Message</span>
                </button>
              )}

              {onInviteToGame && (
                <button
                  type="button"
                  onClick={() => onInviteToGame(user.id)}
                  className="py-2 px-3 bg-glass-w12 hover:bg-glass-w12 border border-border-glass text-retro-fg font-semibold text-xs rounded-md transition-all duration-150 active:scale-[0.96] cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <Swords className="w-3.5 h-3.5 stroke-[1.75]" />
                  <span>Invite to Game</span>
                </button>
              )}
            </div>

            {/* Secondary Actions */}
            <div className="flex items-center gap-2 border-t border-border-glass pt-3">
              {followHandler && (
                <button
                  type="button"
                  onClick={() => followHandler(user.id)}
                  className={`flex-1 py-2 px-3 border text-xs font-semibold rounded-md transition-all duration-150 active:scale-[0.96] cursor-pointer flex items-center justify-center gap-1.5 ${
                     following
                       ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                      : 'border-border-glass bg-retro-bg text-retro-fg hover:border-border-glass hover:bg-retro-panel'
                  }`}
                >
                   <Star className={`w-3.5 h-3.5 ${following ? 'fill-amber-400 text-amber-400' : ''}`} />
                   <span>{following ? 'Following' : 'Follow'}</span>
                </button>
              )}

              {onBlockUser && (
                <button
                  type="button"
                  onClick={() => {
                    onBlockUser(user.id);
                    onClose();
                  }}
                  className="py-2 px-3 border border-red-500/25 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-medium rounded-md transition-all duration-150 active:scale-[0.96] cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <Ban className="w-3.5 h-3.5" />
                  <span>Block</span>
                </button>
              )}
              {onReportUser && user.id !== identity?.orbitId && (
                <button
                  type="button"
                  onClick={() => {
                    onReportUser(user.id, user.display_name?.trim() || 'Unknown User');
                    onClose();
                  }}
                  className="py-2 px-3 border border-red-500/25 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-medium rounded-md transition-all duration-150 active:scale-[0.96] cursor-pointer flex items-center justify-center gap-1.5"
                  title="Report this user"
                >
                  <Flag className="w-3.5 h-3.5" />
                  <span>Report</span>
                </button>
              )}
            </div>

            {/* Posts Gallery: public posts are the primary profile content. */}
            {userPosts.length > 0 && (
              <div className="space-y-2 border-t border-border-glass pt-3">
                <span className="text-xs font-medium text-retro-body flex items-center gap-1.5">
                  <Grid className="w-3.5 h-3.5" />
                  <span>Posts ({userPosts.length})</span>
                </span>
                <div className="grid grid-cols-3 gap-1.5">
                  {userPosts.map((post, postIndex) => (
                    <button
                      key={post.id}
                      type="button"
                      aria-pressed={activePostId === post.id}
                      aria-label={`Open post ${postIndex + 1}`}
                      onClick={() => {
                        playPress(700);
                        setActivePostId(post.id);
                        openPost(post);
                      }}
                      className={`aspect-square bg-surface-interactive rounded-lg overflow-hidden border cursor-pointer group hover:opacity-90 transition-opacity ${activePostId === post.id ? 'border-retro-accent/70' : 'border-border-glass'}`}
                    >
                      <ObjectImage
                        contentUrl={post.url}
                        objectId={post.id}
                        identity={identity}
                        mimeType={(post as any).mime_type}
                        alt={post.caption || ''}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Cards Gallery */}
            {userCards.length > 0 && (
              <div className="space-y-2 border-t border-border-glass pt-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-retro-body flex items-center gap-1.5">
                    <Grid className="w-3.5 h-3.5" />
                    <span>Cards ({userCards.length})</span>
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-1.5">
                  {userCards.slice(0, 6).map((card) => (
                    <div
                      key={card.id}
                      onClick={() => setSelectedCardImage(card.content_url || (card as any).data || (card as any).url || `/api/objects/${card.id}`)}
                      className="aspect-square bg-surface-interactive rounded-lg overflow-hidden border border-border-glass cursor-pointer group hover:opacity-90 transition-opacity"
                    >
                      <ObjectImage
                        contentUrl={card.content_url || (card as any).data || (card as any).url || `/api/objects/${card.id}`}
                        objectId={card.id}
                        identity={identity}
                        mimeType={(card as any).mime_type}
                        alt=""
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
              </div>

              {/* Right pane: the post opened from the grid, kept mounted while
                  presence and feed updates land. */}
              <div data-testid="profile-post-pane" className="border-t md:border-t-0 md:border-l border-border-glass px-4 py-3 sm:p-4 md:h-full md:overflow-y-auto styled-scrollbar">
                {activePostId ? (
                  expandedNode
                ) : (
                  <div className="h-full min-h-[12rem] flex flex-col items-center justify-center text-center gap-2 text-retro-muted select-none">
                    <Grid className="w-5 h-5" />
                    <p className="text-xs">
                      {userPosts.length > 0 ? 'Select a post to open it here.' : 'No posts yet.'}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Full Picture Modal */}
      {showPic && profilePic && (
        <div
          className="fixed inset-0 z-[var(--z-system)] flex items-center justify-center bg-black/70 p-4 cursor-pointer"
          onClick={() => setShowPic(false)}
        >
          <div className="relative max-w-sm max-h-[80vh]" onClick={(e) => e.stopPropagation()}>
            <img src={resolveMediaUrl(profilePic)} alt={displayName} className="max-w-full max-h-[80vh] rounded-lg border border-border-glass shadow-xl object-contain" />
            <button
              type="button"
              onClick={() => setShowPic(false)}
              className="absolute top-3 right-3 text-white bg-black/70 p-1.5 rounded hover:bg-black transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Card Image Lightbox */}
      {selectedCardImage && (
        <div
          className="fixed inset-0 z-[var(--z-system)] flex items-center justify-center bg-black/70 p-4 cursor-pointer"
          onClick={() => setSelectedCardImage(null)}
        >
          <div className="relative max-w-md max-h-[85vh]" onClick={(e) => e.stopPropagation()}>
            <ObjectImage
              contentUrl={selectedCardImage}
              identity={null}
              alt="Card preview"
              className="max-w-full max-h-[85vh] rounded-lg border border-border-glass shadow-xl object-contain"
              controls
              autoPlay
            />
            <button
              type="button"
              onClick={() => setSelectedCardImage(null)}
              className="absolute top-3 right-3 text-white bg-black/70 p-1.5 rounded hover:bg-black transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {postLightboxModals}
    </>
  );
}
