"use client";

import { useState } from 'react';
import { playPress, playMsgReceive } from '../../utils/sounds';
import {
  MessageCircle,
  X,
  Heart,
  Flame,
  Zap,
  Crown,
  Flag,
} from 'lucide-react';
import type { FeedPost, PostComment } from './GMatchFeed';

interface CommentsModalProps {
  post: FeedPost;
  onClose: () => void;
  comments: PostComment[];
  profilePics?: Record<string, string>;
  onAddComment: (postId: string, text: string) => void;
  onToggleCommentLike: (postId: string, commentId: string) => void;
  onAvatarClick?: (userId: string) => void;
  onReportComment?: (commentId: string) => void;
  toast?: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

export function CommentsModal({
  post,
  onClose,
  comments,
  profilePics = {},
  onAddComment,
  onToggleCommentLike,
  onAvatarClick,
  onReportComment,
  toast,
}: CommentsModalProps) {
  const [commentInput, setCommentInput] = useState('');

  const handleAddComment = () => {
    const text = commentInput.trim();
    if (!text) return;
    playMsgReceive();
    onAddComment(post.id, text);
    setCommentInput('');
    toast?.('Comment posted!', 'success');
  };

  const handleToggleCommentLike = (commentId: string) => {
    playPress(850);
    onToggleCommentLike(post.id, commentId);
  };

  const handleAvatarClick = (userId: string) => {
    onAvatarClick?.(userId);
  };

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-orbit-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-surface-raised w-full max-w-md rounded-t-3xl sm:rounded-xl border border-border-glass shadow-2xl overflow-hidden flex flex-col h-[75vh] max-h-[600px] animate-orbit-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Comments Header */}
        <div className="p-4 border-b border-border-glass flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageCircle className="w-5 h-5 text-retro-fg" />
            <h3 className="text-sm font-extrabold text-retro-fg">Comments</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-full text-retro-muted hover:text-retro-fg cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Comments Scrollable Stream */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Original Post Caption */}
          {post.caption && (
            <div className="flex items-start gap-3 pb-3 border-b border-border-glass">
              <div
                className="w-8 h-8 rounded-full bg-glass-w20 overflow-hidden shrink-0 cursor-pointer hover:scale-105 transition-transform"
                onClick={() => handleAvatarClick(post.author_id)}
              >
                {profilePics[post.author_id] ? (
                  <img src={profilePics[post.author_id]} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="w-full h-full flex items-center justify-center text-xs font-bold">{post.author_name.charAt(0)}</span>
                )}
              </div>
              <div className="flex-1">
                <span
                  className="text-xs font-bold text-retro-fg mr-1.5 cursor-pointer hover:underline"
                  onClick={() => handleAvatarClick(post.author_id)}
                >
                  {post.author_name}
                </span>
                <span className="text-xs text-retro-body leading-relaxed">{post.caption}</span>
                <span className="text-[10px] text-retro-muted block mt-1">Author</span>
              </div>
            </div>
          )}

          {/* Comments List */}
          {comments.map((c) => (
            <div key={c.id} className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div
                  className="w-8 h-8 rounded-full bg-glass-w20 overflow-hidden shrink-0 flex items-center justify-center text-xs font-bold cursor-pointer hover:scale-105 transition-transform"
                  onClick={() => handleAvatarClick(c.author_id || post.author_id)}
                >
                  {c.author_avatar ? (
                    <img src={c.author_avatar} alt="" className="w-full h-full object-cover" />
                  ) : (
                    c.author_name.charAt(0).toUpperCase()
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span
                      className="text-xs font-bold text-retro-fg cursor-pointer hover:underline"
                      onClick={() => handleAvatarClick(c.author_id || post.author_id)}
                    >
                      {c.author_name}
                    </span>
                    <span className="text-[10px] text-retro-muted">{c.created_at}</span>
                  </div>
                  <p className="text-xs text-retro-body mt-0.5 leading-relaxed">{c.text}</p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => handleToggleCommentLike(c.id)}
                className="p-1 text-retro-muted hover:text-red-500 cursor-pointer shrink-0"
              >
                <Heart className={`w-4 h-4 ${c.is_liked ? 'text-red-500 fill-red-500' : ''}`} />
                {c.like_count > 0 && <span className="text-[10px] font-bold block text-center mt-0.5">{c.like_count}</span>}
              </button>

              <button
                type="button"
                title="Report this comment"
                onClick={() => onReportComment?.(c.id)}
                className="p-1 text-retro-muted hover:text-rose-400 cursor-pointer shrink-0"
              >
                <Flag className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}

          {comments.length === 0 && (
            <div className="py-8 text-center text-xs text-retro-muted italic">
              No comments yet. Be the first to share your perverted thoughts!
            </div>
          )}
        </div>

        {/* Quick Reactions Bar */}
        <div className="px-4 py-2 border-t border-border-glass bg-surface-interactive flex items-center justify-start gap-3">
          <button
            type="button"
            onClick={() => setCommentInput((prev) => prev + " ❤️")}
            className="text-xs text-retro-muted hover:text-red-500 flex items-center gap-1 font-semibold cursor-pointer transition-colors"
          >
            <Heart className="w-3.5 h-3.5 text-red-500 fill-red-500" />
            <span>Love</span>
          </button>
          <button
            type="button"
            onClick={() => setCommentInput((prev) => prev + " hot")}
            className="text-xs text-retro-muted hover:text-orange-500 flex items-center gap-1 font-semibold cursor-pointer transition-colors"
          >
            <Flame className="w-3.5 h-3.5 text-orange-500" />
            <span>Fire</span>
          </button>
          <button
            type="button"
            onClick={() => setCommentInput((prev) => prev + " ⚡")}
            className="text-xs text-retro-muted hover:text-amber-500 flex items-center gap-1 font-semibold cursor-pointer transition-colors"
          >
            <Zap className="w-3.5 h-3.5 text-amber-500" />
            <span>Hype</span>
          </button>
          <button
            type="button"
            onClick={() => setCommentInput((prev) => prev + " 👑")}
            className="text-xs text-retro-muted hover:text-yellow-500 flex items-center gap-1 font-semibold cursor-pointer transition-colors"
          >
            <Crown className="w-3.5 h-3.5 text-yellow-500" />
            <span>Crown</span>
          </button>
        </div>

        {/* Add Comment Input Bar */}
        <div className="p-3 border-t border-border-glass bg-surface-raised flex items-center gap-2">
          <input
            type="text"
            value={commentInput}
            onChange={(e) => setCommentInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAddComment();
              }
            }}
            placeholder="Add a comment for this post..."
            className="flex-1 bg-surface-interactive border border-border-glass rounded-xl px-3.5 py-2 text-xs text-retro-fg outline-none focus:border-black"
          />
          <button
            type="button"
            onClick={handleAddComment}
            disabled={!commentInput.trim()}
            className="px-4 py-2 bg-black hover:bg-surface-elevated disabled:opacity-40 text-white rounded-xl text-xs font-bold cursor-pointer"
          >
            Post
          </button>
        </div>
      </div>
    </div>
  );
}
