"use client";

// Desktop side dock: expands into a full-height flex sibling of the main
// column (pushes the timeline, never overlays it). Stops above the floating
// command island so the pill bar is never covered (user directive 2026-09-12:
// panels must sit above the pillbar, aligned). Chat docks right,
// notifications dock left.

import type { ReactNode } from 'react';

interface Props {
  open: boolean;
  side?: 'left' | 'right';
  widthClass?: string;
  children: ReactNode;
}

export function MessagesRail({ open, side = 'right', widthClass = 'w-[min(720px,40vw)]', children }: Props) {
  if (!open) return null;

  return (
    <div
      data-rail-panel
      className={`hidden md:flex flex-col relative self-stretch ${widthClass} shrink-0 mb-[var(--island-clearance)] border-border-glass bg-retro-panel overflow-hidden ${side === 'right' ? 'border-l' : 'border-r'}`}
    >
      <div className="flex-1 min-h-0 p-1">
        {children}
      </div>
    </div>
  );
}
