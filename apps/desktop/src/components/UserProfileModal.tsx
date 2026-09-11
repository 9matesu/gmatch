"use client";

import React, { useState, useEffect } from 'react';
import type { OrbitIdentity } from '@orbit/crypto';
import { parseTags, type User, type OrbitObject } from '@orbit/shared';
import { X, Copy, Check, Star, Ban, Send, Grid, MessageCircle, Play, Swords, Flag } from 'lucide-react';
import { playPress } from '../utils/sounds';
import { resolveMediaUrl } from '../utils/media';
import { ObjectImage } from './ObjectImage';
import { InstagramPostModal } from './feed/InstagramPostModal';
import type { FeedPost } from './feed/GMatchFeed';
import { orbitFetch } from '../utils/api';

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
}: UserProfileModalProps) {
  const [showPic, setShowPic] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selectedCardImage, setSelectedCardImage] = useState<string | null>(null);
  const [selectedPost, setSelectedPost] = useState<FeedPost | null>(null);
  const [followersCount, setFollowersCount] = useState<number | null>(null);
  const [followingCount, setFollowingCount] = useState<number | null>(null);

  // Fetch follower/following counts from API when viewing another user's profile
  useEffect(() => {
    if (!identity || !user || user.id === identity.orbitId) return;
    let cancelled = false;
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

  if (!user) return null;

  const displayName = user.display_name?.trim() || 'Unknown User';
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
    if (hasStories && onOpenStories) {
      playPress(800);
      onClose();
      onOpenStories(user.id);
    } else if (profilePic) {
      setShowPic(true);
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 z-[var(--z-system)] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-xs p-0 sm:p-4 animate-orbit-fade-in select-none font-sans"
        onClick={onClose}
      >
        <div
          className="bg-zinc-900 border border-zinc-800 w-full max-w-lg overflow-hidden shadow-2xl rounded-t-2xl sm:rounded-xl animate-orbit-pop text-zinc-100 max-h-[92dvh] sm:max-h-[90vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${user.online ? 'bg-emerald-500' : 'bg-zinc-600'}`} />
              <span className="text-xs font-medium text-zinc-400">
                {user.online ? 'Online' : 'Offline'}
              </span>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="text-zinc-400 hover:text-zinc-100 p-1 rounded-md cursor-pointer hover:bg-zinc-800 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Content */}
          <div className="p-4 sm:p-5 space-y-4 overflow-y-auto styled-scrollbar">
            {/* Avatar & Stats */}
            <div className="flex items-center gap-4 sm:gap-6">
              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={handleAvatarClick}
                  title={hasStories ? 'Watch story' : 'View picture'}
                  className={`w-18 h-18 sm:w-20 sm:h-20 rounded-full overflow-hidden cursor-pointer group transition-transform hover:scale-105 border-2 ${
                    hasStories
                      ? 'border-zinc-200'
                      : 'border-zinc-700'
                  }`}
                >
                  {profilePic ? (
                    <img src={resolveMediaUrl(profilePic)} alt={displayName} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-zinc-800 flex items-center justify-center text-lg font-semibold text-zinc-400">
                      {displayName.substring(0, 2).toUpperCase()}
                    </div>
                  )}
                </button>

                {hasStories && (
                  <div
                    onClick={handleAvatarClick}
                    className="absolute -bottom-1 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-white text-zinc-950 text-[9px] font-semibold flex items-center gap-0.5 cursor-pointer shadow-xs"
                  >
                    <Play className="w-2 h-2 fill-current" />
                    <span>Story</span>
                  </div>
                )}
              </div>

              <div className="flex-1 flex items-center justify-around text-center">
                <div className="flex flex-col">
                  <span className="text-sm font-semibold text-zinc-100 font-mono tabular-nums">{userPosts.length}</span>
                  <span className="text-[10px] text-zinc-400">posts</span>
                </div>

                <div
                  className="flex flex-col cursor-pointer"
                  onClick={() => {
                    playPress(700);
                    onClose();
                    onOpenFollowers?.('followers');
                  }}
                >
                  <span className="text-sm font-semibold text-zinc-100 group-hover:underline font-mono tabular-nums">
                    {followersCount !== null ? followersCount : (user.likes_received ?? 0)}
                  </span>
                  <span className="text-[10px] text-zinc-400">followers</span>
                </div>

                <div
                  className="flex flex-col cursor-pointer"
                  onClick={() => {
                    playPress(700);
                    onClose();
                    onOpenFollowers?.('following');
                  }}
                >
                  <span className="text-sm font-semibold text-zinc-100 font-mono tabular-nums">
                    {followingCount !== null ? followingCount : (user.following_count ?? 0)}
                  </span>
                  <span className="text-[10px] text-zinc-400">following</span>
                </div>
              </div>
            </div>

            {/* Name & ID */}
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-zinc-100">@{displayName}</h3>
              <div className="flex items-center gap-2 text-xs text-zinc-400 font-mono">
                <span className="truncate max-w-[220px]">{user.id}</span>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="text-[10px] text-zinc-400 hover:text-zinc-200 px-2 py-0.5 border border-zinc-800 bg-zinc-950 rounded-md cursor-pointer flex items-center gap-1 shrink-0 transition-colors"
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
                    className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-md bg-zinc-950 border border-zinc-800 text-zinc-400"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-zinc-500 italic">No tags set</p>
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
                  className="py-2 px-3 bg-white hover:bg-zinc-200 text-zinc-950 font-semibold text-xs rounded-md transition-all duration-150 active:scale-[0.96] shadow-xs cursor-pointer flex items-center justify-center gap-1.5"
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
                  className="py-2 px-3 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-100 font-semibold text-xs rounded-md transition-all duration-150 active:scale-[0.96] cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <MessageCircle className="w-3.5 h-3.5 stroke-[1.75]" />
                  <span>Message</span>
                </button>
              )}

              {onInviteToGame && (
                <button
                  type="button"
                  onClick={() => onInviteToGame(user.id)}
                  className="py-2 px-3 bg-zinc-800/60 hover:bg-zinc-800 border border-zinc-700/80 text-zinc-200 font-semibold text-xs rounded-md transition-all duration-150 active:scale-[0.96] cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <Swords className="w-3.5 h-3.5 stroke-[1.75]" />
                  <span>Invite to Game</span>
                </button>
              )}
            </div>

            {/* Secondary Actions */}
            <div className="flex items-center gap-2 border-t border-zinc-800 pt-3">
              {followHandler && (
                <button
                  type="button"
                  onClick={() => followHandler(user.id)}
                  className={`flex-1 py-2 px-3 border text-xs font-semibold rounded-md transition-all duration-150 active:scale-[0.96] cursor-pointer flex items-center justify-center gap-1.5 ${
                     following
                       ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                      : 'border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900'
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
                  {userPosts.map((post) => (
                    <button
                      key={post.id}
                      type="button"
                      onClick={() => setSelectedPost(post)}
                      className="aspect-square bg-surface-interactive rounded-lg overflow-hidden border border-border-glass cursor-pointer group hover:opacity-90 transition-opacity"
                    >
                      <ObjectImage
                        contentUrl={post.url}
                        objectId={post.id}
                        identity={identity}
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
                        identity={null}
                        alt=""
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Full Picture Modal */}
      {showPic && profilePic && (
        <div
          className="fixed inset-0 z-[var(--z-system)] flex items-center justify-center bg-black/90 p-4 cursor-pointer"
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
          className="fixed inset-0 z-[var(--z-system)] flex items-center justify-center bg-black/90 p-4 cursor-pointer"
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

      {selectedPost && (
        <InstagramPostModal
          post={selectedPost}
          isOpen
          onClose={() => setSelectedPost(null)}
          identity={identity}
          profilePics={profilePic ? { [user.id]: profilePic } : {}}
        />
      )}
    </>
  );
}
