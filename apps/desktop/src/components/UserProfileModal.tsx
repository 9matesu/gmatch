"use client";

import React, { useState, useEffect } from 'react';
import type { OrbitIdentity } from '@orbit/crypto';
import { parseTags, type User, type OrbitObject } from '@orbit/shared';
import { X, Copy, Check, Star, Ban, Send, Grid, MessageCircle, Play, Swords } from 'lucide-react';
import { playPress } from '../utils/sounds';
import { resolveMediaUrl } from '../utils/media';
import { ObjectImage } from './ObjectImage';
import { InstagramPostModal } from './feed/InstagramPostModal';
import type { FeedPost } from './feed/GoonMatchFeed';
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
        className="fixed inset-0 z-[99999] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4 animate-orbit-fade-in select-none font-sans"
        onClick={onClose}
      >
        <div
          className="bg-surface-raised border border-retro-border w-full max-w-lg overflow-hidden shadow-xl rounded-t-3xl sm:rounded-lg animate-orbit-pop text-retro-fg max-h-[92dvh] sm:max-h-[90vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-retro-border shrink-0">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${user.online ? 'bg-retro-online' : 'bg-zinc-500'}`} />
              <span className="text-xs font-medium text-retro-muted">
                {user.online ? 'Online' : 'Offline'}
              </span>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="text-retro-muted hover:text-retro-fg p-1 rounded cursor-pointer"
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
                      ? 'border-retro-accent'
                      : 'border-retro-border'
                  }`}
                >
                  {profilePic ? (
                    <img src={resolveMediaUrl(profilePic)} alt={displayName} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-surface-interactive flex items-center justify-center text-lg font-medium text-retro-muted">
                      {displayName.substring(0, 2).toUpperCase()}
                    </div>
                  )}
                </button>

                {hasStories && (
                  <div
                    onClick={handleAvatarClick}
                    className="absolute -bottom-1 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-retro-accent text-black text-[9px] font-medium flex items-center gap-0.5 cursor-pointer"
                  >
                    <Play className="w-2 h-2 fill-current" />
                    <span>Story</span>
                  </div>
                )}
              </div>

              <div className="flex-1 flex items-center justify-around text-center">
                <div className="flex flex-col">
                  <span className="text-sm font-semibold text-retro-fg tabular-nums">{userPosts.length}</span>
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
                  <span className="text-sm font-semibold text-retro-fg group-hover:underline tabular-nums">
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
                  <span className="text-sm font-semibold text-retro-accent font-mono tabular-nums">
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
                  className="text-[10px] text-retro-muted hover:text-retro-fg px-2 py-0.5 border border-retro-border rounded cursor-pointer flex items-center gap-1 shrink-0"
                  title="Copy ID"
                >
                  {copied ? <Check className="w-2.5 h-2.5 text-retro-online" /> : <Copy className="w-2.5 h-2.5" />}
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
                    className="text-[10px] font-medium px-2 py-0.5 rounded bg-surface-interactive border border-retro-border text-retro-body"
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
                  className="py-2 px-3 bg-retro-accent hover:bg-retro-accent-hover text-black font-medium text-xs rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" />
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
                  className="py-2 px-3 bg-surface-interactive border border-retro-border text-retro-body font-medium text-xs rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-1.5 hover:border-zinc-500"
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                  <span>Message</span>
                </button>
              )}

              {onInviteToGame && (
                <button
                  type="button"
                  onClick={() => onInviteToGame(user.id)}
                  className="py-2 px-3 bg-retro-accent/15 border border-retro-accent/50 text-retro-accent font-medium text-xs rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-1.5 hover:bg-retro-accent/25"
                >
                  <Swords className="w-3.5 h-3.5" />
                  <span>Invite to Game</span>
                </button>
              )}
            </div>

            {/* Secondary Actions */}
            <div className="flex items-center gap-2 border-t border-retro-border pt-3">
              {followHandler && (
                <button
                  type="button"
                  onClick={() => followHandler(user.id)}
                  className={`flex-1 py-2 px-3 border text-xs font-medium rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-1.5 ${
                     following
                       ? 'border-retro-warning/30 bg-retro-warning/10 text-retro-warning'
                      : 'border-retro-border bg-surface-interactive text-retro-body hover:border-zinc-500'
                  }`}
                >
                   <Star className={`w-3.5 h-3.5 ${following ? 'fill-retro-warning text-retro-warning' : ''}`} />
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
                  className="py-2 px-3 border border-retro-border bg-surface-interactive hover:bg-rose-500/10 hover:border-rose-500/30 text-rose-400 text-xs font-medium rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <Ban className="w-3.5 h-3.5" />
                  <span>Block</span>
                </button>
              )}
            </div>

            {/* Posts Gallery: public posts are the primary profile content. */}
            {userPosts.length > 0 && (
              <div className="space-y-2 border-t border-retro-border pt-3">
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
                      className="aspect-square bg-surface-interactive rounded-lg overflow-hidden border border-retro-border cursor-pointer group hover:opacity-90 transition-opacity"
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
              <div className="space-y-2 border-t border-retro-border pt-3">
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
                      className="aspect-square bg-surface-interactive rounded-lg overflow-hidden border border-retro-border cursor-pointer group hover:opacity-90 transition-opacity"
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
          className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/90 p-4 cursor-pointer"
          onClick={() => setShowPic(false)}
        >
          <div className="relative max-w-sm max-h-[80vh]" onClick={(e) => e.stopPropagation()}>
            <img src={resolveMediaUrl(profilePic)} alt={displayName} className="max-w-full max-h-[80vh] rounded-lg border border-retro-border shadow-xl object-contain" />
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
          className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/90 p-4 cursor-pointer"
          onClick={() => setSelectedCardImage(null)}
        >
          <div className="relative max-w-md max-h-[85vh]" onClick={(e) => e.stopPropagation()}>
            <ObjectImage
              contentUrl={selectedCardImage}
              identity={null}
              alt="Card preview"
              className="max-w-full max-h-[85vh] rounded-lg border border-retro-border shadow-xl object-contain"
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
