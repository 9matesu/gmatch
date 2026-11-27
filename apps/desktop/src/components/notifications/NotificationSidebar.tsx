"use client";

import { X } from 'lucide-react';
import { NotificationCenter, type NotificationCenterProps } from './NotificationCenter';
import { CHROME, classes, COLOR, ICON, RECIPE, SHADOW } from '../../ui/tokens';

/**
 * Fixed left notification sidebar. A dedicated, animated space for the unified
 * notification centre (the same `NotificationCenter` used before), opened by the
 * header bell. It does not push the layout — it overlays from the left.
 *
 * Every surface/text role comes from ui/tokens: the scrim, the one glass panel
 * edge, the elevation, the title step and the icon-button recipe. No per-call
 * colour, size, radius, shadow or weight is re-inlined here.
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
      className={classes('fixed inset-0 z-[var(--z-modal)] flex justify-start', COLOR.scrimSoft, 'animate-orbit-fade-in')}
      onClick={onClose}
    >
      <aside
        role="complementary"
        aria-label="Notifications"
        onClick={(e) => e.stopPropagation()}
        className={classes(
          'pointer-events-auto h-full w-[380px] max-w-[92vw]',
          COLOR.panelGlass, 'backdrop-blur-xl border-r', COLOR.edge,
          SHADOW.sheet, 'flex flex-col animate-orbit-slide-in-left',
        )}
      >
        <div className={CHROME.barHeader}>
          <h2 className={RECIPE.dialogTitle}>Notifications</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close notifications"
            className={CHROME.iconButton}
          >
            <X className={ICON.md} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto styled-scrollbar">
          <NotificationCenter
            defaultOpen
            sidebar
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
