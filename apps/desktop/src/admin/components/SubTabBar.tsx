"use client";

import type { ComponentType } from "react";
import { cn } from "../../lib/utils";
import { Button } from "../../ui/kit";
import { classes, COLOR, GAP, ICON, PADDING, PADDING_X, PADDING_Y, RADIUS, SHADOW, TYPE, WEIGHT } from "../../ui/tokens";

/**
 * One tab definition: a stable id, the visible label, and an icon.
 *
 * `badge` is an optional trailing count (unread reports, live matches). It is
 * data, not markup, so the four admin tabs that render this bar share ONE
 * implementation instead of four copies that drift.
 */
export interface SubTabDef {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  badge?: number | null;
}

interface SubTabBarProps {
  tabs: readonly SubTabDef[];
  active: string;
  onChange: (id: string) => void;
  /** Extra classes for the bar itself. */
  className?: string;
}

/**
 * The admin sub-tab selector.
 *
 * This bar was copy-pasted in ContentTab, ModerationTab, UsersTab and
 * SettingsTab — four copies that had already drifted (some used `tab`, some
 * `section`; only two supported a badge). One component keeps the shape, the
 * spacing and the badge rule in a single place.
 */
export function SubTabBar({ tabs, active, onChange, className }: SubTabBarProps) {
  return (
    <div
      role="tablist"
      className={cn(
        classes('flex flex-wrap', GAP[1], COLOR.surfaceRaised, 'border', COLOR.edge, RADIUS.panel, PADDING[1]),
        className,
      )}
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = active === tab.id;
        return (
          <Button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            variant={isActive ? 'primary' : 'ghost'}
            onClick={() => onChange(tab.id)}
            className={classes(PADDING_X[3], PADDING_Y[1.5], TYPE.body, WEIGHT.bold, 'flex items-center', GAP[1.5], isActive && SHADOW.sm)}
          >
            <Icon className={ICON.sm} />
            {tab.label}
            {typeof tab.badge === "number" && tab.badge > 0 && (
              <span className={classes('ml-1', PADDING_X[1.5], 'py-0.2', COLOR.glassW8, COLOR.muted, RADIUS.pill, TYPE.caption, 'tabular-nums')}>
                {tab.badge}
              </span>
            )}
          </Button>
        );
      })}
    </div>
  );
}