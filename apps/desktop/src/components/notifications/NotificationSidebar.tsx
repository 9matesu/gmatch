"use client";

import { X } from 'lucide-react';
import { NotificationCenter, type NotificationCenterProps } from './NotificationCenter';

/**
 * Fixed left notification sidebar. A dedicated, animated space for the unified
 * notification centre (the same `NotificationCenter` used before), opened by the
 * header bell. It does not push the layout — it overlays from the left.
 */
export function NotificationSidebar({
  open,
  onClose,
  notifications,
}: {
  open: boolean;
  onClose: () => void;
  notifications?: NotificationCenterProps;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex justify-start bg-black/40 animate-orbit-fade-in"
      onClick={onClose}
    >
      <aside
        role="complementary"
        aria-label="Notifications"
        onClick={(e) => e.stopPropagation()}
        className="pointer-events-auto h-full w-[380px] max-w-[92vw] bg-[var(--color-glass)] backdrop-blur-xl border-r border-edge shadow-2xl flex flex-col animate-orbit-slide-left"
      >
        <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-edge shrink-0">
          <h2 className="text-base font-black tracking-tight text-retro-fg">Notifications</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close notifications"
            className="p-1.5 rounded-md text-retro-muted hover:text-retro-fg hover:bg-glass-w10 cursor-pointer transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 styled-scrollbar">
          <NotificationCenter
            {...(notifications ?? {
              onMarkAllRead: () => {},
              onMarkRead: () => {},
              onOpenTarget: () => {},
              onOpenLocalTarget: () => {},
              onMarkLocalRead: () => {},
            })}
          />
        </div>
      </aside>
    </div>
  );
}