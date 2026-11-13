"use client";

import React, { useState, useEffect, useRef } from 'react';
import { SpeakerHigh, SpeakerSlash, Minus, Square, X, CaretLeft, CaretRight, Plus } from '@phosphor-icons/react';
import { isAudioMuted, setAudioMuted, playPress } from '../../utils/sounds';
import { NotificationCenter, type NotificationCenterProps } from '../notifications/NotificationCenter';
import { MediaPickerPanel } from '../media/MediaPickerModal';
import type { MediaSelection } from '../media/picker';

export interface NativeHeaderBarProps {
  wsConnected?: boolean;
  pingMs?: number;
  activeRoomName?: string;
  onGoBack?: () => void;
  onGoForward?: () => void;
  /** Opens the post creator. Omitted in tests / non-shell embeds. */
  onCreatePost?: () => void;
  /** A media pick from the hover bubble goes straight into the post creator
   *  pre-attached. Omitted → the bubble is not offered (tests / embeds). */
  onPickMedia?: (sel: MediaSelection) => void;
  /**
   * The unified notification centre's data + handlers. Omitted only in tests /
   * non-shell embeds; the bell still renders, just with an empty inbox.
   */
  notifications?: NotificationCenterProps;
}

export function NativeHeaderBar({
  wsConnected: _wsConnected = true,
  pingMs: _pingMs,
  activeRoomName: _activeRoomName,
  onGoBack,
  onGoForward,
  onCreatePost,
  onPickMedia,
  notifications,
}: NativeHeaderBarProps = {}) {
  const [isMuted, setIsMuted] = useState(false);
  // Hover bubble: the media picker opens FROM the Post button (small intent
  // delay so a drive-by across the bar doesn't flash it; a grace period on
  // leave so moving into the bubble never closes it).
  const [pickerOpen, setPickerOpen] = useState(false);
  const hoverTimer = useRef<number | null>(null);
  const leaveTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    if (leaveTimer.current) window.clearTimeout(leaveTimer.current);
  }, []);

  const openPickerSoon = () => {
    if (!onPickMedia || pickerOpen) return;
    if (leaveTimer.current) { window.clearTimeout(leaveTimer.current); leaveTimer.current = null; }
    if (hoverTimer.current) return;
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = null;
      setPickerOpen(true);
    }, 180);
  };
  const closePickerSoon = () => {
    if (hoverTimer.current) { window.clearTimeout(hoverTimer.current); hoverTimer.current = null; }
    if (!pickerOpen || leaveTimer.current) return;
    leaveTimer.current = window.setTimeout(() => {
      leaveTimer.current = null;
      setPickerOpen(false);
    }, 260);
  };
  useEffect(() => {
    if (!pickerOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPickerOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pickerOpen]);

  useEffect(() => {
    setIsMuted(isAudioMuted());
  }, []);

  const toggleSound = () => {
    const next = !isMuted;
    setAudioMuted(next);
    setIsMuted(next);
  };

  return (
    <header
      className="relative w-full h-9 flex items-center justify-between px-3 select-none z-[var(--z-dropdown)] bg-transparent text-xs"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Left: Navigators & Branding */}
      <div
        className="flex items-center gap-1.5"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <div className="flex items-center gap-0.5 text-retro-muted">
          <button
            type="button"
            onClick={() => {
              playPress(700);
              if (onGoBack) onGoBack();
              else window.history.back();
            }}
            title="Back"
            aria-label="Back"
            className="p-1 min-w-[28px] min-h-[28px] flex items-center justify-center rounded-md hover:bg-glass-w10 hover:text-retro-fg transition-colors cursor-pointer"
          >
            <CaretLeft className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              playPress(700);
              if (onGoForward) onGoForward();
              else window.history.forward();
            }}
            title="Forward"
            aria-label="Forward"
            className="p-1 min-w-[28px] min-h-[28px] flex items-center justify-center rounded-md hover:bg-glass-w10 hover:text-retro-fg transition-colors cursor-pointer"
          >
            <CaretRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <span className="text-[13px] font-bold tracking-wide text-retro-fg select-none ml-1">gMatch</span>
      </div>

      {/* Center: THE Post button — one focal point, dead-center of the screen.
          Bigger than the bar chrome; everything else flanks it. */}
      {onCreatePost && (
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          onMouseEnter={openPickerSoon}
          onMouseLeave={closePickerSoon}
          onKeyDown={(e) => { if (e.key === 'Escape') setPickerOpen(false); }}
        >
          <button
            type="button"
            onClick={() => {
              playPress(900);
              if (hoverTimer.current) { window.clearTimeout(hoverTimer.current); hoverTimer.current = null; }
              setPickerOpen(false);
              onCreatePost();
            }}
            aria-label="Create a post"
            title="Create a post — hover for the media picker"
            aria-haspopup={onPickMedia ? 'dialog' : undefined}
            aria-expanded={onPickMedia ? pickerOpen : undefined}
            className="flex items-center gap-1.5 rounded-md bg-white px-3.5 h-7 text-xs font-bold uppercase tracking-wider text-black hover:bg-white/85 transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" weight="bold" />
            Post
          </button>
          {/* The picker pops FROM the button: an animated glass bubble
              anchored under the navbar, not a centered modal. */}
          {pickerOpen && onPickMedia && (
            <div
              role="dialog"
              aria-label="Pick post media"
              className="absolute right-0 top-[calc(100%+8px)] z-[var(--z-modal)] w-[340px] animate-orbit-pop origin-top-right"
              onMouseEnter={() => { if (leaveTimer.current) { window.clearTimeout(leaveTimer.current); leaveTimer.current = null; } }}
              onMouseLeave={closePickerSoon}
            >
              <MediaPickerPanel
                compact
                options={{ accept: ['image', 'video'], sources: ['browse', 'upload', 'url'], title: 'Pick post media' }}
                onPick={(sel) => { setPickerOpen(false); onPickMedia(sel); }}
                onClose={() => setPickerOpen(false)}
              />
            </div>
          )}
        </div>
      )}

      {/* Right: notifications + mute + window controls (frameless: buttons
          render only when the preload bridge exposes them. Browser/dev =
          no bridge) */}
      <div
        className="flex items-center gap-2 text-retro-muted"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <NotificationCenter
          {...(notifications ?? {
            onMarkAllRead: () => {},
            onMarkRead: () => {},
            onOpenTarget: () => {},
            onOpenLocalTarget: () => {},
            onMarkLocalRead: () => {},
          })}
        />

        <button
          type="button"
          onClick={toggleSound}
          className="p-1.5 min-w-[28px] min-h-[28px] flex items-center justify-center rounded-md hover:bg-glass-w10 hover:text-retro-fg transition-colors cursor-pointer"
          aria-label={isMuted ? 'Unmute audio' : 'Mute audio'}
          title={isMuted ? 'Unmute Audio' : 'Mute Audio'}
        >
          {isMuted ? (
            <SpeakerSlash className="w-3.5 h-3.5 text-retro-error" />
          ) : (
            <SpeakerHigh className="w-3.5 h-3.5" />
          )}
        </button>

        {window.gmatch?.winClose && (
          <div className="flex items-center gap-0.5 ml-1 border-l border-border-glass pl-1.5">
            <button
              type="button"
              onClick={window.gmatch.winMinimize}
              className="p-1.5 rounded-md hover:bg-glass-w10 hover:text-retro-fg transition-colors cursor-pointer"
              aria-label="Minimize window"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={window.gmatch.winToggleMaximize}
              className="p-1.5 rounded-md hover:bg-glass-w10 hover:text-retro-fg transition-colors cursor-pointer"
              aria-label="Maximize window"
            >
              <Square className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={window.gmatch.winClose}
              className="p-1.5 rounded-md hover:bg-retro-error hover:text-retro-fg transition-colors cursor-pointer"
              aria-label="Close window"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
