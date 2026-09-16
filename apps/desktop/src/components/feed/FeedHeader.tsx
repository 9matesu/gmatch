"use client";

import { Bell, ChevronDown, Search } from 'lucide-react';
import { playPress } from '../../utils/sounds';

interface FeedHeaderProps {
  unreadCount?: number;
  onOpenSearch?: () => void;
  onOpenNotifications?: () => void;
  /** Sort tabs (For You / Latest) rendered inline — one bar, one row. */
  sortTabs?: React.ReactNode;
  /** Grid 1-5 picker, rendered next to search/notifications. */
  colsControls?: React.ReactNode;
  /** Collapse control; omit to hide the chevron. */
  onToggleCollapse?: () => void;
}

export function FeedHeader({
  unreadCount = 0,
  onOpenSearch,
  onOpenNotifications,
  sortTabs,
  colsControls,
  onToggleCollapse,
}: FeedHeaderProps) {
  return (
    <header className="sticky top-0 z-30 w-full glass-toolbar border-0 border-b border-border-glass rounded-none px-3 sm:px-6 py-1.5 flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 shrink-0">
        <span className="font-sans font-semibold text-sm text-retro-fg select-none">
          Timeline
        </span>
        {sortTabs}
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {colsControls}

        <button
          type="button"
          onClick={() => { playPress(800); onOpenSearch?.(); }}
          title="Search"
          aria-label="Search"
          className="p-2 rounded-md text-retro-body hover:bg-glass-w8 transition-colors cursor-pointer"
        >
          <Search className="w-5 h-5" />
        </button>

        <button
          type="button"
          onClick={() => { playPress(800); onOpenNotifications?.(); }}
          title="Notifications"
          aria-label="Notifications"
          className="relative p-2 rounded-md text-retro-body hover:bg-glass-w8 transition-colors cursor-pointer"
        >
          <Bell className="w-5 h-5" />
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-retro-fg" />
          )}
        </button>

        {onToggleCollapse && (
          <button
            type="button"
            onClick={() => { playPress(800); onToggleCollapse(); }}
            title="Collapse Timeline"
            aria-label="Collapse Timeline"
            className="p-2 rounded-md text-retro-body hover:bg-glass-w8 transition-colors cursor-pointer"
          >
            <ChevronDown className="w-4 h-4" />
          </button>
        )}
      </div>
    </header>
  );
}