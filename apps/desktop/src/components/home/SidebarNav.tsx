"use client";

import { useEffect, useState } from 'react';
import { playPress } from '../../utils/sounds';
import {
  Home,
  Gamepad2,
  PlusSquare,
  Send,
  User,
  Skull,
  Flame,
  ShieldAlert,
  LayoutGrid,
  Settings,
  ShoppingBag,
  PanelLeftClose,
  PanelLeftOpen,
  Bell,
  Coins,
  Zap,
  Trophy,
  MessageCircle,
  Coffee,
  Monitor,
  MousePointerClick,
} from 'lucide-react';
import type { MainViewType } from './HomeFooter';
import { getApiBaseUrl } from '../../utils/api';

export interface ActiveHackSession {
  itemId: string;
  itemName: string;
  targetUserId: string;
  targetUserName: string;
  expiresAt: number;
}

const DEFAULT_DISCORD_URL = 'https://discord.gg/WMEz9jgr3';

export function SidebarNav({
  mainView = 'feed',
  setMainView,
  onOpenHome,
  onOpenCreatePost,
  onOpenGallery,
  onOpenChat,
  chatOpen = false,
  onOpenSettings,
  onOpenStore,
  unreadMessagesCount = 0,
  notificationUnreadCount = 0,
  onOpenNotifications,
  notificationsOpen = false,
  profilePic,
  displayName = 'You',
  activeHack = null,
  onOpenHackView,
  balance = 0,
  score = 0,
  reputation = 0,
}: {
  mainView?: MainViewType;
  setMainView?: (view: MainViewType) => void;
  onOpenHome?: () => void;
  onOpenCreatePost?: () => void;
  onOpenGallery?: () => void;
  onOpenChat?: () => void;
  chatOpen?: boolean;
  onOpenSettings?: () => void;
  onOpenStore?: () => void;
  unreadMessagesCount?: number;
  notificationUnreadCount?: number;
  onOpenNotifications?: () => void;
  notificationsOpen?: boolean;
  profilePic?: string;
  displayName?: string;
  activeHack?: ActiveHackSession | null;
  onOpenHackView?: () => void;
  balance?: number;
  score?: number;
  reputation?: number;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [discordUrl, setDiscordUrl] = useState<string | null>(DEFAULT_DISCORD_URL);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try { return localStorage.getItem('goonmatch_sidebar_collapsed') === '1'; } catch { return false; }
  });
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    let cancelled = false;
    fetch(`${getApiBaseUrl()}/api/discord-invite`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled && d?.url) setDiscordUrl(d.url); })
      .catch(() => { if (!cancelled) setDiscordUrl(DEFAULT_DISCORD_URL); });
    return () => { cancelled = true; };
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem('goonmatch_sidebar_collapsed', next ? '1' : '0'); } catch { }
      return next;
    });
  };

  const getHackIcon = () => {
    if (!activeHack) return ShieldAlert;
    if (activeHack.itemId.includes('takeover')) return Skull;
    if (activeHack.itemId.includes('mobile')) return Flame;
    return ShieldAlert;
  };

  const HackIcon = getHackIcon();

  const navItems = [
    {
      id: 'feed',
      label: 'Home',
      icon: Home,
      active: mainView === 'feed',
      action: () => setMainView?.('feed'),
    },
    {
      id: 'games',
      label: 'Porn Games',
      icon: Gamepad2,
      active: mainView === 'games',
      action: () => setMainView?.('games'),
    },
    {
      id: 'grid',
      label: 'IDLE CLICKER',
      icon: MousePointerClick,
      active: mainView === 'grid',
      action: () => setMainView?.('grid'),
    },
    ...(onOpenStore
      ? [
        {
          id: 'store',
          label: 'Store',
          icon: ShoppingBag,
          active: mainView === 'store',
          action: () => (onOpenStore ? onOpenStore() : setMainView?.('store')),
        },
      ]
      : []),
    {
      id: 'messages',
      label: 'Messages',
      icon: Send,
      active: chatOpen || mainView === 'messages',
      action: () => (onOpenChat ? onOpenChat() : setMainView?.('messages')),
      badge: unreadMessagesCount,
    },
    ...(onOpenNotifications
      ? [
        {
          id: 'notifications',
          label: 'Notifications',
          icon: Bell,
          active: notificationsOpen,
          action: () => onOpenNotifications(),
          badge: notificationUnreadCount,
        },
      ]
      : []),
    ...(onOpenGallery
      ? [
        {
          id: 'gallery',
          label: 'Cards',
          icon: LayoutGrid,
          active: mainView === 'gallery',
          action: () => onOpenGallery(),
        },
      ]
      : []),
    ...(onOpenSettings
      ? [
        {
          id: 'settings',
          label: 'Settings',
          icon: Settings,
          active: false,
          action: () => onOpenSettings(),
        },
      ]
      : []),
    {
      id: 'pc_domination',
      label: 'PC Domination',
      icon: Monitor,
      active: mainView === 'pc_domination',
      action: () => setMainView?.('pc_domination'),
    },
    ...(activeHack && activeHack.expiresAt > now
      ? [
        {
          id: 'hack_spy',
          label: 'Spy',
          icon: HackIcon,
          active: mainView === 'hack_spy',
          action: () => (onOpenHackView ? onOpenHackView() : setMainView?.('hack_spy')),
          isHack: true,
        },
      ]
      : []),
  ];

  return (
    <aside className={`desktop-sidebar shrink-0 flex flex-col font-sans select-none h-full min-h-0 transition-[width] duration-200 bg-[#09090b] border-r border-zinc-800/80 ${collapsed ? 'w-[3.75rem]' : 'w-48'}`}>
      {/* Header: brand + collapse toggle */}
      <div className="flex items-center justify-between gap-1 px-3 py-3 border-b border-zinc-800/80 shrink-0">
        {!collapsed && (
          <button
            type="button"
            onClick={() => { playPress(700); onOpenHome?.(); }}
            aria-label="Go to goonMatch home"
            className="text-sm font-bold text-zinc-100 tracking-tight leading-none hover:text-white transition-colors cursor-pointer"
          >
            goonMatch
          </button>
        )}
        <button
          type="button"
          onClick={() => { playPress(700); toggleCollapsed(); }}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60 transition-colors cursor-pointer ml-auto"
        >
          {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
        </button>
      </div>

      <nav className="flex-1 min-h-0 overflow-y-auto styled-scrollbar p-2 space-y-1">
        {/* Create — pinned to top with highlighted accent, active scale */}
        <button
          type="button"
          onClick={() => { playPress(920); if (onOpenCreatePost) onOpenCreatePost(); else setMainView?.('create'); }}
          aria-label="Create"
          title="Create"
          className={`create-action sidebar-create w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-left cursor-pointer transition-all duration-150 active:scale-[0.96] group mb-2 ${collapsed ? 'justify-center' : ''}`}
        >
          <PlusSquare className="w-4 h-4 shrink-0 text-current stroke-[2]" />
          {!collapsed && (
            <span className="flex items-center justify-between gap-2 w-full text-xs font-semibold tracking-wide">
              <span>Create</span>
              <span className="text-[9px] font-normal normal-case opacity-75">post</span>
            </span>
          )}
        </button>

        <div className="border-t border-zinc-800/60 my-1" />

        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => { playPress(item.isHack ? 800 : 780); item.action(); }}
              aria-label={item.label}
              title={collapsed ? item.label : undefined}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-left cursor-pointer border transition-all duration-150 active:scale-[0.96] group text-xs ${collapsed ? 'justify-center' : ''} ${item.isHack
                ? item.active
                  ? 'bg-rose-500/15 text-rose-300 border-rose-500/30 font-medium'
                  : 'bg-transparent text-rose-400/90 hover:text-rose-200 hover:bg-rose-500/10 border-transparent'
                : item.active
                  ? 'bg-zinc-800/90 text-zinc-100 font-medium border-zinc-700/80 shadow-xs'
                  : 'bg-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 border-transparent'
                }`}
            >
              <Icon className={`w-4 h-4 shrink-0 transition-colors stroke-[1.75] ${item.isHack
                ? 'text-rose-400'
                : item.active
                  ? 'text-zinc-100'
                  : 'text-zinc-400 group-hover:text-zinc-200'
                }`} />

              {!collapsed && (
                <span className="truncate">
                  {item.label}
                </span>
              )}

              {!collapsed && Boolean(item.badge && item.badge > 0) && (
                <span className="ml-auto flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-zinc-100 text-[9px] font-bold text-zinc-950 tabular-nums">
                  {item.badge! > 9 ? '9+' : item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Community / Support buttons above currencies */}
      <div className="px-2 pt-2 pb-1 shrink-0">
        <div className={`flex flex-col gap-1 ${collapsed ? 'items-center' : ''}`}>
          {discordUrl && (
            <a
              href={discordUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => playPress(920)}
              aria-label="Join Discord"
              title={collapsed ? 'Discord' : undefined}
              className={`flex items-center gap-2.5 px-3 py-1.5 rounded-md cursor-pointer transition-all duration-150 active:scale-[0.96] border border-transparent hover:border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 group text-xs ${collapsed ? 'justify-center' : ''}`}
            >
              <MessageCircle className="w-4 h-4 shrink-0 text-indigo-400 group-hover:text-indigo-300 transition-colors stroke-[1.75]" />
              {!collapsed && (
                <span className="font-medium transition-colors">Discord</span>
              )}
            </a>
          )}
          <a
            href="https://buymeacoffee.com/stacksondeck"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => playPress(920)}
            aria-label="Support Me (Buy Me a Coffee)"
            title={collapsed ? 'Support' : undefined}
            className={`flex items-center gap-2.5 px-3 py-1.5 rounded-md cursor-pointer transition-all duration-150 active:scale-[0.96] border border-transparent hover:border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 group text-xs ${collapsed ? 'justify-center' : ''}`}
          >
            <Coffee className="w-4 h-4 shrink-0 text-amber-400 group-hover:text-amber-300 transition-colors stroke-[1.75]" />
            {!collapsed && (
              <span className="font-medium transition-colors">Support</span>
            )}
          </a>
        </div>
      </div>

      {/* Currency HUD */}
      <div className="px-2 pt-2 border-t border-zinc-800/80 shrink-0">
        <div className={`flex flex-col gap-1 ${collapsed ? 'items-center' : ''}`}>
          {[
            { icon: Coins, label: 'g$', value: balance, accent: 'text-amber-400' },
            { icon: Zap, label: 'XP', value: score, accent: 'text-sky-400' },
            { icon: Trophy, label: 'Rep', value: reputation, accent: 'text-violet-400' },
          ].map((c) => {
            const Icon = c.icon;
            return (
              <div
                key={c.label}
                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-zinc-900/60 border border-zinc-800/80 ${collapsed ? 'justify-center' : ''}`}
                title={c.label}
              >
                <Icon className={`w-3.5 h-3.5 shrink-0 ${c.accent} stroke-[1.75]`} />
                {!collapsed && (
                  <>
                    <span className="text-[10px] font-medium text-zinc-400">{c.label}</span>
                    <span className="ml-auto text-[11px] font-semibold text-zinc-200 font-mono tabular-nums tracking-tight">
                      {c.value.toLocaleString()}
                    </span>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* User panel: avatar + name, click to open profile */}
      <div className="p-2 border-t border-zinc-800/80 shrink-0">
        <button
          type="button"
          onClick={() => { playPress(800); setMainView?.('profile'); }}
          className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-left cursor-pointer transition-all duration-150 active:scale-[0.96] border ${collapsed ? 'justify-center' : ''} ${mainView === 'profile'
            ? 'bg-zinc-800/90 border-zinc-700 text-zinc-100'
            : 'border-transparent hover:bg-zinc-800/50 text-zinc-300'
            }`}
          aria-label="Open your profile"
        >
          <div className="w-7 h-7 rounded-full overflow-hidden flex items-center justify-center text-xs font-medium border shrink-0 bg-zinc-800 border-zinc-700 text-zinc-300">
            {profilePic ? (
              <img src={profilePic} alt="" className="w-full h-full object-cover" />
            ) : (
              <User className="w-3.5 h-3.5 text-current" />
            )}
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className={`text-xs font-medium truncate ${mainView === 'profile' ? 'text-zinc-100 font-semibold' : 'text-zinc-200'}`}>
                {displayName || 'You'}
              </div>
              <div className="text-[10px] text-zinc-400 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                <span>Online</span>
              </div>
            </div>
          )}
        </button>
      </div>
    </aside>
  );
}
