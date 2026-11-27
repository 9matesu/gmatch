"use client";

import { ChevronDown, Radio, RefreshCw, Search } from 'lucide-react';
import { playPress } from '../../utils/sounds';
import {
  classes, COLOR, GAP, ICON, PADDING_X, PADDING_Y,
  RADIUS, TRANSITION, TYPE, WEIGHT,
} from '../../ui/tokens';

interface FeedHeaderProps {
  onOpenSearch?: () => void;
  /** Retrieve-by-force: bypasses the feed response cache and reloads. */
  onRefresh?: () => void;
  /** Sort tabs (For You / Latest) rendered inline — one bar, one row. */
  sortTabs?: React.ReactNode;
  /** Timeline/grid switch, rendered next to search. */
  layoutToggle?: React.ReactNode;
  /** Collapse control; omit to hide the chevron. */
  onToggleCollapse?: () => void;
  /** Self-ping: floats the caller to the top of the roster for 30 s. */
  onPingAttention?: () => void;
}

/** One toolbar shell: the glass material, one hairline edge and the token
 *  spacing/type/hover roles. The three icon buttons share one recipe instead of
 *  re-typing colour, radius, size and weight per call. */
const iconButton = classes(
  'p-2 cursor-pointer', RADIUS.chip, COLOR.body, COLOR.hoverW8, TRANSITION.micro,
);

export function FeedHeader({
  onOpenSearch,
  onRefresh,
  sortTabs,
  layoutToggle,
  onToggleCollapse,
  onPingAttention,
}: FeedHeaderProps) {
  return (
    <header className={classes(
      'sticky top-0 z-30 w-full glass-toolbar border-0 border-b rounded-none',
      'flex items-center justify-between',
      COLOR.edge, PADDING_X[3], 'sm:px-6', PADDING_Y[1.5], GAP[2],
    )}>
      <div className={classes('flex items-center shrink-0', GAP[2])}>
        {sortTabs}
      </div>

      <div className={classes('flex items-center shrink-0', GAP[1])}>
        {layoutToggle}

        {onPingAttention && (
          <button
            type="button"
            onClick={() => { playPress(880); onPingAttention(); }}
            title="Ping: put yourself at the top of the roster for 30s"
            aria-label="Ping for attention"
            className={classes(
              'flex items-center px-2.5 py-1.5 cursor-pointer',
              GAP[1], RADIUS.chip, TYPE.body, WEIGHT.semibold,
              COLOR.body, COLOR.hoverFg, COLOR.hoverW8, TRANSITION.micro,
            )}
          >
            <Radio className={ICON.md} />
            <span className="hidden sm:inline">Ping</span>
          </button>
        )}

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
            className={iconButton}
          >
            <RefreshCw className={ICON.md} />
          </button>
        )}

        <button
          type="button"
          onClick={() => { playPress(800); onOpenSearch?.(); }}
          title="Search"
          aria-label="Search"
          className={iconButton}
        >
          <Search className={ICON.md} />
        </button>

        {onToggleCollapse && (
          <button
            type="button"
            onClick={() => { playPress(800); onToggleCollapse(); }}
            title="Collapse Timeline"
            aria-label="Collapse Timeline"
            className={iconButton}
          >
            <ChevronDown className={ICON.md} />
          </button>
        )}
      </div>
    </header>
  );
}
