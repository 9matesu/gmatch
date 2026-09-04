"use client";

import { useState } from 'react';
import { playPress } from '../../utils/sounds';
import { Camera, PlusSquare, Layers, Shield, Search, Heart, Send } from 'lucide-react';

interface FeedHeaderProps {
  unreadCount?: number;
  onOpenCamera?: () => void;
  onCreatePost?: () => void;
  onToggleTools?: () => void;
  onOpenSearch?: () => void;
  onOpenNotifications?: () => void;
  onOpenDMs?: () => void;
}

export function FeedHeader({
  unreadCount = 0,
  onOpenCamera,
  onCreatePost,
  onToggleTools,
  onOpenSearch,
  onOpenNotifications,
  onOpenDMs,
}: FeedHeaderProps) {
  const [toolsDropdownOpen, setToolsDropdownOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 w-full glass-toolbar border-0 border-b border-border-glass rounded-none px-3 sm:px-6 py-3 flex items-center justify-between">
      {/* Left: Camera Button + Brand */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => { playPress(800); onOpenCamera?.(); }}
          title="Open Camera"
          aria-label="Open Camera"
           className="create-action p-2 rounded-xl text-current hover:bg-white/8 transition-all cursor-pointer"
        >
          <Camera className="w-5 h-5" />
        </button>

        <span className="font-sans font-semibold text-base text-retro-fg select-none">
          goonMatch
        </span>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => { playPress(800); onCreatePost?.(); }}
          title="Create Post"
          aria-label="Create Post"
          className="p-2 rounded-md text-retro-body hover:bg-white/8 transition-colors cursor-pointer"
        >
          <PlusSquare className="w-5 h-5" />
        </button>

        <div className="relative">
          <button
            type="button"
            onClick={() => setToolsDropdownOpen((v) => !v)}
            title="Tools"
            aria-label="Tools"
            className="p-2 rounded-md text-retro-body hover:bg-white/8 transition-colors cursor-pointer"
          >
            <Layers className="w-5 h-5" />
          </button>

          {toolsDropdownOpen && (
            <div className="absolute right-0 top-full mt-1 w-48 glass-panel rounded-md shadow-lg p-1 z-50 animate-orbit-slide-up">
              <div className="px-2.5 py-1.5 text-[10px] font-medium text-retro-muted metro-rule">
                Tools
              </div>
              <button
                type="button"
                onClick={() => {
                  setToolsDropdownOpen(false);
                  onToggleTools?.();
                }}
                className="w-full px-2.5 py-2 text-left text-xs text-retro-body hover:bg-white/8 rounded-md flex items-center gap-2 cursor-pointer"
              >
                <Shield className="w-4 h-4 text-retro-muted" />
                <span>System Drawer</span>
              </button>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => { playPress(800); onOpenSearch?.(); }}
          title="Search"
          aria-label="Search"
          className="p-2 rounded-md text-retro-body hover:bg-white/8 transition-colors cursor-pointer"
        >
          <Search className="w-5 h-5" />
        </button>

        <button
          type="button"
          onClick={() => { playPress(800); onOpenNotifications?.(); }}
          title="Notifications"
          aria-label="Notifications"
          className="relative p-2 rounded-md text-retro-body hover:bg-white/8 transition-colors cursor-pointer"
        >
          <Heart className="w-5 h-5" />
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-retro-accent shadow-[0_0_8px_rgba(159,227,255,0.4)]" />
          )}
        </button>

        <button
          type="button"
          onClick={() => { playPress(800); onOpenDMs?.(); }}
          title="Messages"
          aria-label="Messages"
          className="relative p-2 rounded-md text-retro-body hover:bg-white/8 transition-colors cursor-pointer"
        >
          <Send className="w-5 h-5" />
        </button>
      </div>
    </header>
  );
}
