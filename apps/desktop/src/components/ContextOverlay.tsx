"use client";

import React, { useEffect } from 'react';
import type { OrbitIdentity } from '@orbit/crypto';
import type { User, OrbitObject } from '@orbit/shared';
import {
  Star,
  Copy,
  ExternalLink,
  Scissors,
  Clipboard,
  CheckSquare,
  RefreshCw,
  ArrowUp,
  Download,
  Trash2,
  Search,
  Image as ImageIcon,
  Video as VideoIcon,
  Monitor,
  Repeat,
  Play,
  Pause,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { downloadMedia, copyImageToClipboard, isMediaVideo, resolveMediaUrl } from '../utils/media';

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

export function ContextOverlay({
  contextMenu,
  onDismiss,
  identity,
  friendsIds,
  toast,
  onViewProfile,
  onToggleContact,
  onSendCard,
  onCopyId,
  onSendPm,
  onBlockUser,
  onOpenLightbox,
  onDownloadItem,
  onCopyImageLink,
  onToggleFavorite,
  onDeleteItem,
  onRepostItem,
  onAddToStory,
  onRemoveFromInbox,
  onReportUser,
  onReportItem,
  onRepostImage,
  onSetWallpaper,
  onSearchText,
}: ContextOverlayProps) {
  useEffect(() => {
    if (!contextMenu) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    const handleScroll = () => onDismiss();

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [contextMenu, onDismiss]);

  if (!contextMenu) return null;

  const menuWidth = 220;
  const menuHeight = contextMenu.type === 'item' ? 320 : contextMenu.type === 'user' ? 280 : 220;
  const left = typeof window !== 'undefined'
    ? Math.max(8, Math.min(contextMenu.x, window.innerWidth - menuWidth - 12))
    : contextMenu.x;
  const top = typeof window !== 'undefined'
    ? Math.max(8, Math.min(contextMenu.y, window.innerHeight - menuHeight - 12))
    : contextMenu.y;

  return (
    <div
      className="fixed inset-0 z-[var(--z-system)] bg-black/10 select-none"
      onClick={onDismiss}
      onContextMenu={(e) => {
        e.preventDefault();
        onDismiss();
      }}
    >
      <div
        // A context menu should be a menu: without this it is an anonymous
        // div, so assistive tech announces nothing and no test can target it.
        role="menu"
        aria-label="Context menu"
        data-testid="context-menu"
        className="fixed bg-retro-panel/95 backdrop-blur-md border border-border-glass rounded-xl shadow-2xl p-1.5 w-56 text-xs z-[var(--z-system)] space-y-0.5 animate-orbit-fade-in text-retro-fg"
        style={{ top, left }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ─── MEDIA CONTEXT MENU (Images, Videos) ─── */}
        {contextMenu.type === 'media' && (() => {
          const { src, originalUrl, isVideo, videoEl, noWallpaper, keepsakeId } = contextMenu.data;
          const resolved = resolveMediaUrl(src);
          const wallpaperUrl = originalUrl || src;
          const wallpaperMime = isVideo ? 'video/mp4' : 'image/jpeg';

          return (
            <>
              <div className="px-2.5 py-1 flex items-center justify-between text-[10px] font-semibold text-retro-muted uppercase tracking-wider border-b border-border-glass/40 mb-1">
                <span className="flex items-center gap-1">
                  {isVideo ? <VideoIcon className="w-3 h-3 text-retro-accent" /> : <ImageIcon className="w-3 h-3 text-retro-accent" />}
                  {isVideo ? 'Video' : 'Image'}
                </span>
                <span className="font-mono text-[10px] truncate max-w-[100px]" title={src}>
                  {src ? src.split('/').pop()?.split('?')[0] : ''}
                </span>
              </div>

              {/* Video Specific Controls */}
              {isVideo && videoEl && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      if (videoEl.paused) videoEl.play();
                      else videoEl.pause();
                      onDismiss();
                    }}
                    className="w-full text-left px-2.5 py-1.5 hover:bg-glass-w12 rounded-lg flex items-center justify-between transition-colors font-medium cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      {videoEl.paused ? <Play className="w-3.5 h-3.5 fill-current text-retro-accent" /> : <Pause className="w-3.5 h-3.5 fill-current text-retro-accent" />}
                      <span>{videoEl.paused ? 'Play Video' : 'Pause Video'}</span>
                    </div>
                    <span className="text-[10px] text-retro-muted font-mono">Space</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      videoEl.muted = !videoEl.muted;
                      onDismiss();
                    }}
                    className="w-full text-left px-2.5 py-1.5 hover:bg-glass-w12 rounded-lg flex items-center justify-between transition-colors font-medium cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      {videoEl.muted ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5 text-retro-muted" />}
                      <span>{videoEl.muted ? 'Unmute Audio' : 'Mute Audio'}</span>
                    </div>
                    <span className="text-[10px] text-retro-muted font-mono">M</span>
                  </button>

                  <div className="my-1 border-t border-border-glass/50" />
                </>
              )}

              {/* Save Media As */}
              <button
                type="button"
                onClick={async () => {
                  toast('Downloading media...', 'info');
                  const ok = await downloadMedia(src);
                  if (ok) toast('Media download started', 'success');
                  else toast('Download failed', 'error');
                  onDismiss();
                }}
                className="w-full text-left px-2.5 py-1.5 hover:bg-glass-w12 rounded-lg flex items-center justify-between transition-colors font-medium cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <Download className="w-3.5 h-3.5 text-retro-accent" />
                  <span>{isVideo ? 'Save Video As...' : 'Save Image As...'}</span>
                </div>
              </button>

              {/* Copy Image / Video Link */}
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(resolved);
                  toast(isVideo ? 'Video link copied' : 'Image link copied', 'info');
                  onDismiss();
                }}
                className="w-full text-left px-2.5 py-1.5 hover:bg-glass-w12 rounded-lg flex items-center justify-between transition-colors font-medium cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <Copy className="w-3.5 h-3.5 text-retro-muted" />
                  <span>{isVideo ? 'Copy Video Link' : 'Copy Image Link'}</span>
                </div>
              </button>

              {/* Copy Image to Clipboard (PNG) */}
              {!isVideo && (
                <button
                  type="button"
                  onClick={async () => {
                    toast('Copying image to clipboard...', 'info');
                    const ok = await copyImageToClipboard(src);
                    if (ok) toast('Image copied to clipboard', 'success');
                    else toast('Could not copy image bytes (link copied)', 'warning');
                    onDismiss();
                  }}
                  className="w-full text-left px-2.5 py-1.5 hover:bg-glass-w12 rounded-lg flex items-center justify-between transition-colors font-medium cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <Clipboard className="w-3.5 h-3.5 text-retro-muted" />
                    <span>Copy Image</span>
                  </div>
                </button>
              )}

              {/* Open in New Tab */}
              <button
                type="button"
                onClick={() => {
                  // Keepsakes resolve local-only through the gallery (never the
                  // raw tile src, which may be an unresolved remote preview).
                  if (keepsakeId) {
                    window.dispatchEvent(
                      new CustomEvent('gmatch:open-keepsake', { detail: { keepsakeId } }),
                    );
                    onDismiss();
                    return;
                  }
                  window.open(resolved, '_blank', 'noopener,noreferrer');
                  onDismiss();
                }}
                className="w-full text-left px-2.5 py-1.5 hover:bg-glass-w12 rounded-lg flex items-center justify-between transition-colors font-medium cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <ExternalLink className="w-3.5 h-3.5 text-retro-muted" />
                  <span>Open in New Window</span>
                </div>
              </button>

              {/* Repost to Feed CTA */}
              {onRepostImage && (
                <>
                  <div className="my-1 border-t border-border-glass/50" />
                  <button
                    type="button"
                    onClick={() => {
                      onRepostImage(resolved);
                      onDismiss();
                    }}
                    className="w-full text-left px-2.5 py-1.5 hover:bg-glass-w12 rounded-lg flex items-center justify-between transition-colors font-medium cursor-pointer text-retro-accent"
                  >
                    <div className="flex items-center gap-2">
                      <Repeat className="w-3.5 h-3.5 text-retro-accent" />
                      <span>Repost to Feed</span>
                    </div>
                  </button>
                </>
              )}

              {/* Wallpaper (content images only — avatars/icons opt out) */}
              {onSetWallpaper && !noWallpaper && (
                <>
                  <div className="my-1 border-t border-border-glass/50" />
                  <button
                    type="button"
                    onClick={() => {
                      onSetWallpaper(wallpaperUrl, 'app', wallpaperMime);
                      onDismiss();
                    }}
                    className="w-full text-left px-2.5 py-1.5 hover:bg-glass-w12 rounded-lg flex items-center justify-between transition-colors font-medium cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <ImageIcon className="w-3.5 h-3.5 text-retro-muted" />
                      <span>Set as app background</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onSetWallpaper(wallpaperUrl, 'os', wallpaperMime);
                      onDismiss();
                    }}
                    className="w-full text-left px-2.5 py-1.5 hover:bg-glass-w12 rounded-lg flex items-center justify-between transition-colors font-medium cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <Monitor className="w-3.5 h-3.5 text-retro-muted" />
                      <span>Set as OS wallpaper</span>
                    </div>
                  </button>
                </>
              )}
            </>
          );
        })()}

        {/* ─── INPUT / TEXTAREA CONTEXT MENU ─── */}
        {contextMenu.type === 'input' && (() => {
          const { element, hasSelection } = contextMenu.data;

          return (
            <>
              <div className="px-2.5 py-1 text-[10px] font-semibold text-retro-muted uppercase tracking-wider border-b border-border-glass/40 mb-1">
                Edit
              </div>

              {/* Cut */}
              <button
                type="button"
                disabled={!hasSelection}
                onClick={() => {
                  if (element) {
                    element.focus();
                    document.execCommand('cut');
                    toast('Cut to clipboard', 'info');
                  }
                  onDismiss();
                }}
                className={`w-full text-left px-2.5 py-1.5 hover:bg-glass-w12 rounded-lg flex items-center justify-between transition-colors font-medium cursor-pointer ${
                  !hasSelection ? 'opacity-40 pointer-events-none' : ''
                }`}
              >
                <div className="flex items-center gap-2">
                  <Scissors className="w-3.5 h-3.5" />
                  <span>Cut</span>
                </div>
                <span className="text-[10px] text-retro-muted font-mono">Ctrl+X</span>
              </button>

              {/* Copy */}
              <button
                type="button"
                disabled={!hasSelection}
                onClick={() => {
                  if (element) {
                    element.focus();
                    document.execCommand('copy');
                    toast('Copied to clipboard', 'info');
                  }
                  onDismiss();
                }}
                className={`w-full text-left px-2.5 py-1.5 hover:bg-glass-w12 rounded-lg flex items-center justify-between transition-colors font-medium cursor-pointer ${
                  !hasSelection ? 'opacity-40 pointer-events-none' : ''
                }`}
              >
                <div className="flex items-center gap-2">
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy</span>
                </div>
                <span className="text-[10px] text-retro-muted font-mono">Ctrl+C</span>
              </button>

              {/* Paste */}
              <button
                type="button"
                onClick={async () => {
                  try {
                    const text = await navigator.clipboard.readText();
                    if (element && text) {
                      element.focus();
                      // insertText goes through the native editing path, which
                      // React's value tracker observes (manual value splicing
                      // + synthetic 'input' gets deduped and ignored).
                      const ok = document.execCommand('insertText', false, text);
                      if (!ok) {
                        const start = element.selectionStart || 0;
                        const end = element.selectionEnd || 0;
                        const val = element.value || '';
                        element.value = val.slice(0, start) + text + val.slice(end);
                        element.selectionStart = element.selectionEnd = start + text.length;
                        element.dispatchEvent(new Event('input', { bubbles: true }));
                      }
                      toast('Pasted', 'info');
                    }
                  } catch {
                    toast('Could not read the clipboard', 'warning');
                  }
                  onDismiss();
                }}
                className="w-full text-left px-2.5 py-1.5 hover:bg-glass-w12 rounded-lg flex items-center justify-between transition-colors font-medium cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <Clipboard className="w-3.5 h-3.5" />
                  <span>Paste</span>
                </div>
                <span className="text-[10px] text-retro-muted font-mono">Ctrl+V</span>
              </button>

              <div className="my-1 border-t border-border-glass/50" />

              {/* Select All */}
              <button
                type="button"
                onClick={() => {
                  if (element) {
                    element.focus();
                    element.select();
                  }
                  onDismiss();
                }}
                className="w-full text-left px-2.5 py-1.5 hover:bg-glass-w12 rounded-lg flex items-center justify-between transition-colors font-medium cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <CheckSquare className="w-3.5 h-3.5 text-retro-muted" />
                  <span>Select All</span>
                </div>
                <span className="text-[10px] text-retro-muted font-mono">Ctrl+A</span>
              </button>

              {/* Clear */}
              {element && element.value && (
                <button
                  type="button"
                  onClick={() => {
                    element.value = '';
                    element.dispatchEvent(new Event('input', { bubbles: true }));
                    onDismiss();
                  }}
                  className="w-full text-left px-2.5 py-1.5 hover:bg-glass-w12 rounded-lg flex items-center justify-between transition-colors font-medium cursor-pointer text-retro-error"
                >
                  <div className="flex items-center gap-2">
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Clear</span>
                  </div>
                </button>
              )}
            </>
          );
        })()}

        {/* ─── TEXT SELECTION CONTEXT MENU ─── */}
        {contextMenu.type === 'selection' && (() => {
          const { text } = contextMenu.data;

          return (
            <>
              <div className="px-2.5 py-1 text-[10px] font-semibold text-retro-muted uppercase tracking-wider border-b border-border-glass/40 mb-1 truncate">
                &ldquo;{text.slice(0, 18)}&rdquo;
              </div>

              {/* Copy */}
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(text);
                  toast('Copied to clipboard', 'info');
                  onDismiss();
                }}
                className="w-full text-left px-2.5 py-1.5 hover:bg-glass-w12 rounded-lg flex items-center justify-between transition-colors font-medium cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <Copy className="w-3.5 h-3.5 text-retro-accent" />
                  <span>Copy</span>
                </div>
                <span className="text-[10px] text-retro-muted font-mono">Ctrl+C</span>
              </button>

              {/* Search on gMatch */}
              {onSearchText && (
                <button
                  type="button"
                  onClick={() => {
                    onSearchText(text);
                    onDismiss();
                  }}
                  className="w-full text-left px-2.5 py-1.5 hover:bg-glass-w12 rounded-lg flex items-center justify-between transition-colors font-medium cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <Search className="w-3.5 h-3.5 text-retro-muted" />
                    <span>Search on gMatch</span>
                  </div>
                </button>
              )}

              {/* Select All */}
              <button
                type="button"
                onClick={() => {
                  window.getSelection()?.selectAllChildren(document.body);
                  onDismiss();
                }}
                className="w-full text-left px-2.5 py-1.5 hover:bg-glass-w12 rounded-lg flex items-center justify-between transition-colors font-medium cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <CheckSquare className="w-3.5 h-3.5 text-retro-muted" />
                  <span>Select All</span>
                </div>
                <span className="text-[10px] text-retro-muted font-mono">Ctrl+A</span>
              </button>
            </>
          );
        })()}

        {/* ─── LINK CONTEXT MENU ─── */}
        {contextMenu.type === 'link' && (() => {
          const { href } = contextMenu.data;

          return (
            <>
              <div className="px-2.5 py-1 text-[10px] font-semibold text-retro-muted uppercase tracking-wider border-b border-border-glass/40 mb-1 truncate">
                Link
              </div>

              <button
                type="button"
                onClick={() => {
                  window.open(href, '_blank', 'noopener,noreferrer');
                  onDismiss();
                }}
                className="w-full text-left px-2.5 py-1.5 hover:bg-glass-w12 rounded-lg flex items-center justify-between transition-colors font-medium cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <ExternalLink className="w-3.5 h-3.5 text-retro-accent" />
                  <span>Open Link</span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(href);
                  toast('Link copied to clipboard', 'info');
                  onDismiss();
                }}
                className="w-full text-left px-2.5 py-1.5 hover:bg-glass-w12 rounded-lg flex items-center justify-between transition-colors font-medium cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <Copy className="w-3.5 h-3.5 text-retro-muted" />
                  <span>Copy Link Address</span>
                </div>
              </button>
            </>
          );
        })()}

        {/* ─── GENERAL / BACKGROUND CONTEXT MENU ─── */}
        {contextMenu.type === 'general' && (
          <>
            <div className="px-2.5 py-1 text-[10px] font-semibold text-retro-muted uppercase tracking-wider border-b border-border-glass/40 mb-1">
              gMatch
            </div>

            <button
              type="button"
              onClick={() => {
                const g = (window as unknown as { gmatch?: { winReload?: () => void } }).gmatch
                if (g?.winReload) g.winReload()
                else window.location.reload()
                onDismiss();
              }}
              className="w-full text-left px-2.5 py-1.5 hover:bg-glass-w12 rounded-lg flex items-center justify-between transition-colors font-medium cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <RefreshCw className="w-3.5 h-3.5 text-retro-accent" />
                <span>Reload</span>
              </div>
              <span className="text-[10px] text-retro-muted font-mono">Ctrl+R</span>
            </button>

            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(window.location.href);
                toast('Page URL copied', 'info');
                onDismiss();
              }}
              className="w-full text-left px-2.5 py-1.5 hover:bg-glass-w12 rounded-lg flex items-center justify-between transition-colors font-medium cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <Copy className="w-3.5 h-3.5 text-retro-muted" />
                <span>Copy Page URL</span>
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                window.scrollTo({ top: 0, behavior: 'smooth' });
                onDismiss();
              }}
              className="w-full text-left px-2.5 py-1.5 hover:bg-glass-w12 rounded-lg flex items-center justify-between transition-colors font-medium cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <ArrowUp className="w-3.5 h-3.5 text-retro-muted" />
                <span>Scroll to Top</span>
              </div>
            </button>
          </>
        )}

        {/* ─── USER CONTEXT MENU ─── */}
        {contextMenu.type === 'user' && (
          <>
            <div className="px-2.5 py-1 text-[10px] font-semibold text-retro-muted uppercase tracking-wider border-b border-border-glass/40 mb-1">
              User: {contextMenu.data.display_name || 'Peer'}
            </div>

            {onViewProfile && (
              <button
                type="button"
                onClick={() => {
                  onViewProfile(contextMenu.data);
                  onDismiss();
                }}
                className="w-full text-left px-2.5 py-1.5 hover:bg-glass-w12 rounded-lg transition-colors font-bold cursor-pointer"
              >
                View Full Profile
              </button>
            )}

            {onToggleContact && (
              <button
                type="button"
                onClick={() => {
                  onToggleContact(contextMenu.data.id);
                  onDismiss();
                }}
                className="w-full text-left px-2.5 py-1.5 hover:bg-glass-w12 rounded-lg flex items-center justify-between transition-colors font-bold cursor-pointer"
              >
                <span>{friendsIds.includes(contextMenu.data.id) ? 'Remove Contact' : 'Add Contact'}</span>
                <Star className="w-3 h-3 fill-current text-retro-accent" />
              </button>
            )}

            {onSendCard && (
              <button
                type="button"
                onClick={() => {
                  onSendCard(contextMenu.data.id);
                  onDismiss();
                }}
                className="w-full text-left px-2.5 py-1.5 hover:bg-glass-w12 rounded-lg text-retro-accent font-bold transition-colors cursor-pointer"
              >
                Send Image
              </button>
            )}

            {onCopyId && (
              <button
                type="button"
                onClick={() => {
                  onCopyId(contextMenu.data.id);
                  onDismiss();
                }}
                className="w-full text-left px-2.5 py-1.5 hover:bg-glass-w12 rounded-lg text-retro-muted transition-colors cursor-pointer"
              >
                Copy GMatch ID
              </button>
            )}

            {onSendPm && (
              <button
                type="button"
                onClick={() => {
                  onSendPm(contextMenu.data);
                  onDismiss();
                }}
                className="w-full text-left px-2.5 py-1.5 hover:bg-glass-w12 rounded-lg text-purple-300 font-bold transition-colors cursor-pointer"
              >
                Send PM
              </button>
            )}

            {onBlockUser && (
              <button
                type="button"
                onClick={() => {
                  onBlockUser(contextMenu.data.id);
                  onDismiss();
                }}
                className="w-full text-left px-2.5 py-1.5 hover:bg-glass-w12 rounded-lg text-retro-warning transition-colors cursor-pointer"
              >
                Block User
              </button>
            )}

            {onReportUser && (
              <button
                type="button"
                onClick={() => {
                  onReportUser(contextMenu.data.id, contextMenu.data.display_name?.trim() || 'Unknown User');
                  onDismiss();
                }}
                className="w-full text-left px-2.5 py-1.5 hover:bg-glass-w12 rounded-lg text-retro-error font-bold transition-colors cursor-pointer"
              >
                Report User
              </button>
            )}
          </>
        )}

        {/* ─── ITEM CONTEXT MENU ─── */}
        {contextMenu.type === 'item' && (
          <>
            <div className="px-2.5 py-1 text-[10px] font-semibold text-retro-muted uppercase tracking-wider border-b border-border-glass/40 mb-1">
              Keepsake
            </div>

            {onOpenLightbox && (
              <button
                type="button"
                onClick={() => {
                  onOpenLightbox(contextMenu.data.id);
                  onDismiss();
                }}
                className="w-full text-left px-2.5 py-1.5 hover:bg-glass-w12 rounded-lg transition-colors font-bold cursor-pointer"
              >
                Open Lightbox
              </button>
            )}

            {onDownloadItem && (
              <button
                type="button"
                onClick={() => {
                  onDownloadItem(contextMenu.data);
                  onDismiss();
                }}
                className="w-full text-left px-2.5 py-1.5 hover:bg-glass-w12 rounded-lg transition-colors cursor-pointer"
              >
                Download Image
              </button>
            )}

            {onCopyImageLink && (
              <button
                type="button"
                onClick={() => {
                  onCopyImageLink(contextMenu.data.id);
                  onDismiss();
                }}
                className="w-full text-left px-2.5 py-1.5 hover:bg-glass-w12 rounded-lg transition-colors cursor-pointer"
              >
                Copy Image Link
              </button>
            )}

            {onSetWallpaper && (contextMenu.data.content_url || contextMenu.data.id) && (() => {
              const itemUrl = contextMenu.data.content_url || `/api/objects/${contextMenu.data.id}`;
              const itemMime = contextMenu.data.mime_type || (isMediaVideo(itemUrl) ? 'video/mp4' : 'image/jpeg');
              return (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      onSetWallpaper(itemUrl, 'app', itemMime);
                      onDismiss();
                    }}
                    className="w-full text-left px-2.5 py-1.5 hover:bg-glass-w12 rounded-lg transition-colors cursor-pointer"
                  >
                    Set as app background
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onSetWallpaper(itemUrl, 'os', itemMime);
                      onDismiss();
                    }}
                    className="w-full text-left px-2.5 py-1.5 hover:bg-glass-w12 rounded-lg transition-colors cursor-pointer"
                  >
                    Set as OS wallpaper
                  </button>
                </>
              );
            })()}

            {onToggleFavorite && (
              <button
                type="button"
                onClick={async () => {
                  const ok = await onToggleFavorite(contextMenu.data);
                  if (ok) toast('Updated starred status', 'success');
                  onDismiss();
                }}
                className="w-full text-left px-2.5 py-1.5 hover:bg-glass-w12 rounded-lg text-retro-accent transition-colors cursor-pointer"
              >
                Star / Favorite
              </button>
            )}

            {contextMenu.data.owner_id === identity?.orbitId && onRepostItem && (
              <button
                type="button"
                onClick={() => {
                  onRepostItem(contextMenu.data);
                  onDismiss();
                }}
                className="w-full text-left px-2.5 py-1.5 hover:bg-glass-w12 rounded-lg transition-colors cursor-pointer"
              >
                Repost to Feed
              </button>
            )}

            {contextMenu.data.owner_id === identity?.orbitId && onAddToStory && (
              <button
                type="button"
                onClick={() => {
                  onAddToStory(contextMenu.data);
                  onDismiss();
                }}
                className="w-full text-left px-2.5 py-1.5 hover:bg-glass-w12 rounded-lg transition-colors cursor-pointer"
              >
                Add to Story
              </button>
            )}

            {contextMenu.data.owner_id === identity?.orbitId ? (
              onDeleteItem && (
                <button
                  type="button"
                  onClick={() => {
                    onDeleteItem(contextMenu.data);
                    onDismiss();
                  }}
                  className="w-full text-left px-2.5 py-1.5 hover:bg-glass-w12 rounded-lg text-retro-error transition-colors cursor-pointer"
                >
                  Delete Image
                </button>
              )
            ) : (
              onRemoveFromInbox && (
                <button
                  type="button"
                  onClick={() => {
                    onRemoveFromInbox(contextMenu.data);
                    onDismiss();
                  }}
                  className="w-full text-left px-2.5 py-1.5 hover:bg-glass-w12 rounded-lg text-retro-warning transition-colors cursor-pointer"
                >
                  Remove from Inbox
                </button>
              )
            )}

            {onReportItem && (
              <button
                type="button"
                onClick={() => {
                  if (contextMenu.data.owner_id) {
                    onReportItem(contextMenu.data.owner_id, contextMenu.data.owner_name?.trim() || 'Unknown User', contextMenu.data.id);
                  }
                  onDismiss();
                }}
                className="w-full text-left px-2.5 py-1.5 hover:bg-glass-w12 rounded-lg text-retro-error font-bold transition-colors cursor-pointer"
              >
                Report Image
              </button>
            )}
          </>
        )}
      </div>
    </div>
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
        <h3 className="text-sm font-bold text-retro-error uppercase tracking-wider">
          Report User: {reportModal.name}
        </h3>
        {reportModal.objectId && (
          <p className="text-[10px] text-retro-muted font-sans truncate" title={reportModal.objectId}>
            Attached evidence: {reportModal.objectId}
          </p>
        )}
        <div className="flex flex-wrap gap-1.5 text-[10px]">
          {(['inappropriate', 'harassment', 'spam', 'abuse'] as const).map(cat => (
            <button
              key={cat}
              type="button"
              onClick={() => setReportCategory(cat)}
              className={`px-3 py-1 border font-bold uppercase tracking-wider transition-colors ${
                reportCategory === cat
                  ? 'bg-retro-accent text-black border-retro-accent'
                  : 'bg-retro-bg text-retro-muted border-border-glass hover:text-retro-fg'
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
          className="w-full p-2.5 bg-retro-bg border border-border-glass text-xs text-retro-fg placeholder:text-retro-muted focus:outline-none"
          maxLength={200}
        />
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => onSubmit(reportModal.id, { objectId: reportModal.objectId })}
            className="flex-1 bg-retro-error hover:bg-retro-red text-white font-bold py-2 text-xs transition-colors"
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
