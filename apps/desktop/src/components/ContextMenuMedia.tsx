"use client";

import React from 'react';
import {
  Clipboard,
  Copy,
  Download,
  ExternalLink,
  Image as ImageIcon,
  Monitor,
  Pause,
  Play,
  RefreshCw,
  Repeat,
  Sparkles,
  Trash2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { ContextMenu, type ContextAction } from './ui/ContextMenu';
import type { ContextMenuState } from './ContextOverlay';
import { copyImageToClipboard, downloadMedia, resolveMediaUrl } from '../utils/media';
import { requestGalleryAction, type GalleryActionId } from '../utils/galleryActions';

/**
 * The media menu: one data-driven list for feed, chat, cards and gallery.
 *
 * Everything here is an action with optional PARAMETERS (a file name, a target),
 * never a hand-rolled dropdown. Keepsake-only actions are requests through the
 * gallery bridge, so this file never touches gallery state.
 */

const GALLERY_ACTIONS: Array<{ id: GalleryActionId; label: string; icon: React.ReactNode; danger?: boolean }> = [
  { id: 'repost', label: 'Repost to feed', icon: <Repeat className="w-3.5 h-3.5 text-info-fg" /> },
  { id: 'story', label: 'Add to story', icon: <Sparkles className="w-3.5 h-3.5 text-warning-fg" /> },
  { id: 'card', label: 'Create card', icon: <ImageIcon className="w-3.5 h-3.5 text-chrome-lav" /> },
  { id: 'feature', label: 'Re-feature in the panel', icon: <RefreshCw className="w-3.5 h-3.5 text-success-fg" /> },
  { id: 'backdrop', label: 'Set as backdrop', icon: <Monitor className="w-3.5 h-3.5 text-info-fg" /> },
  { id: 'delete', label: 'Delete keepsake', icon: <Trash2 className="w-3.5 h-3.5" />, danger: true },
];

export interface MediaContextMenuProps {
  ctx: ContextMenuState;
  onDismiss: () => void;
  toast: (text: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
  onRepostImage?: (url: string) => void;
  onSetWallpaper?: (url: string, target: 'app' | 'os', mime?: string) => void;
}

export function MediaContextMenu({ ctx, onDismiss, toast, onRepostImage, onSetWallpaper }: MediaContextMenuProps) {
  const { src, originalUrl, isVideo, videoEl, noWallpaper, keepsakeId } = ctx.data as {
    src: string;
    originalUrl?: string;
    isVideo?: boolean;
    videoEl?: HTMLVideoElement;
    noWallpaper?: boolean;
    keepsakeId?: string;
  };
  const resolved = resolveMediaUrl(src);
  const wallpaperUrl = originalUrl || src;
  const wallpaperMime = isVideo ? 'video/mp4' : 'image/jpeg';
  const fallbackName = (src.split('/').pop() || 'media').split('?')[0];

  const actions: ContextAction[] = [];

  if (isVideo && videoEl) {
    actions.push({
      id: 'play',
      label: videoEl.paused ? 'Play' : 'Pause',
      hint: 'Space',
      icon: videoEl.paused
        ? <Play className="w-3.5 h-3.5 fill-current" />
        : <Pause className="w-3.5 h-3.5 fill-current" />,
      run: () => { if (videoEl.paused) void videoEl.play(); else videoEl.pause(); },
    });
    actions.push({
      id: 'mute',
      label: videoEl.muted ? 'Unmute' : 'Mute',
      hint: 'M',
      icon: videoEl.muted ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />,
      keepOpen: true,
      run: () => { videoEl.muted = !videoEl.muted; },
    });
  }

  actions.push({
    id: 'save',
    label: isVideo ? 'Save video as…' : 'Save image as…',
    icon: <Download className="w-3.5 h-3.5 text-retro-accent" />,
    params: [{ id: 'filename', label: 'File name', type: 'text', value: fallbackName }],
    run: async ({ filename }) => {
      toast('Downloading…', 'info');
      const ok = await downloadMedia(src, String(filename || '') || undefined);
      toast(ok ? 'Download started' : 'Download failed', ok ? 'success' : 'error');
    },
  });

  actions.push({
    id: 'copy-link',
    label: isVideo ? 'Copy video link' : 'Copy image link',
    icon: <Copy className="w-3.5 h-3.5 text-retro-muted" />,
    run: () => {
      void navigator.clipboard?.writeText(resolved);
      toast(isVideo ? 'Video link copied' : 'Image link copied', 'info');
    },
  });

  if (!isVideo) {
    actions.push({
      id: 'copy-image',
      label: 'Copy image',
      icon: <Clipboard className="w-3.5 h-3.5 text-retro-muted" />,
      run: async () => {
        toast('Copying…', 'info');
        const ok = await copyImageToClipboard(src);
        toast(ok ? 'Image copied' : 'Could not copy bytes', ok ? 'success' : 'warning');
      },
    });
  }

  actions.push({
    id: 'open',
    label: 'Open in new window',
    icon: <ExternalLink className="w-3.5 h-3.5 text-retro-muted" />,
    run: () => {
      // Keepsakes resolve local-only through the gallery: the tile src may be a
      // preview, not the durable copy.
      if (keepsakeId) {
        window.dispatchEvent(new CustomEvent('gmatch:open-keepsake', { detail: { keepsakeId } }));
        return;
      }
      window.open(resolved, '_blank', 'noopener,noreferrer');
    },
  });

  if (onRepostImage) {
    actions.push({
      id: 'repost-inline',
      label: 'Repost to feed',
      separatorBefore: true,
      icon: <Repeat className="w-3.5 h-3.5 text-retro-accent" />,
      run: () => onRepostImage(resolved),
    });
  }

  if (onSetWallpaper && !noWallpaper) {
    actions.push({
      id: 'background',
      label: 'Set as background',
      separatorBefore: true,
      icon: <Monitor className="w-3.5 h-3.5 text-retro-muted" />,
      params: [{
        id: 'target',
        label: 'Apply to',
        type: 'select',
        value: 'app',
        options: [
          { value: 'app', label: 'This app' },
          { value: 'os', label: 'Whole desktop' },
        ],
      }],
      run: ({ target }) => onSetWallpaper(wallpaperUrl, target === 'os' ? 'os' : 'app', wallpaperMime),
    });
  }

  if (keepsakeId) {
    // A keepsake's background comes from the gallery's own resolved bytes, not
    // the tile src (which may be a remote preview).
    GALLERY_ACTIONS.forEach((g, i) => {
      if (g.id === 'backdrop') {
        actions.push({
          id: g.id,
          label: g.label,
          icon: g.icon,
          separatorBefore: i === 0,
          params: [{
            id: 'target',
            label: 'Apply to',
            type: 'select',
            value: 'app',
            options: [
              { value: 'app', label: 'This app' },
              { value: 'os', label: 'Whole desktop' },
            ],
          }],
          run: ({ target }) => requestGalleryAction({ action: 'backdrop', keepsakeId, target: target === 'os' ? 'os' : 'app' }),
        });
        return;
      }
      actions.push({
        id: g.id,
        label: g.label,
        icon: g.icon,
        danger: g.danger,
        separatorBefore: i === 0,
        run: () => requestGalleryAction({ action: g.id, keepsakeId }),
      });
    });
  }

  return (
    <ContextMenu
      x={ctx.x}
      y={ctx.y}
      title={isVideo ? 'Video' : 'Image'}
      subtitle={src ? src.split('/').pop()?.split('?')[0] : ''}
      actions={actions}
      onDismiss={onDismiss}
    />
  );
}

export default MediaContextMenu;