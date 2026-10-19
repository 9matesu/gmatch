"use client";

import { Fragment, useEffect, useRef, useState } from 'react';
import { Heart, Flag, X, CornerDownRight } from 'lucide-react';
import { playMsgReceive } from '../../utils/sounds';
import { resolveMediaUrl } from '../../utils/media';
import { formatAbsoluteTime, timeAgo } from '../../utils/timeAgo';
import { Linkify } from '../Linkify';
import type { FeedPost, PostComment } from './GMatchFeed';

/**
 * Comments stream + composer shared by the inline expansion and the legacy
 * lightbox. Markup mirrors the modal 1:1 (same classes, same aria labels) so
 * both surfaces behave identically; the modal owns layout, this owns content.
 *
 * Replies are first-class: a comment carrying `parent_comment_id` renders
 * nested under its parent (and the composer can target one), because the server
 * now persists and returns that column — replies used to be indistinguishable
 * from top-level comments.
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
  focusCommentId,
}: {
  post: FeedPost;
  comments?: PostComment[];
  commentsLoading?: boolean;
  authorAvatar?: string;
  onAuthorClick?: () => void;
  onAddComment?: (postId: string, text: string, parentCommentId?: string | null) => void;
  onToggleCommentLike?: (postId: string, commentId: string) => void;
  onReportComment?: (commentId: string) => void;
  /** Comment to scroll to and spotlight (notification deep links). */
  focusCommentId?: string | null;
}) {
  const [commentInput, setCommentInput] = useState('');
  const [replyTo, setReplyTo] = useState<PostComment | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (replyTo) inputRef.current?.focus();
  }, [replyTo]);

  // Spotlight the comment a notification pointed at. Re-runs when the list
  // changes, because the deep link usually arrives before the fetch resolves.
  useEffect(() => {
    if (!focusCommentId) return;
    if (!comments.some((c) => c.id === focusCommentId)) return;
    const el = document.getElementById(`gmatch-comment-${focusCommentId}`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setFlashId(focusCommentId);
    const t = setTimeout(() => setFlashId(null), 2500);
    return () => clearTimeout(t);
  }, [focusCommentId, comments]);

  // Fold the flat list into parents + children. A reply whose parent is not in
  // this page (deleted, or beyond the fetched slice) stays visible as a
  // top-level row — dropping it would hide a real comment.
  const byId = new Map(comments.map((c) => [c.id, c]));
  const repliesByParent = new Map<string, PostComment[]>();
  const topLevel: PostComment[] = [];
  for (const c of comments) {
    const parent = c.parent_comment_id ? byId.get(c.parent_comment_id) : undefined;
    if (parent) {
      const list = repliesByParent.get(parent.id);
      if (list) list.push(c);
      else repliesByParent.set(parent.id, [c]);
    } else {
      topLevel.push(c);
    }
  }

  const handleSendComment = () => {
    if (!commentInput.trim()) return;
    playMsgReceive();
    onAddComment?.(post.id, commentInput.trim(), replyTo?.id ?? null);
    setCommentInput('');
    setReplyTo(null);
  };

  const renderComment = (c: PostComment, isReply: boolean) => (
    <div
      id={`gmatch-comment-${c.id}`}
      className={`flex items-start justify-between gap-2 rounded-md transition-colors ${c.pending ? 'opacity-60' : ''} ${
        isReply ? 'ml-8 border-l border-border-glass pl-3' : ''
      } ${flashId === c.id ? 'ring-2 ring-retro-accent/70 ring-offset-0' : ''}`}
    >
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
          onClick={() => setReplyTo(c)}
          disabled={c.pending}
          aria-label={`Reply to comment by ${c.author_name || 'user'}`}
          className="p-1 text-retro-muted hover:text-retro-fg cursor-pointer disabled:cursor-default"
        >
          <CornerDownRight className="w-3.5 h-3.5" />
        </button>
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
  );

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

        {/* Comments List — parents with their replies folded beneath */}
        {topLevel.map((c) => (
          <Fragment key={c.id}>
            {renderComment(c, false)}
            {(repliesByParent.get(c.id) || []).map((r) => (
              <Fragment key={r.id}>{renderComment(r, true)}</Fragment>
            ))}
          </Fragment>
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
      <div className="border-t border-border-glass">
        {replyTo && (
          <div className="flex items-center justify-between gap-2 px-3 pt-2 text-[10px] text-retro-muted">
            <span className="truncate">
              Replying to{' '}
              <strong className="font-semibold text-retro-body">{replyTo.author_name || 'user'}</strong>
            </span>
            <button
              type="button"
              onClick={() => setReplyTo(null)}
              aria-label="Cancel reply"
              className="p-0.5 rounded hover:text-retro-fg cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
        <div className="p-3 flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={commentInput}
            onChange={(e) => setCommentInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleSendComment();
              }
              if (e.key === 'Escape' && replyTo) {
                e.preventDefault();
                setReplyTo(null);
              }
            }}
            placeholder={replyTo ? `Reply to ${replyTo.author_name || 'user'}…` : 'Add a comment...'}
            aria-label={replyTo ? `Reply to ${replyTo.author_name || 'user'}` : 'Add a comment'}
            className="flex-1 bg-retro-panel border border-border-glass rounded-md px-3.5 py-2 text-xs text-retro-fg placeholder:text-retro-muted outline-none focus:border-border-glass transition-colors"
          />
          <button
            type="button"
            onClick={handleSendComment}
            disabled={!commentInput.trim()}
            className="px-4 py-2 bg-white text-retro-bg hover:bg-retro-fg disabled:opacity-40 rounded-md text-xs font-semibold cursor-pointer transition-all duration-150 active:scale-[0.96] shadow-xs"
          >
            {replyTo ? 'Reply' : 'Post'}
          </button>
        </div>
      </div>
    </>
  );
}
