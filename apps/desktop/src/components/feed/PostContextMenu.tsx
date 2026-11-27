"use client";

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
import { ContextMenu, type ContextMenuItem } from '../ui/ContextMenu';
import type { FeedPost } from './GMatchFeed';

/**
 * The post context menu — right-click on a post.
 *
 * This is a thin ADAPTER over the one shared menu primitive. It still replaces
 * the three-dots button, opens at the cursor and carries every action a post
 * has. Two rules carried over unchanged:
 *  - every row is gated on its handler: a surface that cannot do something
 *    must not show it;
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
  zIndexClass,
}: PostContextMenuProps) {
  const isOwner = !!identityOrbitId && post.author_id === identityOrbitId;

  const items: ContextMenuItem[] = [];
  const add = (
    label: string,
    Icon: typeof Heart,
    onSelect: () => void,
    tone?: 'default' | 'success' | 'danger',
  ) => {
    items.push({
      label,
      icon: <Icon className="w-3.5 h-3.5" />,
      danger: tone === 'danger',
      onSelect,
    });
  };

  if (onToggleLike) add(isLiked ? 'Unlike' : 'Like', Heart, () => onToggleLike(post));
  if (onToggleSave) add(isSaved ? 'Remove from Saved' : 'Save', Bookmark, () => onToggleSave(post));
  if (onSaveToVault) add('Save to Vault', Share2, () => onSaveToVault(post));
  if (onRepost) add('Repost to Profile', Repeat, () => onRepost(post));
  if (onShare) add('Share To Direct / Groups', Send, () => onShare(post));
  if (onCopyLink) add('Copy Link', Link2, () => onCopyLink(post));
  if (isOwner && onEdit) add('Edit post', Pencil, () => onEdit(post));
  if (isOwner && onArchive) add('Archive Post', Archive, () => onArchive(post.id));
  if (isOwner && onDelete) add('Delete Post', Trash2, () => onDelete(post.id), 'danger');
  if (!isOwner && onReport) add('Report Post', Flag, () => onReport(post), 'danger');

  return (
    <ContextMenu
      x={x}
      y={y}
      title="Post options"
      subtitle={post.caption ? String(post.caption).slice(0, 48) : undefined}
      items={items}
      onDismiss={onClose}
      zIndexClass={zIndexClass}
    />
  );
}

export default PostContextMenu;
