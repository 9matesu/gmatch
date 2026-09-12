"use client";

import React, { useState, useEffect } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { isAudioMuted, setAudioMuted } from '../../utils/sounds';

export interface NativeHeaderBarProps {
  wsConnected?: boolean;
  pingMs?: number;
  activeRoomName?: string;
}

export function NativeHeaderBar({
  wsConnected = true,
  pingMs,
  activeRoomName,
}: NativeHeaderBarProps) {
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
      {/* Left: Branding & current view */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 font-bold tracking-tight">
          <span className="w-2 h-2 rounded-sm bg-retro-info" />
          <span className="text-[13px] font-bold tracking-wide text-retro-fg">gMatch</span>
        </div>

        {activeRoomName && (
          <div className="hidden sm:flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-glass-w5 border border-border-glass text-[11px] text-retro-muted">
            <span className="w-1.5 h-1.5 rounded-full bg-retro-info" />
            <span className="truncate max-w-[140px]">{activeRoomName}</span>
          </div>
        )}
      </div>

      {/* Right: presence dot + mute (ponytail: window controls live natively —
          frameless wiring is a separate wave, see plan 2026-09-12 HUD review T6) */}
      <div
        className="flex items-center gap-2 text-retro-muted"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <span
          role="status"
          aria-label={wsConnected ? 'Connected' : 'Reconnecting'}
          title={wsConnected ? 'Connected to swarm' : 'Reconnecting'}
          className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-glass-w5 border border-border-glass text-[10px] font-mono tabular-nums ${wsConnected ? 'text-retro-online' : 'text-retro-warning'}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${wsConnected ? 'bg-retro-online' : 'bg-retro-warning animate-pulse'}`} />
          {typeof pingMs === 'number' ? `${pingMs}ms` : wsConnected ? 'Online' : 'Offline'}
        </span>

        <button
          type="button"
          onClick={toggleSound}
          className="p-1.5 rounded-md hover:bg-glass-w10 hover:text-retro-fg transition-colors cursor-pointer"
          aria-label={isMuted ? 'Unmute audio' : 'Mute audio'}
          title={isMuted ? 'Unmute Audio' : 'Mute Audio'}
        >
          {isMuted ? (
            <VolumeX className="w-3.5 h-3.5 text-retro-error" />
          ) : (
            <Volume2 className="w-3.5 h-3.5" />
          )}
        </button>
      </div>
    </header>
  );
}
