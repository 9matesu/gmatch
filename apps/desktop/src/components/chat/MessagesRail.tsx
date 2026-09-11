"use client";

// Desktop messages dock: collapsed tab pinned bottom-right; expands into a
// full-height flex sibling of the main column (pushes the timeline left,
// never overlays it). Chat only — players/groups live in the thread list.

import type { ReactNode } from 'react';

interface Props {
  open: boolean;
  onToggle: () => void;
  unreadCount: number;
  children: ReactNode;
}

export function MessagesRail({ open, onToggle, unreadCount, children }: Props) {
  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={false}
          aria-label="Expand messages"
          title="Messages"
          className="hidden md:flex fixed bottom-2 right-2 z-[var(--z-dropdown)] items-center gap-2 py-2 px-3 rounded-md hover:bg-glass-w10 text-retro-muted hover:text-retro-fg cursor-pointer select-none"
        >
          <span className="text-lg leading-none" aria-hidden>⌃</span>
          <span className="text-[10px] uppercase tracking-wider">Messages</span>
          {unreadCount > 0 && <span className="w-2 h-2 rounded-full bg-retro-fg" />}
        </button>
      )}

      {open && (
        <div data-rail-panel className="hidden md:flex flex-col relative h-full w-[min(720px,40vw)] shrink-0 border-l border-border-glass bg-retro-panel overflow-hidden">
          <div className="flex items-center justify-between px-2 py-1.5 border-b border-border-glass shrink-0">
            <span className="text-[10px] uppercase tracking-wider text-retro-muted">Messages</span>
            <button
              type="button"
              onClick={onToggle}
              aria-expanded
              aria-label="Collapse messages"
              className="p-1.5 rounded-md hover:bg-glass-w8 text-retro-muted hover:text-retro-fg cursor-pointer"
            >
              <span className="text-base leading-none" aria-hidden>⌄</span>
            </button>
          </div>
          <div className="flex-1 min-h-0 p-1">
            {children}
          </div>
        </div>
      )}
    </>
  );
}
