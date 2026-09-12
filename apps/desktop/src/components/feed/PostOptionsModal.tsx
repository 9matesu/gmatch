"use client";

import {
  Repeat,
  Send,
  Link2,
  Archive,
  Trash2,
  Flag,
  X,
} from 'lucide-react';
import type { FeedPost } from './GMatchFeed';

interface PostOptionsModalProps {
  post: FeedPost;
  onClose: () => void;
  identityOrbitId?: string | null;
  onRepost?: (post: FeedPost) => void;
  onShare?: (post: FeedPost) => void;
  onCopyLink?: (post: FeedPost) => void;
  onArchive?: (postId: string) => void;
  onDelete?: (postId: string) => void;
  onReport?: (post: FeedPost) => void;
  toast?: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
}

export function PostOptionsModal({
  post,
  onClose,
  identityOrbitId,
  onRepost,
  onShare,
  onCopyLink,
  onArchive,
  onDelete,
  onReport,
  toast,
}: PostOptionsModalProps) {
  const isOwner = identityOrbitId && post.author_id === identityOrbitId;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-0 sm:p-4 animate-orbit-fade-in select-none"
      onClick={onClose}
    >
      <div
        className="bg-surface-raised w-full max-w-sm rounded-xl border border-border-glass shadow-2xl overflow-hidden animate-orbit-slide-up divide-y divide-border-glass text-center text-xs font-semibold relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button in top-right */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-2 right-2 z-10 text-retro-muted hover:text-retro-fg p-1.5 rounded-full cursor-pointer hover:bg-surface-interactive transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Repost */}
        <button
          type="button"
          onClick={() => {
            onRepost?.(post);
            toast?.('Post shared to your profile feed!', 'success');
            onClose();
          }}
          className="w-full py-3.5 hover:bg-glass-w5 text-emerald-600 font-bold flex items-center justify-center gap-2 cursor-pointer"
        >
          <Repeat className="w-4 h-4" />
          <span>Repost to Profile</span>
        </button>

        {/* Share */}
        <button
          type="button"
          onClick={() => {
            onShare?.(post);
            onClose();
          }}
          className="w-full py-3.5 hover:bg-glass-w5 text-retro-fg flex items-center justify-center gap-2 cursor-pointer"
        >
          <Send className="w-4 h-4" />
          <span>Share To Direct / Groups</span>
        </button>

        {/* Copy Link */}
        <button
          type="button"
          onClick={() => {
            onCopyLink?.(post);
            onClose();
          }}
          className="w-full py-3.5 hover:bg-glass-w5 text-retro-fg flex items-center justify-center gap-2 cursor-pointer"
        >
          <Link2 className="w-4 h-4" />
          <span>Copy Link</span>
        </button>

        {/* Owner specific: Archive & Delete */}
        {isOwner ? (
          <>
            <button
              type="button"
              onClick={() => {
                onArchive?.(post.id);
                toast?.('Post moved to archive', 'info');
                onClose();
              }}
              className="w-full py-3.5 hover:bg-glass-w5 text-amber-600 flex items-center justify-center gap-2 cursor-pointer"
            >
              <Archive className="w-4 h-4" />
              <span>Archive Post</span>
            </button>
            <button
              type="button"
              onClick={() => {
                onDelete?.(post.id);
                toast?.('Post deleted', 'success');
                onClose();
              }}
              className="w-full py-3.5 hover:bg-glass-w5 text-red-600 font-bold flex items-center justify-center gap-2 cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
              <span>Delete Post</span>
            </button>
          </>
        ) : (
          /* Non-owner: Report Post */
          <button
            type="button"
            onClick={() => {
              onReport?.(post);
              onClose();
            }}
            className="w-full py-3.5 hover:bg-glass-w5 text-red-600 font-bold flex items-center justify-center gap-2 cursor-pointer"
          >
            <Flag className="w-4 h-4" />
            <span>Report Post</span>
          </button>
        )}

        {/* Cancel Button */}
        <button
          type="button"
          onClick={onClose}
          className="w-full py-3.5 hover:bg-glass-w5 text-retro-muted font-normal cursor-pointer"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
