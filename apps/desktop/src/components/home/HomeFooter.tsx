"use client";

import { useState } from 'react';
import { playPress } from '../../utils/sounds';
import {
  Home,
  Gamepad2,
  PlusSquare,
  Send,
  User,
  ShoppingBag,
  Bell,
  Ellipsis,
  LayoutGrid,
  Settings,
  Users,
  Monitor,
} from 'lucide-react';

export type MainViewType = 'feed' | 'games' | 'create' | 'messages' | 'profile' | 'game' | 'gallery' | 'store' | 'pc_domination' | 'grid' | 'rooms' | 'servers' | 'admin';

export interface ActiveHackSession {
  itemId: string;
  itemName: string;
  targetUserId: string;
  targetUserName: string;
  expiresAt: number;
}

export function HomeFooter({
  mainView = 'feed',
  setMainView,
  onOpenCreatePost,
  onOpenStore,
  onOpenNotifications,
  unreadMessagesCount = 0,
  unreadNotificationsCount = 0,
  profilePic,
  onOpenGallery,
  onOpenSettings,
  onOpenPlayers,
}: {
  mainView?: MainViewType;
  setMainView?: (view: MainViewType) => void;
  onOpenCreatePost?: () => void;
  onOpenStore?: () => void;
  onOpenNotifications?: () => void;
  unreadMessagesCount?: number;
  unreadNotificationsCount?: number;
  profilePic?: string;
  onOpenGallery?: () => void;
  onOpenSettings?: () => void;
  onOpenPlayers?: () => void;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const handleAction = (cb?: () => void, freq: number = 800) => {
    playPress(freq);
    cb?.();
  };

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
      label: 'Games',
      icon: Gamepad2,
      active: mainView === 'games',
      action: () => setMainView?.('games'),
    },
    {
      id: 'create',
      label: 'Create',
      icon: PlusSquare,
      active: false,
      action: () => (onOpenCreatePost ? onOpenCreatePost() : setMainView?.('create')),
      highlight: true,
    },
    {
      id: 'messages',
      label: 'Messages',
      icon: Send,
      active: mainView === 'messages',
      action: () => setMainView?.('messages'),
      badge: unreadMessagesCount,
    },
    {
      id: 'profile',
      label: 'Profile',
      icon: User,
      active: mainView === 'profile',
      action: () => setMainView?.('profile'),
      isAvatar: Boolean(profilePic),
    },
    {
      id: 'more',
      label: 'More',
      icon: Ellipsis,
      active: moreOpen,
      action: () => setMoreOpen(true),
    },
  ];

interface FooterSecondaryItem {
    id: string;
    label: string;
    icon: React.ElementType;
    action: () => void;
    badge?: number;
  }

  const secondaryItems: FooterSecondaryItem[] = [];
  if (onOpenStore) secondaryItems.push({ id: 'store', label: 'Store', icon: ShoppingBag, action: onOpenStore });
  if (onOpenGallery) secondaryItems.push({ id: 'gallery', label: 'Cards', icon: LayoutGrid, action: onOpenGallery });
  if (onOpenNotifications) secondaryItems.push({ id: 'alerts', label: 'Alerts', icon: Bell, action: onOpenNotifications, badge: unreadNotificationsCount });
  if (onOpenPlayers) secondaryItems.push({ id: 'players', label: 'Players', icon: Users, action: onOpenPlayers });
  secondaryItems.push({ id: 'pc_domination', label: 'PC Domination', icon: Monitor, action: () => setMainView?.('pc_domination') });
  if (onOpenSettings) secondaryItems.push({ id: 'settings', label: 'Settings', icon: Settings, action: onOpenSettings });

  return (
     <footer className="relative shrink-0 w-full glass-surface border-0 border-t border-border-glass rounded-none px-2 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] flex items-center justify-center font-sans select-none z-30">
      {moreOpen && (
        <>
          <button type="button" aria-label="Close more menu" onClick={() => setMoreOpen(false)} className="fixed inset-0 z-40 bg-black/70" />
           <div className="absolute bottom-full left-2 right-2 z-50 mb-2 rounded-xl glass-surface p-2">
            <div className="grid grid-cols-3 gap-2">
              {secondaryItems.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => { playPress(780); setMoreOpen(false); item.action(); }}
                     className="glass-button relative min-h-16 rounded-xl px-2 py-2 text-retro-body active:scale-95 flex flex-col items-center justify-center gap-1"
                  >
                    <Icon className="w-5 h-5 text-retro-accent" />
                    <span className="text-xs font-medium">{item.label}</span>
                    {'badge' in item && Boolean(item.badge && item.badge > 0) && <span className="absolute right-2 top-2 w-2 h-2 rounded-full bg-retro-accent" />}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
      <nav className="w-full grid grid-cols-5 gap-1 items-center justify-items-center">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleAction(item.action, item.highlight ? 920 : 780)}
              aria-label={item.label}
               className={`glass-button relative flex flex-col items-center justify-center w-full max-w-[100px] h-11 sm:h-12 rounded-md transition-all cursor-pointer group border touch-manipulation ${
                item.highlight
                  ? 'create-action -mt-3 h-14 sm:h-16 rounded-xl border-transparent shadow-lg'
                  : ('isHack' in item && item.isHack)
                  ? item.active
                    ? 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                    : 'bg-transparent text-rose-400 hover:bg-rose-500/10 border-transparent'
                  : item.active
                   ? 'glass-tab-active text-retro-accent-text border-transparent shadow-[0_0_12px_rgba(159,227,255,0.1)]'
                  : 'bg-transparent text-retro-muted hover:text-retro-fg hover:bg-glass-w5 border-transparent'
              }`}
            >
              {item.id === 'profile' ? (
                <div className={`w-5 h-5 sm:w-6 sm:h-6 rounded-full overflow-hidden flex items-center justify-center text-[10px] font-medium border shrink-0 transition-colors ${
                  item.active ? 'border-retro-accent bg-glass-w10 text-retro-accent' : 'border-border-glass bg-glass-w8 text-retro-muted group-hover:border-white/24'
                }`}>
                  {profilePic ? (
                    <img src={profilePic} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <User className="w-3.5 h-3.5 text-current" />
                  )}
                </div>
              ) : (
                <Icon className={`w-4 h-4 sm:w-5 sm:h-5 transition-colors ${item.highlight ? 'text-current' : item.active ? 'text-retro-accent' : ''}`} />
              )}

              <span className={`text-[10px] sm:text-[10px] font-medium mt-0.5 whitespace-nowrap ${
                  item.highlight ? 'text-current font-black uppercase tracking-wider' : item.active ? 'text-retro-accent' : 'text-retro-muted group-hover:text-retro-fg'
              }`}>
                {item.label}
              </span>

              {Boolean(item.badge && item.badge > 0) && (
                <span className="absolute top-1 right-2 sm:right-3 w-2 h-2 rounded-full bg-retro-accent shadow-[0_0_8px_rgba(159,227,255,0.4)]" />
              )}
            </button>
          );
        })}
      </nav>
    </footer>
  );
}
