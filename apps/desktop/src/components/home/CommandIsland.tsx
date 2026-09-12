"use client";

import React, { useState, useEffect, useRef } from 'react';
import {
  House,
  SquaresFour,
  Sword,
  Cards,
  ChatCircleText,
  Plus,
  GameController,
  DotsThree,
  Gear,
  ShoppingBag,
  HardDrives,
  ShieldCheck,
  SignOut,
  PaintBrush,
  User,
  Bell,
  X,
} from '@phosphor-icons/react';
import { playPress } from '../../utils/sounds';
import type { MainViewType } from './HomeFooter';

export interface CommandIslandProps {
  mainView: MainViewType;
  setMainView: (view: MainViewType) => void;
  balance?: number;
  wsConnected?: boolean;
  unreadMessagesCount?: number;
  unreadNotificationsCount?: number;
  displayName?: string;
  profilePic?: string;
  isAdmin?: boolean;
  onOpenCreatePost?: () => void;
  onOpenSettings?: () => void;
  onOpenStore?: () => void;
  onOpenNotifications?: () => void;
  onToggleMessages?: () => void;
  messagesOpen?: boolean;
  onOpenWallpaper?: () => void;
  onLogout?: () => void;
  onOpenProfile?: () => void;
  onOpenCreateCard?: () => void;
}

