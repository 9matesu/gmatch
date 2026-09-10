"use client";

import { useEffect, useRef, useState } from 'react';
import { playPress } from '../../utils/sounds';
import {
  readSidebarOrder,
  reconcileSidebarOrder,
  reorderSidebarIds,
  writeSidebarOrder,
} from '../../utils/sidebarOrder';
import {
  Home,
  Gamepad2,
  PlusSquare,
  Send,
  User,
  LayoutGrid,
  Settings,
  ShoppingBag,
  PanelLeftClose,
  PanelLeftOpen,
  Bell,
  Coins,
  Zap,
  Trophy,
  Monitor,
  Users,
  MousePointerClick,
  Swords,
  Layers,
  Flame,
  ChevronDown,
  ChevronRight,
  Server,
  ShieldCheck,
} from 'lucide-react';
import type { MainViewType } from './HomeFooter';

export type GamesNavTab = 'duel' | 'cards' | 'babecock' | 'ranks' | 'idle';

export interface ActiveHackSession {
  itemId: string;
  itemName: string;
  targetUserId: string;
  targetUserName: string;
  expiresAt: number;
}

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
  balance = 0,
  score = 0,
  reputation = 0,
  wsConnected = false,
  showRooms = false,
  gamesSubTab = 'duel',
  onOpenGamesTab,
  onlineBadge = 0,
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
  balance?: number;
  score?: number;
  reputation?: number;
  /** Live swarm-socket state — never silent: online / reconnecting always shows. */
  wsConnected?: boolean;
  /** SITE mode: blind-courier Rooms view is available. */
  showRooms?: boolean;
  /** Current Porn Games sub-tab (drives child highlight). */
  gamesSubTab?: string;
  /** Navigate into Porn Games on a specific sub-tab. */
  onOpenGamesTab?: (tab: GamesNavTab) => void;
  /** Online-players badge shown on the Porn Games group. */
  onlineBadge?: number;
}) {
  const [now, setNow] = useState(() => Date.now());
  // HOST installs expose the admin suite in the sidebar (plan T4). Dev/browser
  // builds have no bridge — the hash route #/admin still works there.
  const [isHost, setIsHost] = useState(false);
  useEffect(() => {
    let alive = true;
    window.gmatch?.serverState?.()
      .then((st) => { if (alive) setIsHost(st?.mode === 'host'); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try { return localStorage.getItem('goonmatch_sidebar_collapsed') === '1'; } catch { return false; }
  });
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem('goonmatch_sidebar_collapsed', next ? '1' : '0'); } catch { }
      return next;
    });
  };

  const [expandedGroups, setExpandedGroups] = useState<string[]>(() => {
    if (typeof window === 'undefined') return ['games'];
    try {
      const raw = localStorage.getItem('goonmatch_sidebar_groups');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.filter((g) => typeof g === 'string');
      }
    } catch { }
    return ['games'];
  });

  // Top-level nav order (plan §2). Global key, matching collapse/groups.
  const [order, setOrder] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [...readSidebarOrder(undefined)];
    return readSidebarOrder();
  });
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  // Guards against a navigation firing when a drag ends on the source entry.
  const justDragged = useRef(false);

  const commitOrder = (dragged: string, target: string) => {
    setOrder((prev) => {
      const next = reorderSidebarIds(prev, dragged, target);
      if (next !== prev) writeSidebarOrder(next);
      return next;
    });
  };

  const dragHandlers = (id: string) => ({
    onDragStart: (e: React.DragEvent) => {
      if (collapsed) { e.preventDefault(); return; }
      justDragged.current = true;
      setDragId(id);
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', id); } catch { /* Safari */ }
    },
    onDragEnter: () => {
      if (dragId && dragId !== id) setOverId(id);
    },
    onDragOver: (e: React.DragEvent) => {
      if (dragId && dragId !== id) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
    },
    onDrop: (e: React.DragEvent) => {
      if (!dragId || dragId === id) return;
      e.preventDefault();
      commitOrder(dragId, id);
      setDragId(null);
      setOverId(null);
    },
    onDragEnd: () => {
      setDragId(null);
      setOverId(null);
      window.setTimeout(() => { justDragged.current = false; }, 0);
    },
  });

  const navClickGuard = (fn: () => void) => () => {
    if (justDragged.current) return;
    fn();
  };

  const toggleGroup = (id: string) => {
    playPress(700);
    setExpandedGroups((prev) => {
      const next = prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id];
      try { localStorage.setItem('goonmatch_sidebar_groups', JSON.stringify(next)); } catch { }
      return next;
    });
  };

  interface NavLeaf {
    id: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    active: boolean;
    action: () => void;
    badge?: number;
    isHack?: boolean;
  }

  interface NavGroup {
    id: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    active: boolean;
    action: () => void;
    badge?: number;
    children: NavLeaf[];
  }

  type NavEntry = NavLeaf | NavGroup;
  const isGroup = (e: NavEntry): e is NavGroup => 'children' in e;

  const openGamesTab = (tab: GamesNavTab) => {
    if (onOpenGamesTab) onOpenGamesTab(tab);
    else setMainView?.('games');
  };

  const navItems: NavEntry[] = [
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
      active: mainView === 'games' || mainView === 'grid',
      action: () => openGamesTab('idle'),
      badge: onlineBadge,
      children: [
        ...(onOpenStore
          ? [
            {
              id: 'games-store',
              label: 'Store',
              icon: ShoppingBag,
              active: mainView === 'store',
              action: () => onOpenStore(),
            },
          ]
          : []),
        ...(onOpenGallery
          ? [
            {
              id: 'games-cards',
              label: 'Gallery & Cards',
              icon: LayoutGrid,
              active: mainView === 'gallery',
              action: () => onOpenGallery(),
            },
          ]
          : []),
        {
          id: 'games-play',
          label: 'Play',
          icon: Swords,
          active: mainView === 'games' && gamesSubTab === 'duel',
          action: () => openGamesTab('duel'),
        },
        {
          id: 'games-deck',
          label: 'Deck',
          icon: Layers,
          active: mainView === 'games' && gamesSubTab === 'cards',
          action: () => openGamesTab('cards'),
        },
        {
          id: 'games-idle',
          label: 'Idle Clicker',
          icon: MousePointerClick,
          active: (mainView === 'games' && gamesSubTab === 'idle') || mainView === 'grid',
          action: () => openGamesTab('idle'),
        },
        {
          id: 'games-babecock',
          label: 'Babecock',
          icon: Flame,
          active: mainView === 'games' && gamesSubTab === 'babecock',
          action: () => openGamesTab('babecock'),
        },
        {
          id: 'games-ranks',
          label: 'Rankings',
          icon: Trophy,
          active: mainView === 'games' && gamesSubTab === 'ranks',
          action: () => openGamesTab('ranks'),
        },
      ],
    },
    ...(showRooms
      ? [
        {
          id: 'rooms',
          label: 'Rooms',
          icon: Users,
          active: mainView === 'rooms',
          action: () => setMainView?.('rooms'),
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
    {
      id: 'servers',
      label: 'Servers',
      icon: Server,
      active: mainView === 'servers',
      action: () => setMainView?.('servers'),
    },
    {
      id: 'pc_domination',
      label: 'PC Domination',
      icon: Monitor,
      active: mainView === 'pc_domination',
      action: () => setMainView?.('pc_domination'),
      // Fused hacks: glow rose while a hack session is live (was Spy entry).
      isHack: Boolean(activeHack && activeHack.expiresAt > now),
    },
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
  ];

  // Reorder-aware view of the nav: saved order reconciled against what's
  // currently visible (conditional entries like Rooms/Settings slot gracefully).
  const byId = new Map<string, NavEntry>(navItems.map((n) => [n.id, n]));
  const orderedItems = reconcileSidebarOrder(order, navItems.map((n) => n.id))
    .map((id) => byId.get(id))
    .filter((n): n is NavEntry => Boolean(n));

  const dropIndicator = (id: string) =>
    overId === id && dragId && dragId !== id
      ? ' outline outline-1 -outline-offset-1 outline-zinc-500/70'
      : '';

  return (
    <aside className={`desktop-sidebar shrink-0 flex flex-col font-sans select-none h-full min-h-0 transition-[width] duration-200 bg-[color:var(--color-glass)] border-r border-zinc-800/80 ${collapsed ? 'w-[3.75rem]' : 'w-48'}`}>
      {/* Header: brand + collapse toggle */}
      <div className="flex items-center justify-between gap-1 px-3 py-3 border-b border-zinc-800/80 shrink-0">
        {!collapsed && (
          <button
            type="button"
            onClick={() => { playPress(700); onOpenHome?.(); }}
            aria-label="Go to gMatch home"
            className="text-sm font-bold text-zinc-100 tracking-tight leading-none hover:text-white transition-colors cursor-pointer"
          >
            gMatch
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

        {orderedItems.map((item) => {
          if (isGroup(item)) {
            const GroupIcon = item.icon;
            const expanded = expandedGroups.includes(item.id);
            return (
              <div key={item.id} className="space-y-0.5">
                <div
                  draggable={!collapsed}
                  {...dragHandlers(item.id)}
                  className={`w-full flex items-center gap-1 pl-3 pr-1.5 py-0.5 rounded-md border transition-all duration-150 ${collapsed ? 'justify-center px-0' : ''} ${item.active
                    ? 'bg-zinc-800/90 text-zinc-100 font-medium border-zinc-700/80 shadow-xs'
                    : 'bg-transparent text-zinc-400 border-transparent'
                    }${dropIndicator(item.id)}`}
                >
                  <button
                    type="button"
                    onClick={navClickGuard(() => { playPress(780); item.action(); if (!expanded) toggleGroup(item.id); })}
                    aria-label={item.label}
                    title={collapsed ? item.label : undefined}
                    className={`flex-1 min-w-0 flex items-center gap-2.5 py-1.5 rounded-md text-left cursor-pointer text-xs ${collapsed ? 'justify-center' : ''} ${item.active ? '' : 'hover:text-zinc-200'}`}
                  >
                    <GroupIcon className={`w-4 h-4 shrink-0 transition-colors stroke-[1.75] ${item.active ? 'text-zinc-100' : 'text-zinc-400'}`} />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                    {!collapsed && Boolean(item.badge && item.badge > 0) && (
                      <span className="ml-auto flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-emerald-400 text-[9px] font-bold text-zinc-950 tabular-nums">
                        {item.badge! > 99 ? '99+' : item.badge}
                      </span>
                    )}
                  </button>
                  {!collapsed && (
                    <button
                      type="button"
                      onClick={() => toggleGroup(item.id)}
                      aria-label={expanded ? `Collapse ${item.label}` : `Expand ${item.label}`}
                      aria-expanded={expanded}
                      className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors cursor-pointer shrink-0"
                    >
                      {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    </button>
                  )}
                </div>
                {expanded && !collapsed && (
                  <div className="ml-4 pl-2 border-l border-zinc-800/80 space-y-0.5">
                    {item.children.map((child) => {
                      const ChildIcon = child.icon;
                      return (
                        <button
                          key={child.id}
                          type="button"
                          onClick={() => { playPress(780); child.action(); }}
                          aria-label={child.label}
                          className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-left cursor-pointer border transition-all duration-150 active:scale-[0.96] group text-xs ${child.active
                            ? 'bg-zinc-800/90 text-zinc-100 font-medium border-zinc-700/80 shadow-xs'
                            : 'bg-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 border-transparent'
                            }`}
                        >
                          <ChildIcon className={`w-3.5 h-3.5 shrink-0 transition-colors stroke-[1.75] ${child.active ? 'text-zinc-100' : 'text-zinc-400 group-hover:text-zinc-200'}`} />
                          <span className="truncate">{child.label}</span>
                          {Boolean(child.badge && child.badge > 0) && (
                            <span className="ml-auto flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-zinc-100 text-[9px] font-bold text-zinc-950 tabular-nums">
                              {child.badge! > 9 ? '9+' : child.badge}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              draggable={!collapsed}
              {...dragHandlers(item.id)}
              onClick={navClickGuard(() => { playPress(item.isHack ? 800 : 780); item.action(); })}
              aria-label={item.label}
              title={collapsed ? item.label : undefined}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-left cursor-pointer border transition-all duration-150 active:scale-[0.96] group text-xs ${collapsed ? 'justify-center' : ''} ${item.isHack
                ? item.active
                  ? 'bg-rose-500/15 text-rose-300 border-rose-500/30 font-medium'
                  : 'bg-transparent text-rose-400/90 hover:text-rose-200 hover:bg-rose-500/10 border-transparent'
                : item.active
                  ? 'bg-zinc-800/90 text-zinc-100 font-medium border-zinc-700/80 shadow-xs'
                  : 'bg-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 border-transparent'
                }${dropIndicator(item.id)}`}
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

      {/* Admin entry (plan T4): this install HOSTS the server you're looking at,
          so you are its admin — moderation suite lives under the PIN gate. */}
      {isHost && (
        <div className="px-2 pb-1 shrink-0">
          <button
            type="button"
            onClick={() => { playPress(600); setMainView?.('admin'); }}
            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[11px] cursor-pointer transition-all active:scale-[0.96] border ${collapsed ? 'justify-center' : ''} ${mainView === 'admin' ? 'bg-amber-500/10 border-amber-500/30 text-amber-300' : 'border-zinc-800 text-zinc-500 hover:text-amber-300 hover:border-amber-500/20'}`}
            title="You host this server — open the admin suite"
            aria-label="Open the admin suite"
          >
            <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
            {!collapsed && <span>Admin</span>}
          </button>
        </div>
      )}

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
              <div className="text-[10px] text-zinc-400 flex items-center gap-1.5" role="status" aria-label={wsConnected ? 'Connected' : 'Reconnecting'} title={wsConnected ? 'Swarm connected' : 'Swarm reconnecting…'}>
                <span className={`w-1.5 h-1.5 rounded-full inline-block shrink-0 ${wsConnected ? 'bg-emerald-500' : 'bg-amber-400 animate-pulse'}`} />
                <span>{wsConnected ? 'Online' : 'Connecting…'}</span>
              </div>
            </div>
          )}
        </button>
      </div>

      {/* Currency HUD — g$ + a single lifetime XP tile (today's gain in the
          tooltip). Reputation and XP are one progression now (plan §3). */}
      <div className="px-2 pb-2 shrink-0">
        <div className={`flex gap-1.5 ${collapsed ? 'flex-col items-center' : 'flex-row'}`}>
          {[
            { icon: Coins, label: 'g$', value: balance, accent: 'text-amber-400', title: 'Balance (g$)' },
            { icon: Zap, label: 'XP', value: reputation, accent: 'text-sky-400', title: `${reputation.toLocaleString()} lifetime XP · +${score.toLocaleString()} today` },
          ].map((c) => {
            const Icon = c.icon;
            return (
              <div
                key={c.label}
                title={c.title}
                className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-zinc-900/60 border border-zinc-800/80 min-w-0 ${collapsed ? 'justify-center' : 'flex-1 justify-center'}`}
              >
                <Icon className={`w-3.5 h-3.5 shrink-0 ${c.accent} stroke-[1.75]`} />
                {!collapsed && (
                  <span className="text-[11px] font-semibold text-zinc-200 font-mono tabular-nums tracking-tight truncate">
                    {c.value.toLocaleString()}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
