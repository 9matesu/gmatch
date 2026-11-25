"use client";

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Archive,
  Bookmark,
  Flag,
  Heart,
  Link2,
  Pencil,
  Repeat,
  Send,
  Share2,
  Trash2,
} from 'lucide-react';
import type { FeedPost } from './GMatchFeed';

/**
 * The post context menu — right-click on a post.
 *
 * This REPLACES the three-dots button. The menu opens at the cursor (the
 * way every native menu does) and carries every action a post has: like,
 * save, save-to-vault, repost, share, copy link, edit, archive, delete and
 * report.
 *
 * Two rules the sheet kept:
 *  - every row is gated on its handler: a surface that cannot do something
 *    must not show it (a button that appears and does nothing is worse than
 *    a missing button);
 *  - the menu never claims an outcome. It closes after firing the action and
 *    the CALLER owns the toast.
 */
export interface PostContextMenuProps {
  post: FeedPost;
  /** Where the menu opens — the cursor position of the right-click. */
  x: number;
  y: number;
  onClose: () => void;
  identityOrbitId?: string | null;
  isLiked?: boolean;
  isSaved?: boolean;
  onToggleLike?: (post: FeedPost) => void;
  onToggleSave?: (post: FeedPost) => void;
  onSaveToVault?: (post: FeedPost) => void;
  onRepost?: (post: FeedPost) => void;
  onShare?: (post: FeedPost) => void;
  onCopyLink?: (post: FeedPost) => void;
  onEdit?: (post: FeedPost) => void;
  onArchive?: (postId: string) => void;
  onDelete?: (postId: string) => void;
  onReport?: (post: FeedPost) => void;
  /** Stacking override for menus opened above higher-z overlays. */
  zIndexClass?: string;
}

interface MenuRow {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: 'default' | 'success' | 'warning' | 'danger';
  run: () => void;
}

const TONE_CLASS: Record<NonNullable<MenuRow['tone']>, string> = {
  default: 'text-retro-fg',
  success: 'text-success-fg',
  warning: 'text-warning-fg',
  danger: 'text-danger-fg',
};

export function PostContextMenu({
  post,
  x,
  y,
  onClose,
  identityOrbitId,
  isLiked = false,
  isSaved = false,
  onToggleLike,
  onToggleSave,
  onSaveToVault,
  onRepost,
  onShare,
  onCopyLink,
  onEdit,
  onArchive,
  onDelete,
  onReport,
  zIndexClass = 'z-[var(--z-modal)]',
}: PostContextMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  const isOwner = !!identityOrbitId && post.author_id === identityOrbitId;

  // Keep the menu on screen: it opens at the cursor, so a right-click near
  // the bottom-right corner would push half of it off the viewport.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    let left = x;
    let top = y;
    if (left + rect.width + margin > window.innerWidth) {
      left = Math.max(margin, window.innerWidth - rect.width - margin);
    }
    if (top + rect.height + margin > window.innerHeight) {
      top = Math.max(margin, window.innerHeight - rect.height - margin);
    }
    setPos({ left, top });
  }, [x, y]);

  // Dismiss: outside click, Escape, scroll, resize.
  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onClose);
    window.addEventListener('scroll', onClose, true);
    return () => {
      window.removeEventListener('mousedown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  // Run an action, then close. The caller owns the outcome and its toast.
  const act = (fn: (() => void) | undefined) => {
    if (!fn) return;
    fn();
    onClose();
  };

  const rows: MenuRow[] = [];
  if (onToggleLike) {
    rows.push({
      key: 'like',
      label: isLiked ? 'Unlike' : 'Like',
      icon: Heart,
      tone: isLiked ? 'success' : 'default',
      run: () => act(() => onToggleLike(post)),
    });
  }
  if (onToggleSave) {
    rows.push({
      key: 'save',
      label: isSaved ? 'Remove from Saved' : 'Save',
      icon: Bookmark,
      tone: isSaved ? 'success' : 'default',
      run: () => act(() => onToggleSave(post)),
    });
  }
  if (onSaveToVault) {
    rows.push({
      key: 'vault',
      label: 'Save to Vault',
      icon: Share2,
      run: () => act(() => onSaveToVault(post)),
    });
  }
  if (onRepost) {
    rows.push({
      key: 'repost',
      label: 'Repost to Profile',
      icon: Repeat,
      run: () => act(() => onRepost(post)),
    });
  }
  if (onShare) {
    rows.push({
      key: 'share',
      label: 'Share To Direct / Groups',
      icon: Send,
      run: () => act(() => onShare(post)),
    });
  }
  if (onCopyLink) {
    rows.push({
      key: 'copylink',
      label: 'Copy Link',
      icon: Link2,
      run: () => act(() => onCopyLink(post)),
    });
  }
  if (isOwner && onEdit) {
    rows.push({
      key: 'edit',
      label: 'Edit post',
      icon: Pencil,
      run: () => act(() => onEdit(post)),
    });
  }
  if (isOwner && onArchive) {
    rows.push({
      key: 'archive',
      label: 'Archive Post',
      icon: Archive,
      tone: 'warning',
      run: () => act(() => onArchive(post.id)),
    });
  }
  if (isOwner && onDelete) {
    rows.push({
      key: 'delete',
      label: 'Delete Post',
      icon: Trash2,
      tone: 'danger',
      run: () => act(() => onDelete(post.id)),
    });
  }
  if (!isOwner && onReport) {
    rows.push({
      key: 'report',
      label: 'Report Post',
      icon: Flag,
      tone: 'danger',
      run: () => act(() => onReport(post)),
    });
  }

  return (
    <div
      className={`fixed inset-0 ${zIndexClass}`}
      role="dialog"
      aria-modal="true"
      aria-label="Post options"
      onContextMenu={(e) => e.preventDefault()}
      onClick={onClose}
    >
      <div
        ref={ref}
        role="menu"
        aria-label="Post options"
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
        style={{ left: pos.left, top: pos.top }}
        className="fixed z-[1] min-w-[190px] max-w-[260px] overflow-hidden rounded-xl border border-edge bg-surface-raised shadow-2xl divide-y divide-edge animate-orbit-pop"
      >
        {rows.map((row) => {
          const Icon = row.icon;
          return (
            <button
              key={row.key}
              type="button"
              role="menuitem"
              onClick={row.run}
              className={`w-full px-3 py-2.5 flex items-center gap-2.5 text-xs font-semibold hover:bg-glass-w8 transition-colors cursor-pointer text-left ${TONE_CLASS[row.tone || 'default']}`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="truncate">{row.label}</span>
            </button>
          );
        })}
        {rows.length === 0 && (
          <p className="px-3 py-3 text-xs text-retro-muted">Nothing to do here.</p>
        )}
      </div>
    </div>
  );
}

export default PostContextMenu;
