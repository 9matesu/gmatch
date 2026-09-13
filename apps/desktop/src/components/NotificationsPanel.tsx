"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Trophy,
  Gamepad2,
  Flame,
  MessageSquare,
  Bell,
  Check,
  LogIn,
  Heart,
  UserPlus,
  Sparkles,
  X,
} from "lucide-react";
import { groupNotifications, groupTitle, type NotifItem } from "../utils/groupNotifications";
import { playPress } from "../utils/sounds";

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body?: string | null;
  data?: any;
  read?: boolean;
  created_at: string;
}

export interface MatchInviteItem {
  id: string;
  inviter_id: string;
  status: string;
  inviter_name?: string | null;
  inviter_pfp_url?: string | null;
  created_at: string;
  expires_at: string;
}

export interface NotificationsPanelProps {
  notifications?: NotificationItem[];
  unreadCount?: number;
  invites?: MatchInviteItem[];
  onMarkAllRead: () => void;
  onRespondInvite?: (inviteId: string, accept: boolean) => void;
  onRespondBabecock?: (inviteId: string, accept: boolean) => void;
  onOpenBabecock?: () => void;
  embedded?: boolean;
  onClose?: () => void;
}

const TYPE_ICONS: Record<string, React.ReactNode> = {
  match_invite: <Gamepad2 className="w-4 h-4 text-emerald-400" />,
  match_result: <Trophy className="w-4 h-4 text-amber-400" />,
  pm: <MessageSquare className="w-4 h-4 text-cyan-400" />,
  babecock_invite: <Flame className="w-4 h-4 text-rose-400" />,
  babecock_start: <Flame className="w-4 h-4 text-rose-400" />,
  like: <Heart className="w-4 h-4 text-rose-500 fill-rose-500" />,
  comment: <MessageSquare className="w-4 h-4 text-sky-400" />,
  follow: <UserPlus className="w-4 h-4 text-purple-400" />,
  card_received: <Sparkles className="w-4 h-4 text-amber-300" />,
  system: <Bell className="w-4 h-4 text-retro-muted" />,
};

