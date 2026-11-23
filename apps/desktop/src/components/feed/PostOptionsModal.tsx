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
  /** Each action is optional: a surface that cannot do it must not show it. */
  onRepost?: (post: FeedPost) => void;
  onShare?: (post: FeedPost) => void;
  onCopyLink?: (post: FeedPost) => void;
  onArchive?: (postId: string) => void;
  onDelete?: (postId: string) => void;
  onReport?: (post: FeedPost) => void;
  /** Stacking override for options opened above higher-z overlays. */
  zIndexClass?: string;
}

/**
 * The post action sheet.
 *
 * Every row is gated on its handler. This sheet used to render "Repost to
 * Profile" unconditionally and fire a success toast from inside the click
 * handler, so on a surface that never passed \`onRepost\` (the profile
 * lightbox) the button appeared, the toast claimed "Post shared to your
 * profile feed!", and nothing happened. A missing handler now removes the row
 * instead of faking the outcome, and the caller owns whatever toast the action
 * deserves.
 */
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
  zIndexClass = 'z-[var(--z-modal)]',
}: PostOptionsModalProps) {
  const isOwner = identityOrbitId && post.author_id === identityOrbitId;

  // Run an action, then close. The caller owns the outcome and its own toast;
  // this sheet never claims success on the caller's behalf.
  const act = (fn: (() => void) | undefined) => {
    if (!fn) return;
    fn();
    onClose();
  };

  return (
    <div
      className={`fixed inset-0 ${zIndexClass} bg-black/70 backdrop-blur-sm flex items-center justify-center p-0 pb-[var(--island-clearance)] sm:p-4 sm:pb-[calc(1rem+var(--island-clearance))] animate-orbit-fade-in select-none`}
      onClick={onClose}
    >
      <div
        className="bg-surface-raised w-full max-w-sm rounded-xl border border-edge shadow-2xl overflow-hidden animate-orbit-slide-up divide-y divide-edge text-center text-xs font-semibold relative"
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

        {onRepost && (
          <button
            type="button"
            onClick={() => act(() => onRepost(post))}
            className="w-full py-3.5 hover:bg-glass-w5 text-success-fg font-bold flex items-center justify-center gap-2 cursor-pointer"
          >
            <Repeat className="w-4 h-4" />
            <span>Repost to Profile</span>
          </button>
        )}

        {onShare && (
          <button
            type="button"
            onClick={() => act(() => onShare(post))}
            className="w-full py-3.5 hover:bg-glass-w5 text-retro-fg flex items-center justify-center gap-2 cursor-pointer"
          >
            <Send className="w-4 h-4" />
            <span>Share To Direct / Groups</span>
          </button>
        )}

        {onCopyLink && (
          <button
            type="button"
            onClick={() => act(() => onCopyLink(post))}
            className="w-full py-3.5 hover:bg-glass-w5 text-retro-fg flex items-center justify-center gap-2 cursor-pointer"
          >
            <Link2 className="w-4 h-4" />
            <span>Copy Link</span>
          </button>
        )}

        {isOwner && onArchive && (
          <button
            type="button"
            onClick={() => act(() => onArchive(post.id))}
            className="w-full py-3.5 hover:bg-glass-w5 text-warning-fg flex items-center justify-center gap-2 cursor-pointer"
          >
            <Archive className="w-4 h-4" />
            <span>Archive Post</span>
          </button>
        )}

        {isOwner && onDelete && (
          <button
            type="button"
            onClick={() => act(() => onDelete(post.id))}
            className="w-full py-3.5 hover:bg-glass-w5 text-danger-fg font-bold flex items-center justify-center gap-2 cursor-pointer"
          >
            <Trash2 className="w-4 h-4" />
            <span>Delete Post</span>
          </button>
        )}

        {!isOwner && onReport && (
          <button
            type="button"
            onClick={() => act(() => onReport(post))}
            className="w-full py-3.5 hover:bg-glass-w5 text-danger-fg font-bold flex items-center justify-center gap-2 cursor-pointer"
          >
            <Flag className="w-4 h-4" />
            <span>Report Post</span>
          </button>
        )}

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