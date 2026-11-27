"use client";

import type { ComponentType } from "react";
import { cn } from "../../lib/utils";

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
        "flex flex-wrap gap-1 bg-surface-raised border border-edge rounded-xl p-1",
        className,
      )}
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className={cn(
              "px-3 py-1.5 text-xs font-bold rounded-lg transition flex items-center gap-1.5 cursor-pointer",
              isActive
                ? "bg-retro-accent text-retro-accent-text shadow-sm"
                : "text-retro-muted hover:text-retro-fg",
            )}
          >
            <Icon className="w-3.5 h-3.5" />
            {tab.label}
            {typeof tab.badge === "number" && tab.badge > 0 && (
              <span className="ml-1 px-1.5 py-0.2 bg-glass-w10 text-retro-muted rounded-full text-2xs tabular-nums">
                {tab.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}