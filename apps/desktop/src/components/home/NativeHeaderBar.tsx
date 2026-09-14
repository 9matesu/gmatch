"use client";

import React, { useState, useEffect } from 'react';
import { SpeakerHigh, SpeakerSlash, Minus, Square, X, CaretLeft, CaretRight } from '@phosphor-icons/react';
import { isAudioMuted, setAudioMuted, playPress } from '../../utils/sounds';

export interface NativeHeaderBarProps {
  wsConnected?: boolean;
  pingMs?: number;
  activeRoomName?: string;
  onGoBack?: () => void;
  onGoForward?: () => void;
}

export function NativeHeaderBar({
  wsConnected: _wsConnected = true,
  pingMs: _pingMs,
  activeRoomName: _activeRoomName,
  onGoBack,
  onGoForward,
}: NativeHeaderBarProps = {}) {
  const [isMuted, setIsMuted] = useState(false);

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
      className="w-full h-9 flex items-center justify-between px-3 select-none z-[var(--z-dropdown)] bg-transparent text-xs"
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
            className="p-1 rounded-md hover:bg-glass-w10 hover:text-retro-fg transition-colors cursor-pointer"
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
            className="p-1 rounded-md hover:bg-glass-w10 hover:text-retro-fg transition-colors cursor-pointer"
          >
            <CaretRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <span className="text-[13px] font-bold tracking-wide text-retro-fg select-none ml-1">gMatch</span>
      </div>

      {/* Right: mute + window controls (frameless: buttons render
          only when the preload bridge exposes them. Browser/dev = no bridge) */}
      <div
        className="flex items-center gap-2 text-retro-muted"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >

        <button
          type="button"
          onClick={toggleSound}
          className="p-1.5 rounded-md hover:bg-glass-w10 hover:text-retro-fg transition-colors cursor-pointer"
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