export function CommandIsland({
  mainView,
  setMainView,
  balance = 0,
  wsConnected = false,
  unreadMessagesCount = 0,
  unreadNotificationsCount = 0,
  displayName = 'You',
  profilePic,
  isAdmin = false,
  onOpenCreatePost,
  onOpenSettings,
  onOpenStore,
  onOpenNotifications,
  onToggleMessages,
  messagesOpen = false,
  onOpenWallpaper,
  onLogout,
  onOpenProfile,
  onOpenCreateCard,
}: CommandIslandProps) {
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [isScrolledDown, setIsScrolledDown] = useState(false);
  const lastScrollY = useRef(0);

  // Auto-collapse slightly on fast downward scroll to maximize viewing area
  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      if (currentScrollY > lastScrollY.current + 30 && currentScrollY > 100) {
        setIsScrolledDown(true);
      } else if (currentScrollY < lastScrollY.current - 15) {
        setIsScrolledDown(false);
      }
      lastScrollY.current = currentScrollY;
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleNavClick = (view: MainViewType, soundFreq = 780) => {
    playPress(soundFreq);
    setMainView(view);
    setMoreMenuOpen(false);
  };

  const navItems = [
    {
      id: 'feed' as MainViewType,
      label: 'Feed',
      icon: House,
      active: mainView === 'feed',
      badge: 0,
    },
    {
      id: 'grid' as MainViewType,
      label: 'Grid',
      icon: SquaresFour,
      active: mainView === 'grid',
      badge: 0,
    },
    {
      id: 'games' as MainViewType,
      label: 'Arena',
      icon: Sword,
      active: mainView === 'games' || mainView === 'game',
      badge: 0,
    },
    {
      id: 'gallery' as MainViewType,
      label: 'Vault',
      icon: Cards,
      active: mainView === 'gallery',
      badge: 0,
    },
  ];

  // Contextual action depending on current view
  const renderContextualAction = () => {
    if (mainView === 'feed') {
      return (
        <button
          type="button"
          onClick={() => {
            playPress(920);
            onOpenCreatePost?.();
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#388bfd] text-white hover:bg-[#58a6ff] active:scale-95 transition-all text-xs font-semibold shadow-[0_2px_12px_rgba(56,139,253,0.4)]"
          title="Create Post"
          aria-label="Create Post"
        >
          <Plus className="w-3.5 h-3.5" weight="bold" />
          <span className="hidden sm:inline">Post</span>
        </button>
      );
    }

    if (mainView === 'gallery') {
      return (
        <button
          type="button"
          onClick={() => {
            playPress(900);
            onOpenCreateCard?.();
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#a371f7] text-white hover:bg-[#b88bf9] active:scale-95 transition-all text-xs font-semibold shadow-[0_2px_12px_rgba(163,113,247,0.4)]"
          title="Forge Card"
          aria-label="Forge Card"
        >
          <Plus className="w-3.5 h-3.5" weight="bold" />
          <span className="hidden sm:inline">Forge</span>
        </button>
      );
    }

    if (mainView === 'games') {
      return (
        <button
          type="button"
          onClick={() => {
            playPress(940);
            handleNavClick('games');
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#238636] text-white hover:bg-[#2ea043] active:scale-95 transition-all text-xs font-semibold shadow-[0_2px_12px_rgba(35,134,54,0.4)]"
          title="Quick Match"
          aria-label="Quick Match"
        >
          <GameController className="w-3.5 h-3.5" weight="fill" />
          <span className="hidden sm:inline">Play</span>
        </button>
      );
    }

    // Default action: quick notification / alerts trigger
    return (
      <button
        type="button"
        onClick={() => {
          playPress(800);
          onOpenNotifications?.();
        }}
        className="relative p-2 rounded-full hover:bg-white/10 text-retro-muted hover:text-retro-fg transition-colors"
        title="Notifications"
        aria-label="Notifications"
      >
        <Bell className="w-4 h-4" />
        {unreadNotificationsCount > 0 && (
          <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#f85149] ring-2 ring-[#131722]" />
        )}
      </button>
    );
  };

  return (
    <>
      {/* Secondary More Menu Drawer / Sheet */}
      {moreMenuOpen && (
        <div className="fixed inset-0 z-[var(--z-modal)] flex flex-col justify-end pointer-events-auto">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
            onClick={() => setMoreMenuOpen(false)}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-md mx-auto mb-20 px-4 animate-sheet-up">
            <div className="bg-[#131722] border border-white/10 rounded-2xl shadow-2xl p-4 text-retro-fg">
              <div className="flex items-center justify-between pb-3 mb-3 border-b border-white/8">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full overflow-hidden border border-white/15 bg-white/5 flex items-center justify-center text-xs">
                    {profilePic ? (
                      <img src={profilePic} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <User className="w-4 h-4 text-retro-muted" />
                    )}
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-white">{displayName}</div>
                    <div className="text-[10px] text-retro-muted font-mono flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${wsConnected ? 'bg-[#3fb950]' : 'bg-[#d29922]'}`} />
                      {wsConnected ? 'Online' : 'Reconnecting'}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setMoreMenuOpen(false)}
                  className="p-1 rounded-lg text-retro-muted hover:text-white hover:bg-white/10 transition-colors"
                  aria-label="Close menu"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    playPress(800);
                    setMoreMenuOpen(false);
                    if (onOpenProfile) onOpenProfile(); else handleNavClick('profile');
                  }}
                  className="flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl bg-white/[0.03] hover:bg-white/[0.08] active:scale-95 transition-all text-xs text-retro-body hover:text-white"
                >
                  <User className="w-4 h-4 text-[#58a6ff]" />
                  <span>Profile</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    playPress(800);
                    setMoreMenuOpen(false);
                    if (onOpenStore) onOpenStore(); else handleNavClick('store');
                  }}
                  className="flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl bg-white/[0.03] hover:bg-white/[0.08] active:scale-95 transition-all text-xs text-retro-body hover:text-white"
                >
                  <ShoppingBag className="w-4 h-4 text-[#d29922]" />
                  <span>Store</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    playPress(800);
                    setMoreMenuOpen(false);
                    handleNavClick('servers');
                  }}
                  className="flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl bg-white/[0.03] hover:bg-white/[0.08] active:scale-95 transition-all text-xs text-retro-body hover:text-white"
                >
                  <HardDrives className="w-4 h-4 text-[#3fb950]" />
                  <span>Servers</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    playPress(800);
                    setMoreMenuOpen(false);
                    onOpenWallpaper?.();
                  }}
                  className="flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl bg-white/[0.03] hover:bg-white/[0.08] active:scale-95 transition-all text-xs text-retro-body hover:text-white"
                >
                  <PaintBrush className="w-4 h-4 text-[#f472b6]" />
                  <span>Wallpaper</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    playPress(800);
                    setMoreMenuOpen(false);
                    onOpenSettings?.();
                  }}
                  className="flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl bg-white/[0.03] hover:bg-white/[0.08] active:scale-95 transition-all text-xs text-retro-body hover:text-white"
                >
                  <Gear className="w-4 h-4 text-retro-muted" />
                  <span>Settings</span>
                </button>

                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => {
                      playPress(840);
                      setMoreMenuOpen(false);
                      handleNavClick('admin');
                    }}
                    className="flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl bg-white/[0.03] hover:bg-white/[0.08] active:scale-95 transition-all text-xs text-retro-body hover:text-white"
                  >
                    <ShieldCheck className="w-4 h-4 text-[#f85149]" />
                    <span>Admin</span>
                  </button>
                )}
              </div>

              {onLogout && (
                <button
                  type="button"
                  onClick={() => {
                    playPress(700);
                    setMoreMenuOpen(false);
                    onLogout();
                  }}
                  className="w-full mt-3 pt-3 border-t border-white/8 flex items-center justify-center gap-2 text-xs font-medium text-[#f85149] hover:text-[#ff7b72] transition-colors"
                >
                  <SignOut className="w-3.5 h-3.5" />
                  <span>Log out</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Primary Floating Command Island Dock */}
      <nav
        aria-label="Command Island"
        className={`command-island fixed bottom-5 left-1/2 -translate-x-1/2 z-[var(--z-modal)] flex items-center gap-1 sm:gap-2 px-2.5 sm:px-3 py-1.5 rounded-full select-none transition-all duration-300 ${
          isScrolledDown ? 'opacity-80 scale-95 hover:opacity-100 hover:scale-100' : 'opacity-100 scale-100'
        }`}
      >
        {/* Left Telemetry: $G Balance & Socket Status */}
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-white/[0.04] border border-white/5 text-[11px] font-mono tabular-nums text-retro-body">
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
              wsConnected ? 'bg-[#3fb950] shadow-[0_0_6px_#3fb950]' : 'bg-[#d29922]'
            }`}
            title={wsConnected ? 'Swarm: Online' : 'Swarm: Reconnecting'}
          />
          <span className="font-semibold text-white tracking-tight">
            ${Math.floor(balance).toLocaleString()}
          </span>
        </div>

        <div className="h-4 w-[1px] bg-white/10 mx-0.5" />

        {/* Center Primary Nav Tabs */}
        <div className="flex items-center gap-0.5 sm:gap-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = item.active;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavClick(item.id)}
                aria-label={item.label}
                aria-current={isActive ? 'page' : undefined}
                className={`relative flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                  isActive
                    ? 'bg-[#388bfd] text-white shadow-[0_2px_12px_rgba(56,139,253,0.35)] scale-[1.02]'
                    : 'text-retro-muted hover:text-white hover:bg-white/[0.06] active:scale-95'
                }`}
              >
                <Icon className="w-4 h-4" weight={isActive ? 'fill' : 'regular'} />
                <span className="text-[11px] font-medium hidden md:inline">
                  {item.label}
                </span>
              </button>
            );
          })}

          {/* Messages Drawer Toggle Button */}
          <button
            type="button"
            onClick={() => {
              playPress(860);
              if (onToggleMessages) {
                onToggleMessages();
              } else {
                handleNavClick('messages');
              }
            }}
            aria-label="Messages"
            className={`relative flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
              messagesOpen || mainView === 'messages'
                ? 'bg-[#388bfd] text-white shadow-[0_2px_12px_rgba(56,139,253,0.35)]'
                : 'text-retro-muted hover:text-white hover:bg-white/[0.06] active:scale-95'
            }`}
          >
            <ChatCircleText
              className="w-4 h-4"
              weight={messagesOpen || mainView === 'messages' ? 'fill' : 'regular'}
            />
            <span className="text-[11px] font-medium hidden md:inline">Chat</span>
            {unreadMessagesCount > 0 && (
              <span className="w-2 h-2 rounded-full bg-[#f85149] ring-2 ring-[#131722]" />
            )}
          </button>
        </div>

        <div className="h-4 w-[1px] bg-white/10 mx-0.5" />

        {/* Right Contextual Capsule */}
        <div className="flex items-center gap-1">
          {renderContextualAction()}

          {/* More Menu Trigger */}
          <button
            type="button"
            onClick={() => {
              playPress(760);
              setMoreMenuOpen((v) => !v);
            }}
            aria-label="More options"
            className="p-1.5 rounded-full text-retro-muted hover:text-white hover:bg-white/[0.06] active:scale-95 transition-all"
          >
            <DotsThree className="w-4 h-4" weight="bold" />
          </button>
        </div>
      </nav>
    </>
  );
}
