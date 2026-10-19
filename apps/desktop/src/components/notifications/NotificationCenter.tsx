"use client";

import { useEffect, useRef, useState } from 'react';
import { Bell, CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';
import { useToast, durationFor, type ToastMessage } from '../Toast';
import { NotificationsPanel } from '../NotificationsPanel';
import type { NotificationItem, MatchInviteItem } from '../NotificationsPanel';
import type { AppNotification, NotificationTarget } from '../../utils/notifications';

function IconFor({ type }: { type: ToastMessage['type'] }) {
  const cls = 'w-3.5 h-3.5 shrink-0';
  if (type === 'success') return <CheckCircle2 className={`${cls} text-emerald-400`} />;
  if (type === 'error') return <AlertCircle className={`${cls} text-red-400`} />;
  if (type === 'warning') return <AlertTriangle className={`${cls} text-amber-400`} />;
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

  const { messages, dismiss, clearAll, overflowCount } = useToast();
  const [expanded, setExpanded] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const latestToast = messages.length ? messages[messages.length - 1] : null;
  const preview = latestTitle || latestToast?.text || 'All quiet';

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
      className="relative shrink-0 sm:flex-1 sm:min-w-0 max-w-md flex items-center"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <button
        ref={triggerRef}
        type="button"
        data-notifications-toggle="true"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label={`Notifications${unreadCount > 0 ? `: ${unreadCount} unread` : ''}. ${preview}. Activate to ${expanded ? 'collapse' : 'expand'}.`}
        className="w-full flex items-center gap-2 px-2.5 py-1 rounded-md hover:bg-glass-w10 text-left cursor-pointer transition-colors"
      >
        <span className="relative shrink-0">
          <Bell className="w-3.5 h-3.5 text-retro-muted" />
          {unreadCount > 0 && (
            <span aria-hidden className="absolute -top-1 -right-1 min-w-3.5 h-3.5 px-0.5 rounded-full bg-retro-accent text-black text-[9px] font-bold flex items-center justify-center tabular-nums">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </span>
        <span aria-live="polite" className="min-w-0 flex-1 truncate text-[11px] text-retro-muted hidden sm:block">
          {preview}
        </span>
      </button>

      {expanded && (
        <div
          role="region"
          aria-label="Notification centre"
          className="absolute left-1/2 -translate-x-1/2 top-full mt-1 w-[min(420px,92vw)] max-h-[70vh] flex flex-col bg-retro-bg/95 border border-border-glass rounded-lg shadow-2xl backdrop-blur-md z-[var(--z-dropdown)] overflow-hidden"
        >
          {/* Transient toasts: an error stays until dismissed, so it needs a
              home inside the same surface rather than a floating overlay. */}
          {messages.length > 0 && (
            <div className="shrink-0 border-b border-border-glass">
              <div className="flex items-center justify-between px-3 py-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wide text-retro-muted">
                  Recent{overflowCount > 0 && <span className="font-normal"> · +{overflowCount} more</span>}
                </span>
                <button type="button" onClick={clearAll} className="text-[11px] text-retro-muted hover:text-retro-fg cursor-pointer">
                  Clear
                </button>
              </div>
              <ul className="max-h-28 overflow-y-auto styled-scrollbar divide-y divide-border-subtle">
                {[...messages].reverse().map((m) => (
                  <li key={m.id} className="flex items-start gap-2 px-3 py-2">
                    <IconFor type={m.type} />
                    <span className="flex-1 min-w-0 text-[11px] text-retro-fg break-words">{m.text}</span>
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
