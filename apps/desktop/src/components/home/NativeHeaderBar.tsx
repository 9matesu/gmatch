"use client";

import React, { useState, useEffect } from 'react';
import {
  SpeakerHigh,
  SpeakerSlash,
  Minus,
  Square,
  X,
} from '@phosphor-icons/react';
import { playPress } from '../../utils/sounds';

export interface NativeHeaderBarProps {
  wsConnected?: boolean;
  pingMs?: number;
  activeRoomName?: string;
  onOpenSettings?: () => void;
}

export function NativeHeaderBar({
  wsConnected = true,
  pingMs = 38,
  activeRoomName,
  onOpenSettings,
}: NativeHeaderBarProps) {
  const [isMuted, setIsMuted] = useState(false);
  const [isPackaged, setIsPackaged] = useState(false);

  useEffect(() => {
    // Check if running in Electron
    const gmatch = (window as unknown as { gmatch?: { serverState?: () => Promise<{ packaged: boolean }> } }).gmatch;
    if (gmatch?.serverState) {
      gmatch.serverState().then((state) => {
        if (state?.packaged) setIsPackaged(true);
      }).catch(() => {});
    }
  }, []);

  const handleMinimize = () => {
    playPress(700);
    const electron = (window as unknown as { electron?: { minimizeWindow?: () => void } }).electron;
    electron?.minimizeWindow?.();
  };

  const handleMaximize = () => {
    playPress(750);
    const electron = (window as unknown as { electron?: { toggleMaximize?: () => void } }).electron;
    electron?.toggleMaximize?.();
  };

  const handleClose = () => {
    playPress(600);
    const electron = (window as unknown as { electron?: { closeWindow?: () => void } }).electron;
    electron?.closeWindow?.();
  };

  const toggleSound = () => {
    playPress(isMuted ? 880 : 440);
    setIsMuted(!isMuted);
    // Hook to global audio mute if available
    const audioState = (window as unknown as { __GMATCH_AUDIO_MUTED__?: boolean });
    audioState.__GMATCH_AUDIO_MUTED__ = !isMuted;
  };

  return (
    <header
      className="w-full h-9 flex items-center justify-between px-3 select-none z-40 bg-transparent text-xs"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Left: Branding & Space Indicator */}
      <div
        className="flex items-center gap-2"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <div className="flex items-center gap-2 font-bold tracking-tight text-white/90">
          <span className="w-2 h-2 rounded-sm bg-[#58a6ff]" />
          <span className="text-[13px] font-bold tracking-wide text-white">gMatch</span>
        </div>

        {activeRoomName && (
          <div className="hidden sm:flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-white/[0.04] border border-white/5 text-[11px] text-retro-muted">
            <span className="w-1.5 h-1.5 rounded-full bg-[#58a6ff]" />
            <span className="truncate max-w-[140px]">{activeRoomName}</span>
          </div>
        )}
      </div>

      {/* Right: Telemetry & Window Controls */}
      <div
        className="flex items-center gap-2 text-retro-muted"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {/* Network status pill */}
        <div
          className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-white/[0.03] border border-white/5 text-[10px] font-mono tabular-nums"
          title={wsConnected ? 'Connected to Swarm' : 'Reconnecting...'}
        >
          {wsConnected ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-[#3fb950] shadow-[0_0_4px_#3fb950]" />
              <span className="text-[#3fb950] font-medium hidden sm:inline">{pingMs}ms</span>
            </>
          ) : (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-[#d29922] animate-pulse" />
              <span className="text-[#d29922] font-medium hidden sm:inline">Offline</span>
            </>
          )}
        </div>

        {/* Audio mute toggle */}
        <button
          type="button"
          onClick={toggleSound}
          className="p-1 rounded hover:bg-white/10 hover:text-white transition-colors"
          aria-label={isMuted ? 'Unmute audio' : 'Mute audio'}
          title={isMuted ? 'Unmute Audio' : 'Mute Audio'}
        >
          {isMuted ? (
            <SpeakerSlash className="w-3.5 h-3.5 text-[#f85149]" />
          ) : (
            <SpeakerHigh className="w-3.5 h-3.5 text-retro-muted hover:text-white" />
          )}
        </button>

        {/* Electron Window Controls (only on desktop packaged/electron) */}
        <div className="flex items-center gap-0.5 ml-1 border-l border-white/10 pl-1.5">
          <button
            type="button"
            onClick={handleMinimize}
            className="p-1 rounded hover:bg-white/10 hover:text-white transition-colors"
            aria-label="Minimize"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleMaximize}
            className="p-1 rounded hover:bg-white/10 hover:text-white transition-colors"
            aria-label="Maximize"
          >
            <Square className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={handleClose}
            className="p-1 rounded hover:bg-[#f85149] hover:text-white transition-colors"
            aria-label="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </header>
  );
}
