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
import {
  classes, COLOR, FEEDBACK, GAP, ICON, MONO, PADDING, PADDING_X, PADDING_Y,
  RADIUS, SHADOW, STATUS, TRACKING, TYPE, WEIGHT,
} from '../../ui/tokens';

function IconFor({ type }: { type: ToastMessage['type'] }) {
  const cls = classes(ICON.sm, 'shrink-0');
  if (type === 'success') return <CheckCircle2 className={classes(cls, STATUS.success)} />;
  if (type === 'error') return <AlertCircle className={classes(cls, STATUS.danger)} />;
  if (type === 'warning') return <AlertTriangle className={classes(cls, STATUS.warning)} />;
  return <Info className={classes(cls, COLOR.body)} />;
}

export interface NotificationCenterProps {
  /** Persistent server rows (likes, comments, replies, mentions, follows…). */
  notifications?: NotificationItem[];
  invites?: MatchInviteItem[];
  /** Courier-derived rows (DMs, sealed rooms). */
  localItems?: AppNotification[];
  /** Peer-lane rows (reports/interactions about my content). */
  peerItems?: AppNotification[];
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
  /** Open the list by default (the left sidebar renders it expanded). */
  defaultOpen?: boolean;
  /** Rendered inside the left sidebar: no bell/preview, panel in-flow. */
  sidebar?: boolean;
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
 * on the bell and the rows behind it cannot disagree. Every surface here reads
 * a ui/tokens role: the popover surface, the progress bar, the status tints and
 * the two text steps — no per-call colour/size/weight.
 */
export function NotificationCenter(props: NotificationCenterProps) {
  const {
    notifications = [],
    invites = [],
    localItems = [],
    peerItems = [],
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
    defaultOpen = false,
    sidebar = false,
  } = props;

  const mediaq = useMediaqInstall();
  const { messages, dismiss, clearAll, overflowCount } = useToast();
  const [expanded, setExpanded] = useState(defaultOpen);
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

  const smallIconButton = classes(PADDING[0.5], 'cursor-pointer', RADIUS.chip, COLOR.muted, COLOR.hoverFg);

  return (
    <div
      className={sidebar ? 'relative flex w-full flex-col' : 'relative flex items-center'}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      {/* The sidebar supplies its own header, so the bell + preview are header-only. */}
      {!sidebar && (
        <>
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
            className={classes('shrink-0', COLOR.glassW8, COLOR.fg, COLOR.hoverW10)}
          />
          {preview && (
            <span aria-live="polite" className={classes('min-w-0 truncate px-2', TYPE.body, COLOR.fgSoft)}>
              {preview}
            </span>
          )}
        </>
      )}

      {expanded && (
        <div
          role="region"
          aria-label="Notification centre"
          className={sidebar
            ? 'relative flex w-full max-h-none flex-col overflow-visible'
            : classes(
              'absolute left-1/2 -translate-x-1/2 top-full mt-1 w-[min(420px,92vw)] max-h-(--max-h-sheet)',
              'flex flex-col backdrop-blur-md z-[var(--z-dropdown)] overflow-hidden',
              COLOR.canvasVeil, 'border', COLOR.edge, RADIUS.control, SHADOW.sheet,
            )}
        >
          {/* Active mediaq setup: the install survives the modal being closed
              ("Send to background"), so its progress lives here too. */}
          {mediaq.status !== 'idle' && (
            <div className={classes('shrink-0 border-b', COLOR.edge, PADDING[3])}>
              <div className={classes('flex items-center justify-between', GAP[2])}>
                <span className={classes(TYPE.body, WEIGHT.medium, COLOR.fg)}>Media suite</span>
                <button
                  type="button"
                  onClick={() => mediaq.reset()}
                  aria-label="Dismiss media suite"
                  className={smallIconButton}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
              {mediaq.status === 'installing' && (
                <div className="mt-1.5 space-y-1">
                  <div className={classes('h-1.5 w-full overflow-hidden', RADIUS.pill, COLOR.glassW8)}>
                    {mediaq.percent !== null ? (
                      <div className={classes('h-full transition-[width] duration-300', RADIUS.pill, COLOR.accentBg)} style={{ width: `${mediaq.percent}%` }} />
                    ) : (
                      <div className={classes('h-full w-1/3 animate-pulse', RADIUS.pill, COLOR.accentBg)} />
                    )}
                  </div>
                  <div className={classes('flex justify-between', TYPE.caption, COLOR.muted)}>
                    <span className="truncate">{mediaq.message || 'Installing…'}</span>
                    {mediaq.percent !== null && <span className={MONO}>{mediaq.percent}%</span>}
                  </div>
                </div>
              )}
              {mediaq.status === 'done' && <p className={classes('mt-1', TYPE.caption, STATUS.success)}>mediaq is ready</p>}
              {mediaq.status === 'error' && <p className={classes('mt-1', TYPE.caption, STATUS.danger)}>{mediaq.message}</p>}
              {mediaq.status === 'cancelled' && <p className={classes('mt-1', TYPE.caption, STATUS.warning)}>Cancelled</p>}
              <div className={classes('mt-2 flex', GAP[2])}>
                <button
                  type="button"
                  onClick={() => mediaq.openModal()}
                  className={classes('glass-action px-2 py-0.5 cursor-pointer', RADIUS.chip, TYPE.caption, COLOR.muted, COLOR.hoverFg)}
                >
                  Show setup
                </button>
                {mediaq.status === 'installing' && (
                  <button
                    type="button"
                    onClick={() => mediaq.cancel()}
                    className={classes('glass-action px-2 py-0.5 cursor-pointer', RADIUS.chip, TYPE.caption, STATUS.danger, STATUS.dangerTintHover)}
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
            <div className={classes('shrink-0 border-b', COLOR.edge)}>
              <div className={classes('flex items-center justify-between', PADDING_X[3], PADDING_Y[1.5])}>
                <span className={classes(TYPE.caption, WEIGHT.bold, 'uppercase', TRACKING.wide, COLOR.muted)}>
                  Recent{overflowCount > 0 && <span className={WEIGHT.regular}> · +{overflowCount} more</span>}
                </span>
                <button type="button" onClick={clearAll} className={classes(TYPE.body, COLOR.muted, COLOR.hoverFg, 'cursor-pointer')}>
                  Clear
                </button>
              </div>
              <ul className="max-h-28 overflow-y-auto styled-scrollbar divide-y divide-edge-subtle">
                {[...messages].reverse().map((m) => (
                  <li key={m.id} className={FEEDBACK.toastRow}>
                    <IconFor type={m.type} />
                    <span className={classes('flex-1 min-w-0 break-words', TYPE.body, COLOR.fg)}>{m.text}</span>
                    <button
                      type="button"
                      onClick={() => dismiss(m.id)}
                      aria-label={`Dismiss: ${m.text}`}
                      className={smallIconButton}
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
              peerItems={peerItems}
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
