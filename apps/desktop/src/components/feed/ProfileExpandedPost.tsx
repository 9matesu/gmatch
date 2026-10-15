"use client";

import { useEffect, useState } from 'react';
import { playPress, playWin } from '../../utils/sounds';
import {
  Heart,
  Send,
  Bookmark,
  MoreHorizontal,
  X,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { OrbitIdentity } from '@orbit/crypto';
import type { FeedPost, PostComment } from './GMatchFeed';
import { ObjectImage } from '../ObjectImage';
import { NativeVideoPlayer } from '../media/NativeVideoPlayer';
import { isVideoPost, resolveMediaUrl } from '../../utils/media';
import { timeAgo } from '../../utils/timeAgo';
import { formatLikedBy } from '../../utils/likedBy';
import { PostComments } from './PostComments';

/**
 * Inline expanded post for profile surfaces (own grid, other-user modal).
 * Replaces the former post dialog: same media model (post.media[] first,
 * then mediaUrls, then single url), same carousel + zoom + double-tap-like,
 * same wired action bar and comment thread — but rendered as an <article> in
 * the page flow under the grid instead of a fixed overlay dialog.
 */
export function ProfileExpandedPost({ post, onClose, identity, profilePics = {}, isLiked = false, isSaved = false, likeCount = 0, comments = [], commentsLoading = false, onToggleLike, onToggleSave, onAddComment, onToggleCommentLike, onReportComment, onOpenShare, onOptionsClick, onOpenLikers, onSelectUser, onAvatarClick, onOpenNetwork }: {
  post: FeedPost;
  onClose: () => void;
  identity: OrbitIdentity | null;
  profilePics?: Record<string, string>;
  isLiked?: boolean;
  isSaved?: boolean;
  likeCount?: number;
  comments?: PostComment[];
  /** The list is in flight: show a loading row, not "No comments yet". */
  commentsLoading?: boolean;
  onToggleLike?: (post: FeedPost) => void;
  onToggleSave?: (post: FeedPost) => void;
  onAddComment?: (postId: string, text: string) => void;
  onToggleCommentLike?: (postId: string, commentId: string) => void;
  onReportComment?: (commentId: string) => void;
  onOpenShare?: (post: FeedPost) => void;
  onOptionsClick?: (post: FeedPost) => void;
  onOpenLikers?: (postId: string) => void;
  onSelectUser?: (userId: string) => void;
  onAvatarClick?: (userId: string) => void;
  onOpenNetwork?: (userId: string) => void;
}) {
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [activeMediaIndex, setActiveMediaIndex] = useState(0);
  const [doubleTapAnimation, setDoubleTapAnimation] = useState(false);

  // Never name myself in my own likes summary.
  const likedByLabel = formatLikedBy(
    post?.likers?.filter((l) => l.user_id !== identity?.orbitId),
    likeCount,
  );

  // Reset carousel/zoom whenever a different post is opened.
  useEffect(() => {
    setZoomLevel(1);
    setActiveMediaIndex(0);
    setDoubleTapAnimation(false);
  }, [post?.id]);

  interface ExpandedMediaItem {
    id?: string;
    url: string;
    mime?: string;
  }

  // Media model mirrors the feed cards: post.media[] (per-item mime) first,
  // then legacy mediaUrls, then the single url + mime_type. Keeps mime per
  // item so extension-less object videos are detected as video. Legacy
  // mediaUrls rows carry no per-item mime — fall back to the matching
  // post.media[] entry, then the post-level mime_type (legacy vault://
  // reposts only store the mime on the post).
  const mediaItems: ExpandedMediaItem[] = post
    ? (Array.isArray((post as any).media) && (post as any).media.length > 0
      ? (post as any).media
        .map((m: any) => ({ id: m?.id as string | undefined, url: m?.url as string, mime: m?.mime_type as string | undefined }))
        .filter((m: ExpandedMediaItem) => Boolean(m.url))
      : [...((post as any).mediaUrls || [])].map((u: string) => ({
        url: u,
        mime: ((post as any).media?.find?.((m: any) => m?.url === u)?.mime_type ?? (post as any).mime_type) as string | undefined,
      }))
    )
    : [];
  if (post && mediaItems.length === 0) {
    const fallbackUrl = post.localPreviewUrl || (post as any).url;
    if (fallbackUrl) {
      mediaItems.push({ id: post.id, url: fallbackUrl, mime: (post as any).mime_type });
    }
  }
  const activeMedia = mediaItems[activeMediaIndex] || mediaItems[0] || null;

  const isExpandedMediaVideo = (url?: string | null, mime?: string | null): boolean =>
    isVideoPost(mime, url, mediaItems.map((m) => m.mime));

  const handleDoubleTap = () => {
    playWin();
    if (!isLiked && post && onToggleLike) {
      onToggleLike(post);
    }
    setDoubleTapAnimation(true);
    setTimeout(() => setDoubleTapAnimation(false), 700);
  };

  const handleZoomToggle = () => {
    playPress(700);
    setZoomLevel((prev) => (prev === 1 ? 1.8 : prev === 1.8 ? 2.6 : 1));
  };

  const handleAuthorClick = () => {
    if (!post) return;
    if (onOpenNetwork) {
      onOpenNetwork(post.author_id);
    } else if (onAvatarClick) {
      onAvatarClick(post.author_id);
    } else {
      onSelectUser?.(post.author_id);
    }
  };

  const authorAvatar = profilePics[post.author_id] || post.author_avatar;
  const resolvedAuthorAvatar = authorAvatar ? resolveMediaUrl(authorAvatar) : '';

  return (
    <article
      data-expanded-post={post.id}
      className="mt-2 rounded-xl border border-border-glass bg-retro-panel text-retro-fg overflow-hidden animate-orbit-slide-up"
    >
      {/* Header: author + options + collapse */}
      <div className="p-3 border-b border-border-glass flex items-center justify-between">
        <button
          type="button"
          onClick={handleAuthorClick}
          aria-label={`View profile of ${post.author_name}`}
          className="flex items-center gap-3 text-left cursor-pointer"
        >
          <div className="w-8 h-8 rounded-full bg-glass-w12 border border-border-glass p-[1px] flex-shrink-0">
            <div className="w-full h-full rounded-full bg-retro-panel overflow-hidden flex items-center justify-center text-xs font-semibold text-retro-fg">
              {authorAvatar ? (
                <img src={resolvedAuthorAvatar} alt="" className="w-full h-full object-cover" />
              ) : (
                post.author_name.charAt(0).toUpperCase()
              )}
            </div>
          </div>
          <div>
            <div className="flex items-center gap-1">
              <span className="text-xs font-semibold text-retro-fg hover:underline">{post.author_name}</span>
            </div>
            <span className="text-[10px] text-retro-muted font-medium block">
              {post.location ? `${post.location} · ` : ''}{timeAgo(post.created_at)}
            </span>
          </div>
        </button>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onOptionsClick?.(post)}
            aria-label="Post options"
            className="p-1.5 text-retro-muted hover:text-retro-fg rounded-md cursor-pointer hover:bg-glass-w12 transition-colors"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => { playPress(700); onClose(); }}
            aria-label="Collapse post"
            className="p-1.5 text-retro-muted hover:text-retro-fg rounded-md cursor-pointer hover:bg-glass-w12 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Media: carousel + zoom, capped for inline flow (not a dialog). */}
      <div
        className="relative bg-black flex items-center justify-center overflow-hidden min-h-[280px]"
        onDoubleClick={handleDoubleTap}
      >
        {post.localPreviewUrl ? (
          isExpandedMediaVideo(post.localPreviewUrl, post.mime_type) ? (
            <NativeVideoPlayer
              key={post.localPreviewUrl}
              src={post.localPreviewUrl}
              className="w-full h-full max-h-[70vh] object-contain"
              videoClassName="w-full h-full max-h-[70vh] object-contain"
              autoPlay={true}
              controls={true}
              alwaysShowControls={true}
              loop={true}
              muted={true}
              onDoubleTapLike={handleDoubleTap}
            />
          ) : (
            <div
              className="w-full h-full flex items-center justify-center transition-transform duration-300 ease-out cursor-zoom-in motion-safe:transition-transform motion-reduce:transition-none"
              style={{ transform: `scale(${zoomLevel})` }}
              onClick={handleZoomToggle}
            >
              <img
                src={post.localPreviewUrl}
                alt={post.caption || ''}
                className="w-full h-full object-contain max-h-[70vh]"
                draggable={false}
              />
            </div>
          )
        ) : activeMedia && isExpandedMediaVideo(activeMedia.url, activeMedia.mime) ? (
          <ObjectImage
            key={activeMedia.url}
            contentUrl={activeMedia.url}
            objectId={activeMedia.id || post.id}
            identity={identity}
            mimeType={activeMedia.mime || post.mime_type}
            loading="eager"
            className="w-full h-full max-h-[70vh] object-contain"
            videoClassName="w-full h-full max-h-[70vh] object-contain"
            autoPlay={true}
            controls={true}
            alwaysShowControls={true}
            loop={true}
            muted={true}
            onDoubleTapLike={handleDoubleTap}
          />
        ) : (
          <div
            className="w-full h-full flex items-center justify-center transition-transform duration-300 ease-out cursor-zoom-in motion-safe:transition-transform motion-reduce:transition-none"
            style={{ transform: `scale(${zoomLevel})` }}
            onClick={handleZoomToggle}
          >
            <ObjectImage
              contentUrl={post.localPreviewUrl || activeMedia?.url || post.url}
              objectId={activeMedia?.id || post.id}
              identity={identity}
              mimeType={activeMedia?.mime || post.mime_type}
              alt=""
              className="w-full h-full object-contain max-h-[70vh]"
              muted={false}
              autoPlay={false}
              controls={false}
              loop
              playsInline
            />
          </div>
        )}

        {/* Double Tap Heart Pop */}
        {doubleTapAnimation && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20 animate-orbit-pop">
            <Heart className="w-28 h-28 text-white fill-white drop-shadow-2xl opacity-90 animate-pulse" />
          </div>
        )}

        {/* Carousel Arrows if multiple images */}
        {mediaItems.length > 1 && (
          <>
            {activeMediaIndex > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  playPress(700);
                  setActiveMediaIndex((i) => Math.max(0, i - 1));
                }}
                aria-label="Previous image"
                className="absolute left-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 text-white hover:bg-black/80 cursor-pointer"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
            )}
            {activeMediaIndex < mediaItems.length - 1 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  playPress(700);
                  setActiveMediaIndex((i) => Math.min(mediaItems.length - 1, i + 1));
                }}
                aria-label="Next image"
                className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 text-white hover:bg-black/80 cursor-pointer"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            )}

            {/* Dots indicator */}
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 z-10 bg-black/60 px-2 py-1 rounded-full">
              {mediaItems.map((_, idx) => (
                <span
                  key={idx}
                  className={`w-1.5 h-1.5 rounded-full transition-all ${idx === activeMediaIndex ? 'bg-white w-3' : 'bg-glass-w20'
                    }`}
                />
              ))}
            </div>
          </>
        )}

        {/* Zoom controls pill */}
        <div className="absolute top-3 left-3 flex items-center gap-1 bg-black/60 backdrop-blur-md rounded-full px-2.5 py-1 text-white text-[10px] font-medium border border-white/10">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); handleZoomToggle(); }}
            aria-label={zoomLevel > 1 ? 'Zoom out' : 'Zoom in'}
            className="flex items-center gap-1 hover:text-retro-fg cursor-pointer"
          >
            {zoomLevel > 1 ? <ZoomOut className="w-3.5 h-3.5" /> : <ZoomIn className="w-3.5 h-3.5" />}
            <span className="font-mono">{Math.round(zoomLevel * 100)}%</span>
          </button>
        </div>
      </div>

      {/* Action Bar */}
      <div className="flex items-center gap-1 px-2 pt-1">
        <button
          type="button"
          onClick={() => onToggleLike?.(post)}
          aria-label={isLiked ? 'Unlike' : 'Like'}
          aria-pressed={isLiked}
          className="p-1.5 hover:bg-glass-w12 rounded-full transition-colors cursor-pointer"
        >
          <Heart className={`w-5 h-5 ${isLiked ? 'fill-red-500 text-red-500' : 'text-retro-fg'}`} />
        </button>
        <button
          type="button"
          onClick={() => onOpenShare?.(post)}
          aria-label="Share post"
          className="p-1.5 hover:bg-glass-w12 rounded-full transition-colors cursor-pointer"
        >
          <Send className="w-5 h-5 text-retro-fg" />
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => onToggleSave?.(post)}
          aria-label={isSaved ? 'Remove from saved' : 'Save post'}
          aria-pressed={isSaved}
          className="p-1.5 hover:bg-glass-w12 rounded-full transition-colors cursor-pointer"
        >
          <Bookmark className={`w-5 h-5 ${isSaved ? 'fill-amber-400 text-amber-400' : 'text-retro-fg'}`} />
        </button>
      </div>

      {/* Likes Summary — "Liked by Ana, Bo and 12 others" when the
          payload carries liker names, bare count otherwise. */}
      <button
        type="button"
        onClick={() => onOpenLikers?.(post.id)}
        className="text-left px-3 pb-2 text-xs font-semibold text-retro-fg tracking-tight hover:underline cursor-pointer w-fit transition-colors"
        aria-label="View who liked this post"
      >
        {likedByLabel || `${likeCount.toLocaleString()} ${likeCount === 1 ? 'like' : 'likes'}`}
      </button>

      {/* Comments thread + composer, shared with the feed inline expansion. */}
      <PostComments
        post={post}
        comments={comments}
        commentsLoading={commentsLoading}
        authorAvatar={resolvedAuthorAvatar}
        onAuthorClick={handleAuthorClick}
        onAddComment={onAddComment}
        onToggleCommentLike={onToggleCommentLike}
        onReportComment={onReportComment}
      />
    </article>
  );
}
