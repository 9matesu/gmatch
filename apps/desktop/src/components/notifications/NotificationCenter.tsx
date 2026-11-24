"use client";

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';
import { NotificationBell } from '../rare/notification-bell';
import { useToast, durationFor, type ToastMessage } from '../Toast';
import { useSettings } from '../../hooks/useSettings';
import { NotificationsPanel } from '../NotificationsPanel';
import type { NotificationItem, MatchInviteItem } from '../NotificationsPanel';
import type { AppNotification, NotificationTarget } from '../../utils/notifications';
import { useMediaqInstall } from '../../services/mediaqInstall';

function IconFor({ type }: { type: ToastMessage['type'] }) {
  const cls = 'w-3.5 h-3.5 shrink-0';
  if (type === 'success') return <CheckCircle2 className={`${cls} text-success-fg`} />;
  if (type === 'error') return <AlertCircle className={`${cls} text-danger-fg`} />;
  if (type === 'warning') return <AlertTriangle className={`${cls} text-warning-fg`} />;
  return <Info className={`${cls} text-retro-body`} />;
}

export interface NotificationCenterProps {
  /** Persistent server rows (likes, comments, replies, mentions, follows…). */
  notifications?: NotificationItem[];
  invites?: MatchInviteItem[];
  /** Courier-derived rows (DMs, sealed rooms). */
  localItems?: AppNotification[];
  /** Unified unread — derived from the merged items, never a second scalar. */
  unreadCount?: number;
  unreadByType?: Record<string, number>;
  /** Newest unread title, for the collapsed preview line. */
  latestTitle?: string;
  onMarkAllRead: () => void;
  onMarkRead: (ids: string[]) => void;
  onOpenTarget: (target: NotificationTarget) => void;
  onOpenLocalTarget: (item: AppNotification) => void;
  onMarkLocalRead: (keys: string[]) => void;
  onRespondInvite?: (inviteId: string, accept: boolean) => void;
  onRespondBabecock?: (inviteId: string, accept: boolean) => void;
  onOpenBabecock?: () => void;
}

/**
 * The ONE notification entry point (header).
 *
 * Collapsed: a bell, the unread badge and a preview line. Expanded: the
 * persistent inbox — the unified list (server rows + courier DMs/rooms) and
 * match invites, with transient toasts kept as a small "Recent" strip so a
 * failed action is still visible. The footer bell, the left rail dock and the
 * mobile duplicates were removed: this is where notifications live now.
 *
 * The badge is derived from the list by `useNotificationCenter`, so the number
 * on the bell and the rows behind it cannot disagree.
 */
