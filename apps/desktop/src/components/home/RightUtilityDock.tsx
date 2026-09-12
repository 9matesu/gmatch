"use client";

import { useState } from 'react';
import { playPress } from '../../utils/sounds';
import {
  MessageSquare,
  Users,
  Settings,
  Share2,
  Image,
} from 'lucide-react';

export function RightUtilityDock({
  onToggleChat,
  chatOpen,
  chatUnreadCount = 0,
  onTogglePlayers,
  playersOpen,
  onlineCount = 0,
  onOpenTools,
  onOpenWallpaper,
  onShare,
}: {
  onToggleChat?: () => void;
  chatOpen?: boolean;
  chatUnreadCount?: number;
  onTogglePlayers?: () => void;
  playersOpen?: boolean;
  onlineCount?: number;
  onOpenTools?: () => void;
  onOpenWallpaper?: () => void;
  onShare?: () => void;
}) {
  const [hoveredBtn, setHoveredBtn] = useState<string | null>(null);

  const handleAction = (cb?: () => void, freq: number = 800) => {
    playPress(freq);
    cb?.();
  };

  const dockButtons = [
    {
      id: 'players',
      label: 'Players',
      icon: Users,
      active: playersOpen,
      count: onlineCount,
      countColor: 'bg-emerald-500 text-retro-fg',
      action: onTogglePlayers,
      freq: 820,
    },
    {
      id: 'chat',
      label: 'Chat Room',
      icon: MessageSquare,
      active: chatOpen,
      count: chatUnreadCount,
      countColor: 'bg-amber-500 text-white',
      action: onToggleChat,
      freq: 840,
    },

    {
      id: 'settings',
      label: 'Settings',
      icon: Settings,
      active: false,
      action: onOpenTools,
      freq: 720,
    },
    {
      id: 'wallpaper',
      label: 'Wallpaper',
      icon: Image,
      active: false,
      action: onOpenWallpaper,
      freq: 700,
    },
  ];

  return (
    <aside
      aria-label="Quick Actions Dock"
      className="hidden lg:flex fixed right-3 top-1/2 -translate-y-1/2 z-50 flex-col items-center gap-2 p-1.5 bg-surface-canvas/90 backdrop-blur-2xl border border-border-glass rounded-xl shadow-2xl pointer-events-auto font-sans select-none animate-orbit-slide-left"
    >
      {/* 1-3. Main Dock Buttons with Exact Geometric Center Alignment */}
      {dockButtons.map((btn) => {
        if (!btn.action) return null;
        const Icon = btn.icon;
        const isHovered = hoveredBtn === btn.id;

        return (
          <div key={btn.id} className="relative flex items-center justify-center">
            {/* Floating Tooltip Label on Hover (left side) */}
            {isHovered && (
              <div className="absolute right-full mr-2.5 px-2.5 py-1 rounded-xl bg-surface-canvas/95 border border-border-glass text-retro-fg text-xs font-bold shadow-2xl shadow-zinc-950/80 backdrop-blur-xl whitespace-nowrap pointer-events-none z-50 animate-orbit-slide-up flex items-center gap-1.5">
                <span>{btn.label}</span>
                {Boolean(btn.count && btn.count > 0) && (
                  <span className={`px-1.5 py-0.2 rounded-md text-[10px] font-black ${btn.countColor}`}>
                    {btn.count}
                  </span>
                )}
                {/* Pointer arrow */}
                <div className="absolute -right-1 top-1/2 -translate-y-1/2 w-2 h-2 rotate-45 bg-surface-canvas border-r border-t border-border-glass" />
              </div>
            )}

            <button
              type="button"
              onClick={() => handleAction(btn.action, btn.freq)}
              onMouseEnter={() => setHoveredBtn(btn.id)}
              onMouseLeave={() => setHoveredBtn(null)}
              aria-label={btn.label}
              className={`p-0 m-0 w-11 h-11 aspect-square rounded-xl inline-flex items-center justify-center transition-all duration-150 cursor-pointer overflow-hidden active:scale-90 shadow-md ${btn.active
                ? 'bg-gradient-to-r from-zinc-200 to-white text-retro-fg font-bold border border-border-glass shadow-zinc-950/50 scale-105'
                : 'btn-skeuo text-retro-muted hover:text-retro-fg hover:border-border-glass'
                }`}
            >
              {/* Perfectly Centered Icon */}
              <Icon className={`w-4.5 h-4.5 shrink-0 block m-auto transition-transform duration-150 ${btn.id === 'settings' && isHovered ? 'rotate-45' : isHovered ? 'scale-110' : ''}`} />
            </button>

            {/* Badge Indicator attached to outer wrapper so it never offsets inner icon */}
            {Boolean(btn.count && btn.count > 0) && (
              <span
                className={`absolute -top-1 -right-1 z-20 pointer-events-none px-1.5 py-0.2 font-black text-[10px] rounded-full shadow-md ${btn.countColor
                  }`}
              >
                {btn.count}
              </span>
            )}
          </div>
        );
      })}

      {/* Buy Me a Coffee / Discord buttons removed in 1.0.1 (user setup: the
          app ships no promotion links or hardcoded third-party URLs). */}
      <div className="w-6 h-[1px] bg-surface-elevated/80 mx-auto my-0.5 shrink-0" />

      {/* 5. Share Button */}
      {onShare && (
        <div className="relative flex items-center justify-center">
          {hoveredBtn === 'share' && (
            <div className="absolute right-full mr-2.5 px-2.5 py-1 rounded-xl bg-surface-canvas/95 border border-border-glass text-retro-fg text-xs font-bold shadow-2xl shadow-zinc-950/80 backdrop-blur-xl whitespace-nowrap pointer-events-none z-50 animate-orbit-slide-up flex items-center gap-1">
              <span>Share Link</span>
              <div className="absolute -right-1 top-1/2 -translate-y-1/2 w-2 h-2 rotate-45 bg-surface-canvas border-r border-t border-border-glass" />
            </div>
          )}

          <button
            type="button"
            onClick={() => handleAction(onShare, 750)}
            onMouseEnter={() => setHoveredBtn('share')}
            onMouseLeave={() => setHoveredBtn(null)}
            aria-label="Share Link"
            className="p-0 m-0 w-11 h-11 aspect-square rounded-xl inline-flex items-center justify-center transition-all duration-150 cursor-pointer overflow-hidden active:scale-90 btn-skeuo text-retro-muted hover:text-retro-fg hover:border-border-glass shadow-md"
          >
            <Share2 className="w-4.5 h-4.5 shrink-0 block m-auto transition-transform duration-150 hover:scale-110" />
          </button>
        </div>
      )}
    </aside>
  );
}
