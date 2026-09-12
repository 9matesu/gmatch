"use client";

import React, { useState } from 'react';
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
  Monitor,
  Users,
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
  showRooms?: boolean;
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
  showRooms = false,
}: CommandIslandProps) {
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);

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
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-hud-accent text-retro-fg hover:bg-hud-accent-hover active:scale-95 transition-all text-xs font-semibold"
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
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-chrome-lav text-retro-fg hover:bg-chrome-lav/90 active:scale-95 transition-all text-xs font-semibold"
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
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-retro-online text-retro-fg hover:bg-retro-online/90 active:scale-95 transition-all text-xs font-semibold"
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
        className="relative p-2 rounded-full hover:bg-glass-w10 text-retro-muted hover:text-retro-fg transition-colors"
        title="Notifications"
        aria-label="Notifications"
      >
        <Bell className="w-4 h-4" />
        {unreadNotificationsCount > 0 && (
          <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-retro-error ring-2 ring-retro-panel" />
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
            className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity"
            onClick={() => setMoreMenuOpen(false)}
            aria-hidden="true"
          />
          <div className="relative w-full max-w-md mx-auto mb-20 px-4 animate-orbit-slide-up">
            <div className="bg-retro-panel border border-border-glass rounded-xl shadow-2xl p-4 text-retro-fg">
              <div className="flex items-center justify-between pb-3 mb-3 border-b border-border-glass">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full overflow-hidden border border-border-glass bg-glass-w5 flex items-center justify-center text-xs">
                    {profilePic ? (
                      <img src={profilePic} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <User className="w-4 h-4 text-retro-muted" />
                    )}
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-retro-fg">{displayName}</div>
                    <div className="text-[10px] text-retro-muted font-mono flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${wsConnected ? 'bg-retro-online' : 'bg-retro-warning'}`} />
                      {wsConnected ? 'Online' : 'Reconnecting'}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setMoreMenuOpen(false)}
                  className="p-1 rounded-lg text-retro-muted hover:text-retro-fg hover:bg-glass-w10 transition-colors"
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
                  className="flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl bg-glass-w5 hover:bg-glass-w10 active:scale-95 transition-all text-xs text-retro-body hover:text-retro-fg"
                >
                  <User className="w-4 h-4 text-retro-info" />
                  <span>Profile</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    playPress(800);
                    setMoreMenuOpen(false);
                    if (onOpenStore) onOpenStore(); else handleNavClick('store');
                  }}
                  className="flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl bg-glass-w5 hover:bg-glass-w10 active:scale-95 transition-all text-xs text-retro-body hover:text-retro-fg"
                >
                  <ShoppingBag className="w-4 h-4 text-retro-warning" />
                  <span>Store</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    playPress(800);
                    setMoreMenuOpen(false);
                    handleNavClick('servers');
                  }}
                  className="flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl bg-glass-w5 hover:bg-glass-w10 active:scale-95 transition-all text-xs text-retro-body hover:text-retro-fg"
                >
                  <HardDrives className="w-4 h-4 text-retro-online" />
                  <span>Servers</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    playPress(800);
                    setMoreMenuOpen(false);
                    handleNavClick('pc_domination');
                  }}
                  className="flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl bg-glass-w5 hover:bg-glass-w10 active:scale-95 transition-all text-xs text-retro-body hover:text-retro-fg"
                >
                  <Monitor className="w-4 h-4 text-retro-muted" />
                  <span>Domination</span>
                </button>

                {showRooms && (
                  <button
                    type="button"
                    onClick={() => {
                      playPress(800);
                      setMoreMenuOpen(false);
                      handleNavClick('rooms');
                    }}
                    className="flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl bg-glass-w5 hover:bg-glass-w10 active:scale-95 transition-all text-xs text-retro-body hover:text-retro-fg"
                  >
                    <Users className="w-4 h-4 text-retro-muted" />
                    <span>Rooms</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    playPress(800);
                    setMoreMenuOpen(false);
                    onOpenWallpaper?.();
                  }}
                  className="flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl bg-glass-w5 hover:bg-glass-w10 active:scale-95 transition-all text-xs text-retro-body hover:text-retro-fg"
                >
                  <PaintBrush className="w-4 h-4 text-chrome-pink" />
                  <span>Wallpaper</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    playPress(800);
                    setMoreMenuOpen(false);
                    onOpenSettings?.();
                  }}
                  className="flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl bg-glass-w5 hover:bg-glass-w10 active:scale-95 transition-all text-xs text-retro-body hover:text-retro-fg"
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
                    className="flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl bg-glass-w5 hover:bg-glass-w10 active:scale-95 transition-all text-xs text-retro-body hover:text-retro-fg"
                  >
                    <ShieldCheck className="w-4 h-4 text-retro-error" />
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
                  className="w-full mt-3 pt-3 border-t border-border-glass flex items-center justify-center gap-2 text-xs font-medium text-retro-error hover:text-retro-error transition-colors"
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
        className="command-island fixed bottom-5 left-1/2 -translate-x-1/2 z-[var(--z-dropdown)] flex items-center gap-1 sm:gap-2 px-2.5 sm:px-3 py-1.5 rounded-full select-none transition-all duration-300"
      >
        {/* Left Telemetry: $G Balance & Socket Status */}
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-glass-w5 border border-border-glass text-[11px] font-mono tabular-nums text-retro-body">
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
              wsConnected ? 'bg-retro-online' : 'bg-retro-warning'
            }`}
            title={wsConnected ? 'Swarm: Online' : 'Swarm: Reconnecting'}
          />
          <span className="font-semibold text-retro-fg tracking-tight">
            ${Math.floor(balance).toLocaleString()}
          </span>
        </div>

        <div className="h-4 w-[1px] bg-glass-w10 mx-0.5" />

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
                    ? 'bg-hud-accent text-retro-fg scale-[1.02]'
                    : 'text-retro-muted hover:text-retro-fg hover:bg-glass-w8 active:scale-95'
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
                ? 'bg-hud-accent text-retro-fg'
                : 'text-retro-muted hover:text-retro-fg hover:bg-glass-w8 active:scale-95'
            }`}
          >
            <ChatCircleText
              className="w-4 h-4"
              weight={messagesOpen || mainView === 'messages' ? 'fill' : 'regular'}
            />
            <span className="text-[11px] font-medium hidden md:inline">Chat</span>
            {unreadMessagesCount > 0 && (
              <span className="w-2 h-2 rounded-full bg-retro-error ring-2 ring-retro-panel" />
            )}
          </button>
        </div>

        <div className="h-4 w-[1px] bg-glass-w10 mx-0.5" />

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
            className="p-1.5 rounded-full text-retro-muted hover:text-retro-fg hover:bg-glass-w8 active:scale-95 transition-all"
          >
            <DotsThree className="w-4 h-4" weight="bold" />
          </button>
        </div>
      </nav>
    </>
  );
}
