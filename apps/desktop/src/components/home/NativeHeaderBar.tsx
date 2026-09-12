"use client";

import React, { useState, useEffect } from 'react';
import { SpeakerHigh, SpeakerSlash, Minus, Square, X } from '@phosphor-icons/react';
import { isAudioMuted, setAudioMuted } from '../../utils/sounds';

export interface NativeHeaderBarProps {
  wsConnected?: boolean;
  pingMs?: number;
  activeRoomName?: string;
}

export function NativeHeaderBar({
  wsConnected: _wsConnected = true,
  pingMs: _pingMs,
  activeRoomName: _activeRoomName,
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
      {/* Left: Branding */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 font-bold tracking-tight">
          <span className="w-2 h-2 rounded-sm bg-retro-info" />
          <span className="text-[13px] font-bold tracking-wide text-retro-fg">gMatch</span>
        </div>
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
