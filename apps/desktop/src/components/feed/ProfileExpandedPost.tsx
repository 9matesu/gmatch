"use client";

import { useEffect, useRef, useState } from 'react';
import { playPress } from '../../utils/sounds';
import {
  Heart,
  Send,
  Bookmark,
  X,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  FolderPlus,
  MessageCircle,
} from 'lucide-react';
import type { OrbitIdentity } from '@orbit/crypto';
import type { FeedPost, PostComment } from './GMatchFeed';
import { displayMedia, readPostContent } from './postModel';
import { PostBody } from './PostBody';
import { ObjectImage } from '../ObjectImage';
import { isVideoPost, resolveMediaUrl } from '../../utils/media';
import { formatCount, formatRelativeDate } from '../../utils/formatDate';
import { formatLikedBy } from '../../utils/likedBy';
import { custodyStatus } from '../../utils/durableCustody';
import { useDurableCustody } from '../../hooks/useDurableCustody';
import { PostComments } from './PostComments';
import {
  classes, COLOR, GAP, ICON, MOTION, PADDING, PADDING_X, PADDING_Y,
  PRESENCE, RADIUS, STATUS, TRACKING, TRANSITION, TYPE, WEIGHT,
} from '../../ui/tokens';
import { usePresence } from '../../game/presenceStore';

/** The expanded post is CONTENT on the caller's single card, never a second
 *  card stacked inside it. Edges/padding stay token-composed and quiet. */
const ARTICLE = classes('overflow-hidden animate-orbit-slide-up', COLOR.fg);
const ACTION_ICON = classes(
  'p-1.5 cursor-pointer active:scale-(--scale-press)',
  MOTION.transition.transform, RADIUS.chip, COLOR.hoverW10,
);
const CAROUSEL_ARROW = classes(
  'absolute top-1/2 -translate-y-1/2 p-2 cursor-pointer',
  RADIUS.pill, COLOR.scrim, COLOR.fg, COLOR.scrimHover,
);

/**
 * Inline expanded post for profile surfaces (own grid, other-user modal).
 * Replaces the former post dialog: same media model (post.media[] first,
 * then mediaUrls, then single url), same carousel + zoom + double-tap-like,
 * same wired action bar and comment thread — but rendered as an <article> in
 * the page flow under the grid instead of a fixed overlay dialog.
 */