export function NotificationCenter(props: NotificationCenterProps) {
  const {
    notifications = [],
    invites = [],
    localItems = [],
    unreadCount = 0,
    unreadByType = {},
    latestTitle,
    onMarkAllRead,
    onMarkRead,
    onOpenTarget,
    onOpenLocalTarget,
    onMarkLocalRead,
    onRespondInvite,
    onRespondBabecock,
    onOpenBabecock,
  } = props;

  const mediaq = useMediaqInstall();
  const { messages, dismiss, clearAll, overflowCount } = useToast();
  const [expanded, setExpanded] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const latestToast = messages.length ? messages[messages.length - 1] : null;
  const preview = latestTitle || latestToast?.text || "";

  // One store feeds every surface: the badge, the tray, the overlay and the
  // native toast. The main process decides what the OS shows with this count.
  const { settings } = useSettings();
  useEffect(() => {
    window.gmatch?.notifySync?.({
      count: unreadCount,
      title: latestTitle || "",
      body: preview || "",
      hideContent: !!settings.hideNotificationContent,
    });
  }, [unreadCount, latestTitle, preview, settings.hideNotificationContent]);

  // Auto-expire non-sticky toasts on the header's clock (single owner).
  useEffect(() => {
    const timers = messages
      .map((m) => {
        const ms = durationFor(m.type, m.sticky);
        if (ms === null) return null;
        return setTimeout(() => dismiss(m.id), ms);
      })
      .filter(Boolean) as ReturnType<typeof setTimeout>[];
    return () => { for (const t of timers) clearTimeout(t); };
  }, [messages, dismiss]);

  // Close the expanded panel on route change (hash) so stale context never lingers.
  useEffect(() => {
    if (!expanded) return;
    const close = () => { setExpanded(false); /* keep focus where the route put it */ };
    window.addEventListener('hashchange', close);
    return () => window.removeEventListener('hashchange', close);
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setExpanded(false); triggerRef.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  return (
    <div
      className="relative flex items-center"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      {/* RareUI notification bell: the swing-on-new + rolling count badge.
          Same toggle contract as before — data-notifications-toggle, the full
          aria-label and the Escape-focus ref all live on this button. */}
      <NotificationBell
        ref={triggerRef as never}
        count={unreadCount}
        max={99}
        size={32}
        color="red"
        data-notifications-toggle="true"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label={`Notifications${unreadCount > 0 ? `: ${unreadCount} unread` : ''}${preview ? `. ${preview}` : ''}. Activate to ${expanded ? 'collapse' : 'expand'}.`}
        title="Notifications"
        className="shrink-0 bg-glass-w8 text-retro-fg hover:bg-glass-w10"
      />
      {/* Dynamic only: the newest unread title. The permanent "Notifications"
          label is gone  it never changed, so it was chrome, not information. */}
      {preview && (
        <span aria-live="polite" className="min-w-0 truncate text-xs text-retro-fg/80 px-2">
          {preview}
        </span>
      )}

      {expanded && (
        <div
          role="region"
          aria-label="Notification centre"
          className="absolute left-1/2 -translate-x-1/2 top-full mt-1 w-[min(420px,92vw)] max-h-(--max-h-sheet) flex flex-col bg-retro-bg/95 border border-edge rounded-lg shadow-2xl backdrop-blur-md z-[var(--z-dropdown)] overflow-hidden"
        >
          {/* Active mediaq setup: the install survives the modal being closed
              ("Send to background"), so its progress lives here too. */}
          {mediaq.status !== 'idle' && (
            <div className="shrink-0 border-b border-edge p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-retro-fg">Media suite</span>
                <button
                  type="button"
                  onClick={() => mediaq.reset()}
                  aria-label="Dismiss media suite"
                  className="p-0.5 rounded text-retro-muted hover:text-retro-fg cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
              {mediaq.status === 'installing' && (
                <div className="mt-1.5 space-y-1">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-glass-w8">
                    {mediaq.percent !== null ? (
                      <div className="h-full rounded-full bg-retro-accent transition-[width] duration-300" style={{ width: `${mediaq.percent}%` }} />
                    ) : (
                      <div className="h-full w-1/3 animate-pulse rounded-full bg-retro-accent" />
                    )}
                  </div>
                  <div className="flex justify-between text-2xs text-retro-muted">
                    <span className="truncate">{mediaq.message || 'Installing…'}</span>
                    {mediaq.percent !== null && <span className="tabular-nums">{mediaq.percent}%</span>}
                  </div>
                </div>
              )}
              {mediaq.status === 'done' && <p className="mt-1 text-2xs text-success-fg">mediaq is ready</p>}
              {mediaq.status === 'error' && <p className="mt-1 text-2xs text-danger-fg">{mediaq.message}</p>}
              {mediaq.status === 'cancelled' && <p className="mt-1 text-2xs text-warning-fg">Cancelled</p>}
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => mediaq.openModal()}
                  className="glass-action px-2 py-0.5 rounded text-2xs cursor-pointer text-retro-muted hover:text-retro-fg"
                >
                  Show setup
                </button>
                {mediaq.status === 'installing' && (
                  <button
                    type="button"
                    onClick={() => mediaq.cancel()}
                    className="glass-action px-2 py-0.5 rounded text-2xs cursor-pointer text-danger-fg hover:bg-danger/20"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Transient toasts: an error stays until dismissed, so it needs a
              home inside the same surface rather than a floating overlay. */}
          {messages.length > 0 && (
            <div className="shrink-0 border-b border-edge">
              <div className="flex items-center justify-between px-3 py-1.5">
                <span className="text-2xs font-bold uppercase tracking-wide text-retro-muted">
                  Recent{overflowCount > 0 && <span className="font-normal"> · +{overflowCount} more</span>}
                </span>
                <button type="button" onClick={clearAll} className="text-xs text-retro-muted hover:text-retro-fg cursor-pointer">
                  Clear
                </button>
              </div>
              <ul className="max-h-28 overflow-y-auto styled-scrollbar divide-y divide-edge-subtle">
                {[...messages].reverse().map((m) => (
                  <li key={m.id} className="flex items-start gap-2 px-3 py-2">
                    <IconFor type={m.type} />
                    <span className="flex-1 min-w-0 text-xs text-retro-fg break-words">{m.text}</span>
                    <button
                      type="button"
                      onClick={() => dismiss(m.id)}
                      aria-label={`Dismiss: ${m.text}`}
                      className="p-0.5 rounded text-retro-muted hover:text-retro-fg cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex-1 min-h-0">
            <NotificationsPanel
              embedded
              notifications={notifications}
              unreadCount={unreadCount}
              unreadByType={unreadByType}
              invites={invites}
              localItems={localItems}
              onMarkAllRead={onMarkAllRead}
              onMarkRead={onMarkRead}
              onOpenTarget={onOpenTarget}
              onOpenLocalTarget={onOpenLocalTarget}
              onMarkLocalRead={onMarkLocalRead}
              onRespondInvite={onRespondInvite}
              onRespondBabecock={onRespondBabecock}
              onOpenBabecock={onOpenBabecock}
            />
          </div>
        </div>
      )}
    </div>
  );
}
