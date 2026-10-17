"use client";

import { useState } from 'react';
import { Heart, Flag } from 'lucide-react';
import { playMsgReceive } from '../../utils/sounds';
import { resolveMediaUrl } from '../../utils/media';
import { formatAbsoluteTime, timeAgo } from '../../utils/timeAgo';
import { Linkify } from '../Linkify';
import type { FeedPost, PostComment } from './GMatchFeed';

/**
 * Comments stream + composer shared by the inline expansion and the legacy
 * lightbox. Markup mirrors the modal 1:1 (same classes, same aria labels) so
 * both surfaces behave identically; the modal owns layout, this owns content.
 */
export function PostComments({
  post,
  comments = [],
  commentsLoading = false,
  authorAvatar = '',
  onAuthorClick,
  onAddComment,
  onToggleCommentLike,
  onReportComment,
}: {
  post: FeedPost;
  comments?: PostComment[];
  commentsLoading?: boolean;
  authorAvatar?: string;
  onAuthorClick?: () => void;
  onAddComment?: (postId: string, text: string) => void;
  onToggleCommentLike?: (postId: string, commentId: string) => void;
  onReportComment?: (commentId: string) => void;
}) {
  const [commentInput, setCommentInput] = useState('');

  const handleSendComment = () => {
    if (!commentInput.trim()) return;
    playMsgReceive();
    onAddComment?.(post.id, commentInput.trim());
    setCommentInput('');
  };

  return (
    <>
      {/* Comments Stream (Original Caption + Real Comments) */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 max-h-[300px] md:max-h-[420px] select-text">
        {/* Caption item */}
        {post.caption && (
          <div className="flex items-start gap-3 pb-3 border-b border-border-glass">
            <div
              className="w-8 h-8 rounded-full bg-surface-interactive overflow-hidden shrink-0 flex items-center justify-center text-xs font-bold text-retro-fg cursor-pointer"
              onClick={onAuthorClick}
            >
              {authorAvatar ? (
                <img src={authorAvatar} alt="" className="w-full h-full object-cover" />
              ) : (
                post.author_name.charAt(0).toUpperCase()
              )}
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-xs font-extrabold text-retro-fg mr-1.5">{post.author_name}</span>
              <Linkify text={post.caption} linkClassName="text-xs text-retro-body leading-relaxed underline break-all" />

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
                {formatAbsoluteTime(post.created_at, { dateStyle: 'short' }) || 'Recent'}
              </span>
            </div>
          </div>
        )}

        {/* Comments List */}
        {comments.map((c) => (
          <div key={c.id} className={`flex items-start justify-between gap-2 ${c.pending ? 'opacity-60' : ''}`}>
            <div className="flex items-start gap-2.5">
              <div className="w-7 h-7 rounded-full bg-surface-interactive overflow-hidden shrink-0 flex items-center justify-center text-[10px] font-bold text-retro-fg">
                {c.author_avatar ? (
                  <img src={resolveMediaUrl(c.author_avatar)} alt="" className="w-full h-full object-cover" />
                ) : (
                  // A P2P/legacy row can arrive without an author_name;
                  // charAt on undefined would blank the whole modal.
                  (c.author_name || '?').charAt(0).toUpperCase()
                )}
              </div>
              <div>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-xs font-bold text-retro-fg">{c.author_name}</span>
                  <span className="text-[10px] text-retro-muted">{timeAgo(c.created_at)}</span>
                  {c.pending && <span className="text-[10px] text-retro-muted italic">sending…</span>}
                </div>
                <p className="text-xs text-retro-body mt-0.5 leading-relaxed">
                  <Linkify text={c.text} />
                </p>
              </div>
            </div>

            <div className="flex items-start gap-0.5 shrink-0">
              <button
                type="button"
                onClick={() => onReportComment?.(c.id)}
                aria-label={`Report comment by ${c.author_name || 'user'}`}
                className="p-1 text-retro-muted hover:text-retro-error cursor-pointer"
              >
                <Flag className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onToggleCommentLike?.(post.id, c.id)}
                aria-label={c.is_liked ? 'Comment liked' : 'Like comment'}
                aria-pressed={!!c.is_liked}
                disabled={c.pending}
                className="p-1 text-retro-muted hover:text-red-500 cursor-pointer disabled:cursor-default"
              >
                <Heart className={`w-3.5 h-3.5 ${c.is_liked ? 'text-red-500 fill-red-500' : ''}`} />
                {c.like_count > 0 && (
                  <span className="text-[10px] font-bold block text-center mt-0.5 text-retro-muted">{c.like_count}</span>
                )}
              </button>
            </div>
          </div>
        ))}

        {commentsLoading && (
          <div className="py-8 text-center text-xs text-retro-muted" role="status">
            Loading comments…
          </div>
        )}

        {!commentsLoading && comments.length === 0 && (
          <div className="py-8 text-center text-xs text-retro-muted italic">
            No comments yet. Be the first to leave a comment!
          </div>
        )}
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
          aria-label="Add a comment"
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
    </>
  );
}
