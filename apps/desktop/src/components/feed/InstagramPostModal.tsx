"use client";

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { playPress, playWin, playMsgReceive } from '../../utils/sounds';
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
import { isMediaVideo } from '../../utils/media';

export function InstagramPostModal({ post, isOpen, onClose, identity, profilePics = {}, isLiked = false, isSaved = false, likeCount = 0, comments = [], onToggleLike, onToggleSave, onAddComment, onToggleCommentLike, onOpenShare, onOptionsClick, onSelectUser, onAvatarClick, onOpenNetwork }: {
  post: FeedPost | null;
  isOpen: boolean;
  onClose: () => void;
  identity: OrbitIdentity | null;
  profilePics?: Record<string, string>;
  isLiked?: boolean;
  isSaved?: boolean;
  likeCount?: number;
  comments?: PostComment[];
  onToggleLike?: (post: FeedPost) => void;
  onToggleSave?: (post: FeedPost) => void;
  onAddComment?: (postId: string, text: string) => void;
  onToggleCommentLike?: (postId: string, commentId: string) => void;
  onOpenShare?: (post: FeedPost) => void;
  onOptionsClick?: (post: FeedPost) => void;
  onSelectUser?: (userId: string) => void;
  onAvatarClick?: (userId: string) => void;
  onOpenNetwork?: (userId: string) => void;
  toast?: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}) {
  const [commentInput, setCommentInput] = useState('');
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [activeMediaIndex, setActiveMediaIndex] = useState(0);
  const [doubleTapAnimation, setDoubleTapAnimation] = useState(false);

  // If the post has multiple media urls or fallback array
  const mediaList = post ? [(post as any).url, ...((post as any).mediaUrls || [])].filter(Boolean) : [];

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

  const handleSendComment = () => {
    if (!commentInput.trim() || !post) return;
    playMsgReceive();
    onAddComment?.(post.id, commentInput.trim());
    setCommentInput('');
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

  if (!isOpen || !post) return null;

  const authorAvatar = profilePics[post.author_id] || post.author_avatar;

  return createPortal(
    (
      <div
        className="fixed inset-0 z-[var(--z-modal)] bg-black/70 backdrop-blur-sm flex items-center justify-center p-0 sm:p-4 md:p-6 animate-orbit-fade-in select-none"
        onClick={onClose}
      >
        {/* Close button in top-right */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 z-50 text-retro-muted hover:text-white p-2 rounded-full cursor-pointer bg-retro-panel/80 hover:bg-glass-w12 border border-border-glass transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Main 2-Column Dialog */}
        <div
          className="bg-retro-panel text-retro-fg w-full max-w-5xl h-full sm:h-auto sm:max-h-[90vh] rounded-none sm:rounded-xl border border-border-glass shadow-2xl overflow-hidden flex flex-col md:flex-row animate-orbit-slide-up"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Left Column: Media Viewer with Multi-Media Carousel & Zoom */}
          <div
            className="relative flex-1 bg-black flex items-center justify-center overflow-hidden min-h-[340px] md:min-h-[580px] max-h-[50vh] md:max-h-none"
            onDoubleClick={handleDoubleTap}
          >
            {isMediaVideo(mediaList[activeMediaIndex] || post.url) ? (
              <NativeVideoPlayer
                src={mediaList[activeMediaIndex] || post.url}
                className="w-full h-full max-h-[85vh] object-contain"
                videoClassName="w-full h-full max-h-[85vh] object-contain"
                autoPlay={true}
                controls={true}
                loop={true}
                muted={false}
                onDoubleTapLike={handleDoubleTap}
              />
            ) : (
              <div
                className="w-full h-full flex items-center justify-center transition-transform duration-300 ease-out cursor-zoom-in"
                style={{ transform: `scale(${zoomLevel})` }}
                onClick={handleZoomToggle}
              >
                <ObjectImage
                  contentUrl={mediaList[activeMediaIndex] || post.url}
                  objectId={null}
                  identity={identity}
                  alt=""
                  className="w-full h-full object-contain max-h-[85vh]"
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
            {mediaList.length > 1 && (
              <>
                {activeMediaIndex > 0 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      playPress(700);
                      setActiveMediaIndex((i) => Math.max(0, i - 1));
                    }}
                    className="absolute left-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 text-white hover:bg-black/80 cursor-pointer"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                )}
                {activeMediaIndex < mediaList.length - 1 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      playPress(700);
                      setActiveMediaIndex((i) => Math.min(mediaList.length - 1, i + 1));
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 text-white hover:bg-black/80 cursor-pointer"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                )}

                {/* Dots indicator */}
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 z-10 bg-black/60 px-2 py-1 rounded-full">
                  {mediaList.map((_, idx) => (
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
                className="flex items-center gap-1 hover:text-retro-fg cursor-pointer"
              >
                {zoomLevel > 1 ? <ZoomOut className="w-3.5 h-3.5" /> : <ZoomIn className="w-3.5 h-3.5" />}
                <span className="font-mono">{Math.round(zoomLevel * 100)}%</span>
              </button>
            </div>
          </div>

          {/* Right Column: Author, Caption, Comments Stream & Input */}
          <div className="w-full md:w-[380px] lg:w-[420px] bg-retro-bg flex flex-col justify-between border-t md:border-t-0 md:border-l border-border-glass h-full">
            {/* Header */}
            <div className="p-3.5 border-b border-border-glass flex items-center justify-between">
              <div
                className="flex items-center gap-3 cursor-pointer"
                onClick={handleAuthorClick}
              >
                <div className="w-8 h-8 rounded-full bg-glass-w12 border border-border-glass p-[1px] flex-shrink-0">
                  <div className="w-full h-full rounded-full bg-retro-panel overflow-hidden flex items-center justify-center text-xs font-semibold text-retro-fg">
                    {authorAvatar ? (
                      <img src={authorAvatar} alt="" className="w-full h-full object-cover" />
                    ) : (
                      post.author_name.charAt(0).toUpperCase()
                    )}
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-1">
                    <span className="text-xs font-semibold text-retro-fg hover:underline">{post.author_name}</span>
                  </div>
                  {post.location && (
                    <span className="text-[10px] text-retro-muted font-medium block">{post.location}</span>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={() => onOptionsClick?.(post)}
                className="p-1.5 text-retro-muted hover:text-retro-fg rounded-md cursor-pointer hover:bg-glass-w12 transition-colors"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>
            </div>

            {/* Comments Stream (Original Caption + Real Comments) */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 max-h-[300px] md:max-h-[420px] select-text">
              {/* Caption item */}
              {post.caption && (
                <div className="flex items-start gap-3 pb-3 border-b border-border-glass">
                  <div
                    className="w-8 h-8 rounded-full bg-surface-interactive overflow-hidden shrink-0 flex items-center justify-center text-xs font-bold text-retro-fg cursor-pointer"
                    onClick={handleAuthorClick}
                  >
                    {authorAvatar ? (
                      <img src={authorAvatar} alt="" className="w-full h-full object-cover" />
                    ) : (
                      post.author_name.charAt(0).toUpperCase()
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-extrabold text-retro-fg mr-1.5">{post.author_name}</span>
                    <span className="text-xs text-retro-body leading-relaxed">{post.caption}</span>

                    {/* Clickable Tags */}
                    {post.tags && post.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {post.tags.map((t) => (
                          <span key={t} className="text-xs font-semibold text-retro-accent hover:underline cursor-pointer">
                            #{t.replace(/^#/, '')}
                          </span>
                        ))}
                      </div>
                    )}

                    <span className="text-[10px] text-retro-muted font-medium block mt-1">
                      {post.created_at ? new Date(post.created_at).toLocaleDateString() : 'Recent'}
                    </span>
                  </div>
                </div>
              )}

              {/* Comments List */}
              {comments.map((c) => (
                <div key={c.id} className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2.5">
                    <div className="w-7 h-7 rounded-full bg-surface-interactive overflow-hidden shrink-0 flex items-center justify-center text-[10px] font-bold text-retro-fg">
                      {c.author_avatar ? (
                        <img src={c.author_avatar} alt="" className="w-full h-full object-cover" />
                      ) : (
                        c.author_name.charAt(0).toUpperCase()
                      )}
                    </div>
                    <div>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-xs font-bold text-retro-fg">{c.author_name}</span>
                        <span className="text-[10px] text-retro-muted">{c.created_at}</span>
                      </div>
                      <p className="text-xs text-retro-body mt-0.5 leading-relaxed">{c.text}</p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => onToggleCommentLike?.(post.id, c.id)}
                    className="p-1 text-retro-muted hover:text-red-500 cursor-pointer shrink-0"
                  >
                    <Heart className={`w-3.5 h-3.5 ${c.is_liked ? 'text-red-500 fill-red-500' : ''}`} />
                    {c.like_count > 0 && (
                      <span className="text-[10px] font-bold block text-center mt-0.5 text-retro-muted">{c.like_count}</span>
                    )}
                  </button>
                </div>
              ))}

              {comments.length === 0 && (
                <div className="py-8 text-center text-xs text-retro-muted italic">
                  No comments yet. Be the first to leave a comment!
                </div>
              )}
            </div>

            {/* Action Bar & Input */}
            <div className="border-t border-border-glass bg-retro-bg flex flex-col">
              {/* Actions */}
              <div className="p-3 pb-2 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => onToggleLike?.(post)}
                    className="cursor-pointer transition-transform duration-150 active:scale-[0.92]"
                  >
                    <Heart
                      className={`w-5 h-5 transition-colors stroke-[1.75] ${isLiked ? 'text-rose-500 fill-rose-500' : 'text-retro-muted hover:text-retro-fg'
                        }`}
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenShare?.(post)}
                    className="text-retro-muted hover:text-retro-fg cursor-pointer transition-transform duration-150 active:scale-[0.92]"
                  >
                    <Send className="w-5 h-5 stroke-[1.75]" />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => onToggleSave?.(post)}
                  className="cursor-pointer transition-transform duration-150 active:scale-[0.92]"
                >
                  <Bookmark
                    className={`w-5 h-5 transition-colors stroke-[1.75] ${isSaved ? 'text-white fill-white' : 'text-retro-muted hover:text-retro-fg'
                      }`}
                  />
                </button>
              </div>

              {/* Likes Summary */}
              <div className="px-3 pb-2 text-xs font-semibold text-retro-fg font-mono tracking-tight">
                {likeCount.toLocaleString()} {likeCount === 1 ? 'like' : 'likes'}
              </div>

              {/* Comment Input */}
              <div className="p-3 border-t border-border-glass flex items-center gap-2">
                <input
                  type="text"
                  value={commentInput}
                  onChange={(e) => setCommentInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleSendComment();
                    }
                  }}
                  placeholder="Add a comment..."
                  className="flex-1 bg-retro-panel border border-border-glass rounded-md px-3.5 py-2 text-xs text-retro-fg placeholder:text-retro-muted outline-none focus:border-border-glass transition-colors"
                />
                <button
                  type="button"
                  onClick={handleSendComment}
                  disabled={!commentInput.trim()}
                  className="px-4 py-2 bg-white text-retro-bg hover:bg-retro-fg disabled:opacity-40 rounded-md text-xs font-semibold cursor-pointer transition-all duration-150 active:scale-[0.96] shadow-xs"
                >
                  Post
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    ),
    document.body
  );
}
