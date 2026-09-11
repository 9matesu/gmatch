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
  Trophy,
  Monitor,
  MousePointerClick,
  Swords,
  Flame,
  ChevronDown,
  ChevronRight,
  Server,
  ShieldCheck,
  LogOut,
  ArrowLeft,
  ArrowRight,
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
  onLogout,
  onOpenStore,
  unreadMessagesCount = 0,
  notificationUnreadCount = 0,
  onOpenNotifications,
  notificationsOpen = false,
  profilePic,
  displayName = 'You',
  activeHack = null,
  balance: _balance = 0,
  wsConnected = false,
  showRooms = false,
  gamesSubTab = 'duel',
  gameBadges,
  onOpenGamesTab,
  onlineBadge = 0,
  isAdmin = false,
  onGroupToggle,
}: {
  mainView?: MainViewType;
  setMainView?: (view: MainViewType) => void;
  onOpenHome?: () => void;
  onOpenCreatePost?: () => void;
  onOpenGallery?: () => void;
  onOpenChat?: () => void;
  chatOpen?: boolean;
  onOpenSettings?: () => void;
  onLogout?: () => void;
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
  /** Per-game counters (waiting/in-match players, active rounds...). */
  gameBadges?: Partial<Record<GamesNavTab, number>>;
  /** Navigate into Porn Games on a specific sub-tab. */
  onOpenGamesTab?: (tab: GamesNavTab) => void;
  /** Online-players badge shown on the Porn Games group. */
  onlineBadge?: number;
  /** Connected-server admin flag (Users.is_admin) — shows the Admin entry. */
  isAdmin?: boolean;
  /** Close transient panels before expanding/collapsing a sidebar group. */
  onGroupToggle?: () => void;
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
  // Perf: the 1s clock exists ONLY for the hack-glow expiry check (isHack).
  // Ticking the whole sidebar nav once per second — forever — was a free
  // re-render budget nobody spent. Run it only while a session is active.
  useEffect(() => {
    if (!activeHack) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [activeHack]);

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
    onGroupToggle?.();
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
      active: mainView === 'games' || mainView === 'grid' || mainView === 'gallery',
      action: () => (onOpenGallery ? onOpenGallery() : openGamesTab('idle')),
      badge: onlineBadge,
      children: [
        {
          id: 'games-play',
          label: 'Play Cards',
          icon: Swords,
          active: mainView === 'games' && gamesSubTab === 'duel',
          action: () => openGamesTab('duel'),
          badge: gameBadges?.duel,
        },
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
          id: 'games-idle',
          label: 'Idle Clicker',
          icon: MousePointerClick,
          active: (mainView === 'games' && gamesSubTab === 'idle') || mainView === 'grid',
          action: () => openGamesTab('idle'),
        },
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
        {
          id: 'games-babecock',
          label: 'Babecock',
          icon: Flame,
          active: mainView === 'games' && gamesSubTab === 'babecock',
          action: () => openGamesTab('babecock'),
          badge: gameBadges?.babecock,
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
      active: mainView === 'servers' || (showRooms && mainView === 'rooms'),
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
      ? ' outline outline-1 -outline-offset-1 outline-border-strong'
      : '';

  return (
    <aside className={`desktop-sidebar glass-sidebar shrink-0 flex flex-col font-sans select-none h-full min-h-0 transition-[width] duration-150 ${collapsed ? 'w-[3.75rem]' : 'w-48'}`}>
      {/* Header: brand + collapse toggle */}
      <div className="flex items-center justify-between gap-1 px-3 py-3 border-b border-white/10 shrink-0">
        {collapsed ? (
          // Collapsed rail is 60px: three history buttons + padding overflow it
          // and the expand toggle lands outside the visible box (dead click).
          // In rail mode only the toggle is rendered, centered.
          <button
            type="button"
            onClick={() => { playPress(700); toggleCollapsed(); }}
            aria-label="Expand sidebar"
            title="Expand sidebar"
            className="icon-btn p-1.5 mx-auto"
          >
            <PanelLeftOpen className="w-4 h-4" />
          </button>
        ) : (<>
        {!collapsed && (
          <button
            type="button"
            onClick={() => { playPress(700); onOpenHome?.(); }}
            aria-label="Go to gMatch home"
            className="text-sm font-bold text-retro-fg tracking-tight leading-none hover:text-white transition-colors cursor-pointer"
          >
            gMatch
          </button>
        )}
        {/* Browser-style history nav (ponytail: window.history IS the feature). */}
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => { playPress(700); window.history.back(); }}
            aria-label="Back"
            title="Back"
            className="icon-btn p-1.5"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => { playPress(700); window.history.forward(); }}
            aria-label="Forward"
            title="Forward"
            className="icon-btn p-1.5"
          >
            <ArrowRight className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => { playPress(700); toggleCollapsed(); }}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="icon-btn p-1.5"
          >
            {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
        </div>
        </>)}
      </div>

      <nav className="flex-1 min-h-0 overflow-y-auto styled-scrollbar p-2 space-y-1">
        {/* Create — pinned to top with highlighted accent, active scale */}
        <button
          type="button"
          onClick={() => { playPress(920); if (onOpenCreatePost) onOpenCreatePost(); else setMainView?.('create'); }}
          aria-label="Create post"
          title="Create post"
          className={`create-action sidebar-create w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-left cursor-pointer transition-all duration-150 active:scale-[0.96] group mb-2 ${collapsed ? 'justify-center' : ''}`}
        >
          <PlusSquare className="w-4 h-4 shrink-0 text-current stroke-[2]" />
          {!collapsed && (
            <span className="w-full text-xs font-semibold tracking-wide">Create post</span>
          )}
        </button>

        <div className="border-t border-white/10 my-1" />

        {orderedItems.map((item) => {
          if (isGroup(item)) {
            const GroupIcon = item.icon;
            const expanded = expandedGroups.includes(item.id);
            return (
              <div key={item.id} className="space-y-0.5">
                <div
                  draggable={!collapsed}
                  {...dragHandlers(item.id)}
                  className={`glass-nav-item ${item.active ? 'glass-nav-active' : ''} w-full flex items-center gap-1 py-0.5 rounded-md border transition-all duration-150 ${collapsed ? 'justify-center px-0' : 'pl-3 pr-1.5'}${dropIndicator(item.id)}`}
                >
                  <button
                    type="button"
                    onClick={navClickGuard(() => {
                      playPress(780);
                      if (expanded) {
                        toggleGroup(item.id);
                      } else {
                        item.action();
                        toggleGroup(item.id);
                      }
                    })}
                    aria-label={item.label}
                    title={collapsed ? item.label : undefined}
                    className={`flex-1 min-w-0 flex items-center gap-2.5 py-1.5 rounded-md text-left cursor-pointer text-xs ${collapsed ? 'justify-center' : ''}`}
                  >
                    <GroupIcon className="w-4 h-4 shrink-0 opacity-85 stroke-[1.75]" />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                    {!collapsed && Boolean(item.badge && item.badge > 0) && (
                      <span className="ml-auto flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-retro-fg text-[10px] font-bold text-retro-bg tabular-nums">
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
                      className="p-1.5 rounded-md text-retro-muted hover:text-retro-fg hover:bg-glass-w10 transition-colors cursor-pointer shrink-0"
                    >
                      {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    </button>
                  )}
                </div>
                {expanded && !collapsed && (
                  <div className="ml-4 pl-2 border-l border-white/10 space-y-0.5">
                    {item.children.map((child) => {
                      const ChildIcon = child.icon;
                      return (
                        <button
                          key={child.id}
                          type="button"
                          onClick={() => { playPress(780); child.action(); }}
                          aria-label={child.label}
                          className={`glass-nav-item ${child.active ? 'glass-nav-active' : ''} w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-left cursor-pointer border transition-all duration-150 active:scale-[0.96] group text-xs`}
                        >
                          <ChildIcon className="w-3.5 h-3.5 shrink-0 opacity-85 stroke-[1.75]" />
                          <span className="truncate">{child.label}</span>
                          {Boolean(child.badge && child.badge > 0) && (
                            <span className="ml-auto flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-retro-fg text-[10px] font-bold text-retro-bg tabular-nums">
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
              className={`glass-nav-item ${item.active ? 'glass-nav-active' : ''} ${item.isHack ? 'border-rose-500/25 text-rose-200 hover:text-rose-100' : ''} w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-left cursor-pointer border transition-all duration-150 active:scale-[0.96] group text-xs ${collapsed ? 'justify-center' : ''}${dropIndicator(item.id)}`}
            >
              <Icon className={`w-4 h-4 shrink-0 stroke-[1.75] ${item.isHack ? 'text-rose-300' : 'opacity-85'}`} />

              {!collapsed && (
                <span className="truncate">
                  {item.label}
                </span>
              )}

              {!collapsed && Boolean(item.badge && item.badge > 0) && (
                <span className="ml-auto flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-retro-fg text-[10px] font-bold text-retro-bg tabular-nums">
                  {item.badge! > 9 ? '9+' : item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Admin entry (plan T4): shown when this install HOSTS the server or
          when the connected server flags the account admin (Users.is_admin). */}
      {(isHost || isAdmin) && (
        <div className="px-2 pb-1 shrink-0">
          <button
            type="button"
            onClick={() => { playPress(600); setMainView?.('admin'); }}
            className={`glass-action ${mainView === 'admin' ? 'glass-nav-active text-amber-200 border-amber-300/30' : ''} w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs cursor-pointer transition-all active:scale-[0.96] border ${collapsed ? 'justify-center' : ''}`}
            title="Open Admin Panel"
            aria-label="Open Admin Panel"
          >
            <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
            {!collapsed && <span>Open Admin Panel</span>}
          </button>
        </div>
      )}

      {/* User panel: avatar + name, click to open profile */}
      <div className="p-2 border-t border-white/10 shrink-0">
        <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => { playPress(800); setMainView?.('profile'); }}
          className={`glass-nav-item ${mainView === 'profile' ? 'glass-nav-active' : ''} flex-1 min-w-0 flex items-center gap-2.5 px-2 py-1.5 rounded-md text-left cursor-pointer transition-all duration-150 active:scale-[0.96] border ${collapsed ? 'justify-center' : ''}`}
          aria-label="Open your profile"
        >
          <div className="w-7 h-7 rounded-full overflow-hidden flex items-center justify-center text-xs font-medium border shrink-0 bg-glass-w5 border-white/10 text-retro-fg">
            {profilePic ? (
              <img src={profilePic} alt="" className="w-full h-full object-cover" />
            ) : (
              <User className="w-3.5 h-3.5 text-current" />
            )}
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium truncate text-retro-fg">
                {displayName || 'You'}
              </div>
              <div className="text-[10px] text-retro-muted flex items-center gap-1.5" role="status" aria-label={wsConnected ? 'Connected' : 'Reconnecting'} title={wsConnected ? 'Swarm connected' : 'Swarm reconnecting…'}>
                <span className={`w-1.5 h-1.5 rounded-full inline-block shrink-0 ${wsConnected ? 'bg-emerald-500' : 'bg-amber-400 animate-pulse'}`} />
                <span>{wsConnected ? 'Online' : 'Connecting…'}</span>
              </div>
            </div>
          )}
        </button>
        {onLogout && !collapsed && (
          <button
            type="button"
            onClick={onLogout}
            aria-label="Log out"
            title="Log out"
            className="p-1.5 rounded-md hover:bg-glass-w10 text-retro-muted hover:text-retro-fg cursor-pointer shrink-0"
          >
            <LogOut className="w-3.5 h-3.5" strokeWidth={1.75} />
          </button>
        )}
        </div>
      </div>

    </aside>
  );
}
