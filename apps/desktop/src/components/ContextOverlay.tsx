"use client";

import type { OrbitIdentity } from '@orbit/crypto';
import type { User, OrbitObject } from '@orbit/shared';
import {
  ArrowUp,
  CheckSquare,
  Clipboard,
  Copy,
  ExternalLink,
  RefreshCw,
  Scissors,
  Search,
  Star,
  Trash2,
} from 'lucide-react';
import { ContextMenu, type ContextAction } from './ui/ContextMenu';
import { MediaContextMenu } from './ContextMenuMedia';
import { isMediaVideo } from '../utils/media';

export type ContextMenuType = 'user' | 'item' | 'media' | 'input' | 'selection' | 'link' | 'general';

export interface ContextMenuState {
  x: number;
  y: number;
  type: ContextMenuType;
  data: any;
}

export interface ContextOverlayProps {
  contextMenu: ContextMenuState | null;
  onDismiss: () => void;
  identity: OrbitIdentity | null;
  friendsIds: string[];
  toast: (text: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
  onViewProfile?: (user: User) => void;
  onToggleContact?: (id: string) => void;
  onSendCard?: (userId: string) => void;
  onCopyId?: (id: string) => void;
  onSendPm?: (user: User) => void;
  onBlockUser?: (id: string) => void;
  onOpenLightbox?: (id: string) => void;
  onDownloadItem?: (item: OrbitObject) => void;
  onCopyImageLink?: (id: string) => void;
  onToggleFavorite?: (item: OrbitObject) => Promise<boolean>;
  onDeleteItem?: (item: OrbitObject) => void;
  onRepostItem?: (item: OrbitObject) => void;
  onAddToStory?: (item: OrbitObject) => void;
  onRemoveFromInbox?: (item: OrbitObject) => void;
  onReportUser?: (id: string, name: string, objectId?: string) => void;
  onReportItem?: (ownerId: string, ownerName: string, objectId: string) => void;
  onRepostImage?: (url: string) => void;
  onSetWallpaper?: (url: string, target: 'app' | 'os', mime?: string) => void;
  onSearchText?: (text: string) => void;
}

const icon = (Icon: typeof Star) => <Icon className="w-3.5 h-3.5" />;

/**
 * The single right-click overlay. Media delegates to the data-driven media
 * menu; every other kind is now BUILT as the same `ContextAction[]` data and
 * rendered by the one shared primitive. No surface hand-rolls rows any more.
 */
export function ContextOverlay(props: ContextOverlayProps) {
  const {
    contextMenu, onDismiss, identity, friendsIds, toast,
    onViewProfile, onToggleContact, onSendCard, onCopyId, onSendPm,
    onBlockUser, onOpenLightbox, onDownloadItem, onCopyImageLink,
    onToggleFavorite, onDeleteItem, onRepostItem, onAddToStory,
    onRemoveFromInbox, onReportUser, onReportItem, onRepostImage,
    onSetWallpaper, onSearchText,
  } = props;

  if (!contextMenu) return null;

  // Media is the one menu every surface needs (feed, chat, cards, gallery),
  // and the one that takes parameters. It is DATA: see MediaContextMenu.
  if (contextMenu.type === 'media') {
    return (
      <MediaContextMenu
        ctx={contextMenu}
        onDismiss={onDismiss}
        toast={toast}
        onRepostImage={onRepostImage}
        onSetWallpaper={onSetWallpaper}
      />
    );
  }

  const actions: ContextAction[] = [];
  let title: string | undefined;

  if (contextMenu.type === 'input') {
    const { element, hasSelection } = contextMenu.data as {
      element?: HTMLInputElement | HTMLTextAreaElement | HTMLElement | null
      hasSelection?: boolean
    };
    title = 'Edit';
    actions.push(
      {
        label: 'Cut', icon: icon(Scissors), hint: 'Ctrl+X', disabled: !hasSelection,
        onSelect: () => {
          if (element) { element.focus(); document.execCommand('cut'); toast('Cut to clipboard', 'info'); }
        },
      },
      {
        label: 'Copy', icon: icon(Copy), hint: 'Ctrl+C', disabled: !hasSelection,
        onSelect: () => {
          if (element) { element.focus(); document.execCommand('copy'); toast('Copied to clipboard', 'info'); }
        },
      },
      {
        label: 'Paste', icon: icon(Clipboard), hint: 'Ctrl+V',
        onSelect: async () => {
          try {
            const text = await navigator.clipboard.readText();
            if (element && text) {
              element.focus();
              // insertText goes through the native editing path, which React's
              // value tracker observes (manual splicing + synthetic input is
              // deduped and ignored) — keep the manual fallback for engines
              // that refuse execCommand.
              const ok = document.execCommand('insertText', false, text);
              if (!ok) {
                const input = element as HTMLInputElement | HTMLTextAreaElement;
                const start = input.selectionStart ?? 0;
                const end = input.selectionEnd ?? 0;
                const val = input.value ?? '';
                input.value = val.slice(0, start) + text + val.slice(end);
                input.selectionStart = input.selectionEnd = start + text.length;
                input.dispatchEvent(new Event('input', { bubbles: true }));
              }
              toast('Pasted', 'info');
            }
          } catch {
            toast('Could not read the clipboard', 'warning');
          }
        },
      },
      {
        label: 'Select All', icon: icon(CheckSquare), hint: 'Ctrl+A', separatorBefore: true,
        onSelect: () => { if (element) { element.focus(); (element as HTMLInputElement).select?.(); } },
      },
    );
    if (element && (element as HTMLInputElement).value) {
      actions.push({
        label: 'Clear', icon: icon(Trash2), danger: true,
        onSelect: () => {
          (element as HTMLInputElement).value = '';
          element.dispatchEvent(new Event('input', { bubbles: true }));
        },
      });
    }
  } else if (contextMenu.type === 'selection') {
    const { text } = contextMenu.data as { text: string };
    title = `“${text.slice(0, 18)}”`;
    actions.push({
      label: 'Copy', icon: icon(Copy), hint: 'Ctrl+C',
      onSelect: () => { void navigator.clipboard.writeText(text); toast('Copied to clipboard', 'info'); },
    });
    if (onSearchText) {
      actions.push({ label: 'Search on gMatch', icon: icon(Search), onSelect: () => onSearchText(text) });
    }
    actions.push({
      label: 'Select All', icon: icon(CheckSquare), hint: 'Ctrl+A',
      onSelect: () => window.getSelection()?.selectAllChildren(document.body),
    });
  } else if (contextMenu.type === 'link') {
    const { href } = contextMenu.data as { href: string };
    title = 'Link';
    actions.push(
      {
        label: 'Open Link', icon: icon(ExternalLink),
        onSelect: () => { window.open(href, '_blank', 'noopener,noreferrer'); },
      },
      {
        label: 'Copy Link Address', icon: icon(Copy),
        onSelect: () => { void navigator.clipboard.writeText(href); toast('Link copied to clipboard', 'info'); },
      },
    );
  } else if (contextMenu.type === 'general') {
    title = 'gMatch';
    actions.push(
      {
        label: 'Reload', icon: icon(RefreshCw), hint: 'Ctrl+R',
        onSelect: () => {
          const g = (window as unknown as { gmatch?: { winReload?: () => void } }).gmatch;
          if (g?.winReload) g.winReload();
          else window.location.reload();
        },
      },
      {
        label: 'Copy Page URL', icon: icon(Copy),
        onSelect: () => { void navigator.clipboard.writeText(window.location.href); toast('Page URL copied', 'info'); },
      },
      {
        label: 'Scroll to Top', icon: icon(ArrowUp),
        onSelect: () => window.scrollTo({ top: 0, behavior: 'smooth' }),
      },
    );
  } else if (contextMenu.type === 'user') {
    const user = contextMenu.data as User;
    title = `User: ${user.display_name || 'Peer'}`;
    if (onViewProfile) actions.push({ label: 'View Full Profile', onSelect: () => onViewProfile(user) });
    if (onToggleContact) {
      actions.push({
        label: friendsIds.includes(user.id) ? 'Remove Contact' : 'Add Contact',
        icon: icon(Star),
        onSelect: () => onToggleContact(user.id),
      });
    }
    if (onSendCard) actions.push({ label: 'Send Image', onSelect: () => onSendCard(user.id) });
    if (onCopyId) actions.push({ label: 'Copy GMatch ID', onSelect: () => onCopyId(user.id) });
    if (onSendPm) actions.push({ label: 'Send PM', onSelect: () => onSendPm(user) });
    if (onBlockUser) actions.push({ label: 'Block User', danger: true, onSelect: () => onBlockUser(user.id) });
    if (onReportUser) {
      actions.push({
        label: 'Report User', danger: true, separatorBefore: true,
        onSelect: () => onReportUser(user.id, user.display_name?.trim() || 'Unknown User'),
      });
    }
  } else if (contextMenu.type === 'item') {
    const item = contextMenu.data as OrbitObject & { owner_name?: string };
    title = 'Keepsake';
    const owner = item.owner_id === identity?.orbitId;
    if (onOpenLightbox) actions.push({ label: 'Open Lightbox', onSelect: () => onOpenLightbox(item.id) });
    if (onDownloadItem) actions.push({ label: 'Download Image', onSelect: () => onDownloadItem(item) });
    if (onCopyImageLink) actions.push({ label: 'Copy Image Link', onSelect: () => onCopyImageLink(item.id) });
    if (onSetWallpaper && (item.content_url || item.id)) {
      const itemUrl = item.content_url || `/api/objects/${item.id}`;
      const itemMime = item.mime_type || (isMediaVideo(itemUrl) ? 'video/mp4' : 'image/jpeg');
      actions.push(
        { label: 'Set as app background', onSelect: () => onSetWallpaper(itemUrl, 'app', itemMime) },
        { label: 'Set as OS wallpaper', onSelect: () => onSetWallpaper(itemUrl, 'os', itemMime) },
      );
    }
    if (onToggleFavorite) {
      actions.push({
        label: 'Star / Favorite',
        onSelect: async () => { if (await onToggleFavorite(item)) toast('Updated starred status', 'success'); },
      });
    }
    if (owner && onRepostItem) actions.push({ label: 'Repost to Feed', onSelect: () => onRepostItem(item) });
    if (owner && onAddToStory) actions.push({ label: 'Add to Story', onSelect: () => onAddToStory(item) });
    if (owner && onDeleteItem) {
      actions.push({ label: 'Delete Image', danger: true, separatorBefore: true, onSelect: () => onDeleteItem(item) });
    } else if (!owner && onRemoveFromInbox) {
      actions.push({ label: 'Remove from Inbox', danger: true, separatorBefore: true, onSelect: () => onRemoveFromInbox(item) });
    }
    if (onReportItem) {
      actions.push({
        label: 'Report Image', danger: true, separatorBefore: true,
        onSelect: () => {
          if (item.owner_id) onReportItem(item.owner_id, item.owner_name?.trim() || 'Unknown User', item.id);
        },
      });
    }
  }

  return (
    <ContextMenu
      x={contextMenu.x}
      y={contextMenu.y}
      title={title}
      items={actions}
      onDismiss={onDismiss}
    />
  );
}

export interface ReportModalProps {
  reportModal: { id: string; name: string; objectId?: string } | null;
  onClose: () => void;
  onSubmit: (id: string, opts?: { objectId?: string }) => void;
  reportReason: string;
  setReportReason: (v: string) => void;
  reportCategory: 'spam' | 'harassment' | 'inappropriate' | 'abuse';
  setReportCategory: (v: 'spam' | 'harassment' | 'inappropriate' | 'abuse') => void;
}

export function ReportModal({
  reportModal,
  onClose,
  onSubmit,
  reportReason,
  setReportReason,
  reportCategory,
  setReportCategory,
}: ReportModalProps) {
  if (!reportModal) return null;

  return (
    <div className="fixed inset-0 z-[var(--z-modal)] bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-retro-panel border border-retro-error max-w-sm w-full p-5 space-y-3"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-sm font-bold text-retro-error tracking-wider">
          Report User: {reportModal.name}
        </h3>
        {reportModal.objectId && (
          <p className="text-2xs text-retro-muted font-sans truncate" title={reportModal.objectId}>
            Attached evidence: {reportModal.objectId}
          </p>
        )}
        <div className="flex flex-wrap gap-1.5 text-2xs">
          {(['inappropriate', 'harassment', 'spam', 'abuse'] as const).map(cat => (
            <button
              key={cat}
              type="button"
              onClick={() => setReportCategory(cat)}
              className={`px-3 py-1 border font-bold uppercase tracking-wider transition-colors ${
                reportCategory === cat
                  ? 'bg-retro-accent text-retro-accent-text border-retro-accent'
                  : 'bg-retro-bg text-retro-muted border-edge hover:text-retro-fg'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
        <textarea
          rows={3}
          value={reportReason}
          onChange={e => setReportReason(e.target.value)}
          placeholder="Describe the issue (optional)..."
          className="w-full p-2.5 bg-retro-bg border border-edge text-xs text-retro-fg placeholder:text-retro-muted focus:outline-none"
          maxLength={200}
        />
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => onSubmit(reportModal.id, { objectId: reportModal.objectId })}
            className="flex-1 bg-retro-error hover:bg-retro-red text-retro-fg font-bold py-2 text-xs transition-colors"
          >
            Submit Report & Block
          </button>
          <button
            onClick={onClose}
            className="px-3 py-2 text-xs text-retro-muted hover:text-retro-fg transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