export function NotificationsPanel({
  notifications = [],
  unreadCount = 0,
  invites = [],
  onMarkAllRead,
  onRespondInvite,
  onRespondBabecock,
  onOpenBabecock,
  embedded = false,
  onClose,
}: NotificationsPanelProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const items = useMemo(
    () =>
      [...notifications]
        .filter((n) => n.id)
        .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")),
    [notifications]
  );
  // Instagram-style fold: "Rafael and 3 others liked your card" — pure view
  // logic; read-state plumbing stays as-is (mark-all), no per-group action.
  const groups = useMemo(() => groupNotifications(items as unknown as NotifItem[]), [items]);

  const openInvites = invites.filter((invite) => new Date(invite.expires_at).getTime() > now);

  return (
    <div className={`flex flex-col h-full min-h-0 overflow-hidden ${embedded ? 'bg-transparent' : 'solid-panel'}`}>
      <div className="px-3 py-2 border-b border-border-glass flex items-center justify-between shrink-0 bg-glass-w5">
        <span className="flex items-center gap-1.5 text-xs font-medium text-retro-fg">
          <Bell className="w-3.5 h-3.5" />
          Notifications
          {unreadCount > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold leading-none bg-retro-accent text-black tabular-nums">
              {unreadCount}
            </span>
          )}
        </span>
        <div className="flex items-center gap-1">
          {items.length > 0 && (
            <button
              type="button"
              onClick={() => {
                playPress(700);
                onMarkAllRead();
              }}
              className="glass-action px-2 py-0.5 rounded text-[11px] cursor-pointer text-retro-muted hover:text-retro-fg"
            >
              Mark all read
            </button>
          )}
          {onClose && (
            <button
              type="button"
              onClick={() => {
                playPress(700);
                onClose();
              }}
              aria-label="Close notifications"
              className="p-1 rounded-md hover:bg-glass-w8 text-retro-muted hover:text-retro-fg cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto styled-scrollbar p-2 space-y-1">
        {openInvites.length > 0 && (
          <div className="mb-2 space-y-1">
            <div className="px-3 py-1.5 text-xs font-medium text-retro-muted">
              Invites
            </div>
            {openInvites.map((inv) => {
              const secondsLeft = Math.max(0, Math.ceil((new Date(inv.expires_at).getTime() - now) / 1000));
              return (
                <div
                  key={inv.id}
                  className="glass-inset p-3 rounded-xl flex items-center gap-3"
                >
                  <div className="w-9 h-9 rounded-full overflow-hidden glass-field flex items-center justify-center text-xs font-medium shrink-0">
                    {inv.inviter_pfp_url ? (
                      <img
                        src={inv.inviter_pfp_url}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      (inv.inviter_name || "U").charAt(0).toUpperCase()
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-retro-fg truncate">
                      {inv.inviter_name?.trim() || 'Unknown User'}
                    </p>
                    <p className="text-xs text-retro-muted">
                      Challenged you to a duel · expires in {secondsLeft}s
                    </p>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => { onRespondInvite?.(inv.id, true); }}
                      className="glass-action glass-action-primary flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer"
                    >
                      <Check className="w-3 h-3" /> Accept
                    </button>
                    <button
                      type="button"
                      onClick={() => { onRespondInvite?.(inv.id, false); }}
                      className="glass-action px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer"
                    >
                      Decline
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {items.length === 0 && openInvites.length === 0 ? (
          <div className="py-12 text-center space-y-2">
            <Bell className="w-6 h-6 mx-auto text-retro-muted" />
            <p className="text-xs font-medium text-retro-body">No notifications</p>
            <p className="text-xs text-retro-muted">
              Match invites and results will appear here.
            </p>
          </div>
        ) : (
          groups.map((g) => {
            const n = g.items[0];
            const isBabecockInvite = n.type === "babecock_invite";
            const inviteId = typeof n.data === 'string' ? (() => { try { return JSON.parse(n.data)?.invite_id; } catch { return undefined; } })() : (n.data as { invite_id?: string })?.invite_id;
            const title = g.items.length > 1 ? groupTitle(g.type, g.actors) : n.title;
            return (
              <div
                key={g.key}
                className={`p-3 rounded-lg flex items-start gap-3 border ${
                  g.unread === 0
                    ? "border-border-glass bg-glass-w5"
                    : "glass-inset border-border-glass"
                }`}
              >
                <div className="w-8 h-8 rounded-full glass-inset flex items-center justify-center shrink-0">
                  {TYPE_ICONS[n.type] || <Bell className="w-4 h-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-retro-fg truncate">
                      {title}
                      {g.items.length > 1 && (
                        <span className="text-retro-muted"> · {g.items.length}</span>
                      )}
                    </p>
                    {g.unread > 0 && (
                      <span className="w-1.5 h-1.5 rounded-full bg-retro-accent shrink-0" />
                    )}
                  </div>
                  {n.body && (
                    <p className="text-xs text-retro-muted mt-0.5">
                      {n.body}
                    </p>
                  )}
                  {isBabecockInvite && inviteId && (
                    <div className="mt-2 flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          playPress(800);
                          onRespondBabecock?.(inviteId, true);
                          onOpenBabecock?.();
                        }}
                        className="glass-action glass-action-primary inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer"
                      >
                        <LogIn className="w-3 h-3" /> Accept &amp; join
                      </button>
                      <button
                        type="button"
                        onClick={() => { onRespondBabecock?.(inviteId, false); }}
                        className="px-2.5 py-1.5 rounded bg-surface-interactive border border-border-glass text-retro-body text-xs font-medium cursor-pointer"
                      >
                        Decline
                      </button>
                    </div>
                  )}
                  <time
                    className="mt-1 block text-[10px] text-retro-muted"
                    dateTime={n.created_at}
                  >
                    {new Date(n.created_at).toLocaleString([], {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </time>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