export function ProfileExpandedPost({ post, onClose, identity, profilePics = {}, isLiked = false, isSaved = false, likeCount = 0, comments = [], commentsLoading = false, onToggleLike, onToggleSave, onAddComment, onToggleCommentLike, onReportComment, onOpenShare, onOptionsClick, onOpenLikers, onSelectUser, onAvatarClick, onOpenNetwork, onSaveToVault }: {
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
  /** Save the media bytes to the local Vault (desktop only). */
  onSaveToVault?: (post: FeedPost) => void;
  /**
   * Open the post context menu. The optional position is the CURSOR point of
   * the right-click; when absent the caller picks a sensible spot (the menu
   * is clamped to the viewport either way).
   */
  onOptionsClick?: (post: FeedPost, position?: { x: number; y: number }) => void;
  onOpenLikers?: (postId: string) => void;
  onSelectUser?: (userId: string) => void;
  onAvatarClick?: (userId: string) => void;
  onOpenNetwork?: (userId: string) => void;
}) {
  const [activeMediaIndex, setActiveMediaIndex] = useState(0);
  const [doubleTapAnimation, setDoubleTapAnimation] = useState(false);

  // Never name myself in my own likes summary.
  const likedByLabel = formatLikedBy(
    post?.likers?.filter((l) => l.user_id !== identity?.orbitId),
    likeCount,
  );

  // Peer-confirmed durability. Only a signed receipt that a peer read the bytes
  // back from its own store counts, and only when it proves at least one OTHER
  // device holds them (this node alone is not replication).
  const custody = custodyStatus(useDurableCustody(post?.content_hash || post?.id));
  const articleRef = useRef<HTMLElement>(null);

  // Reset carousel whenever a different post is opened.
  useEffect(() => {
    setActiveMediaIndex(0);
    setDoubleTapAnimation(false);
  }, [post?.id]);

  // One model for both kinds of post: the words are always there; media is
  // optional. A text-only post has NO media panel at all — not an empty frame
  // and not a "No preview" placeholder — and is never hidden for missing bytes.
  const content = readPostContent(post);
  const mediaItems = content.media ?? [];
  const activeMedia = mediaItems[activeMediaIndex] || mediaItems[0] || null;
  // A single-media post must resolve through the SAME addressable source the
  // fullscreen viewer uses (post.localPreviewUrl || post.url, object id post.id).
  // A per-item media url can be a raw provider link (redgifs) that <img> cannot
  // hotlink, so the inline tile went black while the modal — using post.url —
  // resolved. Multi-media carousels still address each item by its own id.
  const singleMedia = mediaItems.length <= 1;
  const primaryMedia = displayMedia(post, content);

  const isExpandedMediaVideo = (url?: string | null, mime?: string | null): boolean =>
    isVideoPost(mime, url, mediaItems.map((m) => m.mimeType ?? ''));

  const handleDoubleTap = () => {
    if (!isLiked && post && onToggleLike) {
      onToggleLike(post);
    }
    setDoubleTapAnimation(true);
    setTimeout(() => setDoubleTapAnimation(false), 700);
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
  // Positive-only presence: a green dot when the author is genuinely online
  // (the shared store's sighting), nothing when there is no sighting — the
  // sheet never invents an "offline" state for an author nobody has seen.
  const authorOnline = usePresence((s) => s.isOnline(post.author_id));

  return (
    <article
      ref={articleRef}
      data-expanded-post={post.id}
      onContextMenu={(e) => {
        // The context menu REPLACED the three-dots button: right-click the
        // post (here or in the timeline) for every action it has.
        e.preventDefault();
        onOptionsClick?.(post, { x: e.clientX, y: e.clientY });
      }}
      className={ARTICLE}
    >
      {/* Header: author + collapse. No separator — one surface, not a nested card. */}
      <div className={classes(PADDING[4], 'flex items-center justify-between')}>
        <button
          type="button"
          onClick={handleAuthorClick}
          aria-label={`View profile of ${post.author_name}`}
          className={classes('flex items-center text-left cursor-pointer', GAP[3])}
        >
          <div className={classes('relative shrink-0', 'w-8 h-8 p-[1px]', RADIUS.pill, COLOR.glassW12, 'border', COLOR.edge)}>
            <div className={classes('w-full h-full overflow-hidden flex items-center justify-center', RADIUS.pill, COLOR.panelGlass, TYPE.body, WEIGHT.semibold, COLOR.fg)}>
              {authorAvatar ? (
                <img src={resolvedAuthorAvatar} alt="" className="w-full h-full object-cover" />
              ) : (
                post.author_name.charAt(0).toUpperCase()
              )}
            </div>
            {authorOnline && (
              <span
                className={classes('absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-surface-raised', PRESENCE.currentDot)}
                aria-label="Author online"
              />
            )}
          </div>
          <div className="min-w-0">
            <div className={classes('flex items-center', GAP[1])}>
              <span className={classes(TYPE.sub, WEIGHT.semibold, COLOR.fg, 'hover:underline truncate')}>{post.author_name}</span>
            </div>
            <span className={classes(TYPE.caption, COLOR.muted, WEIGHT.medium, 'block tabular-nums')}>
              {post.location ? `${post.location} · ` : ''}{formatRelativeDate(post.created_at)}
            </span>
          </div>
        </button>

        <div className={classes('flex items-center', GAP[1])}>
          <button
            type="button"
            onClick={() => { playPress(700); onClose(); }}
            aria-label="Collapse post"
            className={classes('p-1.5 cursor-pointer', RADIUS.chip, COLOR.muted, COLOR.hoverFg, COLOR.hoverW12, TRANSITION.micro)}
          >
            <X className={ICON.md} />
          </button>
        </div>
      </div>

      {/* Media — only when the post HAS media. A text-only post has no image
          panel at all: no empty frame, no "No preview" placeholder. */}
      {mediaItems.length > 0 && (
      <div
        className={classes('relative flex items-center justify-center overflow-hidden min-h-[280px] cursor-pointer', COLOR.canvas)}
        onClick={() => { if (post.id) window.dispatchEvent(new CustomEvent('gmatch-open-image', { detail: { id: post.id, authorName: post.author_name || 'You', url: primaryMedia?.url || post.url, contentHash: post.content_hash } })); }}
        onDoubleClick={handleDoubleTap}
      >
        {/* ObjectImage (with contentHash) is the ONE resolver — the same one the
            fullscreen viewer uses. A raw `localPreviewUrl` <img> short-circuited
            it and rendered blank for a peer post whose bytes resolve by hash. */}
        {activeMedia && isExpandedMediaVideo(activeMedia.url, activeMedia.mimeType) ? (
          <ObjectImage
            key={activeMedia.url}
            contentUrl={singleMedia ? (primaryMedia?.url || post.url) : activeMedia.url}
            objectId={singleMedia ? (primaryMedia?.id || post.id) : (activeMedia.id || post.id)}
            contentHash={post.content_hash}
            identity={identity}
            mimeType={activeMedia.mimeType || primaryMedia?.mimeType || post.mime_type}
            loading="eager"
            className="w-full h-full max-h-(--max-h-sheet) object-contain"
            videoClassName="w-full h-full max-h-(--max-h-sheet) object-contain"
            autoPlay={true}
            controls={true}
            alwaysShowControls={true}
            loop={true}
            muted={true}
            onDoubleTapLike={handleDoubleTap}
          />
        ) : (
          <ObjectImage
            contentUrl={singleMedia ? (primaryMedia?.url || post.url) : (activeMedia?.url || post.url)}
            objectId={singleMedia ? (primaryMedia?.id || post.id) : (activeMedia?.id || post.id)}
            contentHash={post.content_hash}
            identity={identity}
            mimeType={activeMedia?.mimeType || primaryMedia?.mimeType || post.mime_type}
            alt=""
            loading="eager"
            hideUnavailable
            className="w-full h-full object-contain max-h-(--max-h-sheet)"
            muted={false}
            autoPlay={false}
            controls={false}
            loop
            playsInline
          />
        )}

        {/* Double Tap Heart Pop */}
        {doubleTapAnimation && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20 animate-orbit-pop">
            <Heart className={classes('w-28 h-28 drop-shadow-2xl opacity-90 animate-pulse', COLOR.fg, COLOR.onMediaFill)} />
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
                className={classes(CAROUSEL_ARROW, 'left-3')}
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
                className={classes(CAROUSEL_ARROW, 'right-3')}
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            )}

            {/* Dots indicator */}
            <div className={classes(
              'absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center z-10 px-2 py-1',
              GAP[1.5], COLOR.scrim, RADIUS.pill,
            )}>
              {mediaItems.map((_, idx) => (
                <span
                  key={idx}
                  className={classes('w-1.5 h-1.5 transition', RADIUS.pill, idx === activeMediaIndex
                    ? classes(COLOR.accentBg, 'w-3')
                    : COLOR.glassW20,
                  )}
                />
              ))}
            </div>
          </>
        )}

      </div>
      )}

      {/* The written body. Text is content on every post; on a text-only post
          it is the whole card, set at reading size instead of caption size. */}
      <PostBody
        text={content.text}
        typeClassName={mediaItems.length ? TYPE.body : TYPE.base}
        className={classes(PADDING_X[4], PADDING_Y[3])}
      />

      {/* Action Bar — same icons and order as the standard card. */}
      <div className={classes(PADDING_X[4], PADDING_Y[3])}>
        <div className="flex items-center justify-between">
          <div className={classes('flex items-center', GAP[1])}>
            <button
              type="button"
              onClick={() => onToggleLike?.(post)}
              aria-label={isLiked ? 'Unlike' : 'Like'}
              aria-pressed={isLiked}
              className={ACTION_ICON}
            >
              <Heart className={classes(ICON.md, 'transition-colors stroke-[1.75]', isLiked
                ? classes(STATUS.dangerFg, 'fill-danger')
                : classes(COLOR.muted, COLOR.hoverFg),
              )} />
            </button>
            <button
              type="button"
              onClick={() => articleRef.current?.querySelector('input')?.focus()}
              aria-label="Comment"
              className={classes(ACTION_ICON, COLOR.muted, COLOR.hoverFg)}
            >
              <MessageCircle className={classes(ICON.md, 'stroke-[1.75]')} />
            </button>
            <button
              type="button"
              onClick={() => onOpenShare?.(post)}
              aria-label="Share post"
              className={classes(ACTION_ICON, COLOR.muted, COLOR.hoverFg)}
            >
              <Send className={classes(ICON.md, 'stroke-[1.75]')} />
            </button>
          </div>
          <div className={classes('flex items-center', GAP[1])}>
            <button
              type="button"
              onClick={() => onToggleSave?.(post)}
              aria-label={isSaved ? 'Remove from saved' : 'Save post'}
              aria-pressed={isSaved}
              className={ACTION_ICON}
            >
              <Bookmark className={classes(ICON.md, 'transition-colors stroke-[1.75]', isSaved
                ? classes(COLOR.fg, 'fill-retro-fg')
                : classes(COLOR.muted, COLOR.hoverFg),
              )} />
            </button>
            {onSaveToVault && primaryMedia && (
              <button
                type="button"
                onClick={() => onSaveToVault(post)}
                aria-label="Save to Vault"
                title="Save the media to your Vault (offline copy)"
                className={ACTION_ICON}
              >
                <FolderPlus className={classes(ICON.md, 'stroke-[1.75]', COLOR.muted, COLOR.hoverFg)} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Likes Summary — "Liked by Ana, Bo and 12 others" when the
          payload carries liker names, bare count otherwise. */}
      <button
        type="button"
        onClick={() => onOpenLikers?.(post.id)}
        className={classes(
          'text-left hover:underline cursor-pointer w-fit',
          PADDING_X[4], PADDING_Y[2], TYPE.body, WEIGHT.semibold,
          COLOR.fg, TRACKING.tight, TRANSITION.micro,
        )}
        aria-label="View who liked this post"
      >
        {likedByLabel || `${formatCount(likeCount)} ${likeCount === 1 ? 'like' : 'likes'}`}
      </button>

      {/* Peer-confirmed durability: a peer's signed receipt proved it stored
          these bytes. Absent until that proof exists — never inferred. */}
      {mediaItems.length > 0 && custody.label && (
        <div
          className={classes(
            'flex items-center', GAP[1], PADDING_X[4], PADDING_Y[2],
            TYPE.caption, WEIGHT.medium, COLOR.muted,
          )}
          aria-label="Media replication"
        >
          <ShieldCheck className={classes(ICON.sm, STATUS.success)} />
          <span>{custody.label}</span>
        </div>
      )}

      {/* Comments thread + composer, shared with the feed inline expansion. */}
      <PostComments
        post={post}
        comments={comments}
        commentsLoading={commentsLoading}
        onAddComment={onAddComment}
        onToggleCommentLike={onToggleCommentLike}
        onReportComment={onReportComment}
      />
    </article>
  );
}
