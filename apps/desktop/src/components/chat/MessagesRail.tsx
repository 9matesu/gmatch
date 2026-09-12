"use client";

// Desktop messages dock: expands into a full-height flex sibling of the
// main column (pushes the timeline left, never overlays it).

import type { ReactNode } from 'react';

interface Props {
  open: boolean;
  onToggle?: () => void;
  unreadCount?: number;
  children: ReactNode;
}

export function MessagesRail({ open, children }: Props) {
  if (!open) return null;

  return (
    <div data-rail-panel className="hidden md:flex flex-col relative h-full w-[min(720px,40vw)] shrink-0 border-l border-border-glass bg-retro-panel overflow-hidden">
      <div className="flex-1 min-h-0 p-1">
        {children}
      </div>
    </div>
  );
}
