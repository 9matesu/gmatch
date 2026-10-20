"use client";

import { ChevronDown, RefreshCw, Search } from 'lucide-react';
import { playPress } from '../../utils/sounds';

interface FeedHeaderProps {
  onOpenSearch?: () => void;
  /** Retrieve-by-force: bypasses the feed response cache and reloads. */
  onRefresh?: () => void;
  /** Sort tabs (For You / Latest) rendered inline — one bar, one row. */
  sortTabs?: React.ReactNode;
  /** Grid 1-5 picker, rendered next to search. */
  colsControls?: React.ReactNode;
  /** Collapse control; omit to hide the chevron. */
  onToggleCollapse?: () => void;
}

export function FeedHeader({
  onOpenSearch,
  onRefresh,
  sortTabs,
  colsControls,
  onToggleCollapse,
}: FeedHeaderProps) {
  return (
    <header className="sticky top-0 z-30 w-full glass-toolbar border-0 border-b border-border-glass rounded-none px-3 sm:px-6 py-1.5 flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 shrink-0">
        {sortTabs}
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {colsControls}

        {onRefresh && (
          <button
            type="button"
            onClick={() => { playPress(800); onRefresh(); }}
            title="Reload feed (bypass cache)"
            // The empty state renders a second "Reload feed" button lower on
            // the page. Same action, so the audit flags the pair; the two are
            // distinguished by where they are, which the name has to carry
            // because a screen reader announces neither position.
            aria-label="Reload feed toolbar"
            className="p-2 rounded-md text-retro-body hover:bg-glass-w8 transition-colors cursor-pointer"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        )}

        <button
          type="button"
          onClick={() => { playPress(800); onOpenSearch?.(); }}
          title="Search"
          aria-label="Search"
          className="p-2 rounded-md text-retro-body hover:bg-glass-w8 transition-colors cursor-pointer"
        >
          <Search className="w-5 h-5" />
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