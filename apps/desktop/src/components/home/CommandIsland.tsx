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
} from '@phosphor-icons/react';
import { playPress } from '../../utils/sounds';
export type MainViewType = 'feed' | 'games' | 'create' | 'messages' | 'profile' | 'game' | 'gallery' | 'store' | 'pc_domination' | 'grid' | 'rooms' | 'servers' | 'admin';

export type GamesNavTab = 'duel' | 'cards' | 'babecock' | 'ranks' | 'idle';

export interface ActiveHackSession {
  itemId: string;
  itemName: string;
  targetUserId: string;
  targetUserName: string;
  expiresAt: number;
}


const SATELLITE_KEY = 'gmatch.satellite_bar.visible';

function readSatelliteOpen(): boolean {
  try {
    const v = localStorage.getItem(SATELLITE_KEY);
    return v === null ? true : v === '1';
  } catch {
    return true;
  }
}

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
  notificationsOpen?: boolean;
  onToggleMessages?: () => void;
  messagesOpen?: boolean;
  onOpenWallpaper?: () => void;
  themeOpen?: boolean;
  onLogout?: () => void;
  onOpenProfile?: () => void;
  onOpenCreateCard?: () => void;
  showRooms?: boolean;
  settingsOpen?: boolean;
}

export function CommandIsland({
  mainView,
  setMainView,
  balance = 0,
  wsConnected: _wsConnected = false,
  unreadMessagesCount = 0,
  unreadNotificationsCount = 0,
  displayName = 'You',
  profilePic,
  isAdmin = false,
  onOpenCreatePost,
  onOpenSettings,
  settingsOpen = false,
  onOpenStore,
  onOpenNotifications,
  notificationsOpen = false,
  onToggleMessages,
  messagesOpen = false,
  onOpenWallpaper,
  themeOpen = false,
  onLogout,
  onOpenProfile,
  onOpenCreateCard,
  showRooms = false,
}: CommandIslandProps) {
  const [satelliteOpen, setSatelliteOpen] = useState<boolean>(readSatelliteOpen);

  const toggleSatellite = () => {
    playPress(760);
    setSatelliteOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SATELLITE_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const handleNavClick = (view: MainViewType, soundFreq = 780) => {
    playPress(soundFreq);
    setMainView(view);
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
      label: 'Clicker',
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
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-retro-accent text-retro-accent-text hover:bg-retro-accent-hover active:scale-95 transition-all text-xs font-semibold"
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

    return null;
  };

  return (
    <>
      {/* Primary Floating Command Island Dock */}
      <nav
        aria-label="Command Island"
        className="command-island fixed bottom-5 left-1/2 -translate-x-1/2 z-[var(--z-dropdown)] flex max-w-[calc(100vw-1.5rem)] items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-full select-none transition-all duration-300 overflow-x-auto styled-scrollbar"
      >
        {/* Left Telemetry: $G Balance */}
        <div className="flex items-center px-2.5 py-1 rounded-full bg-glass-w5 border border-border-glass text-xs font-mono tabular-nums text-retro-body shrink-0">
          <span className="font-semibold text-retro-fg tracking-tight">
            ${Math.floor(balance).toLocaleString()}
          </span>
        </div>

        <div className="h-4 w-[1px] bg-glass-w10 mx-0.5 shrink-0" />

        {/* Center Primary Nav Tabs */}
        <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
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
                    ? 'bg-retro-accent text-retro-accent-text'
                    : 'text-retro-muted hover:text-retro-fg hover:bg-glass-w8 active:scale-95'
                }`}
              >
                <Icon className="w-4 h-4" weight={isActive ? 'fill' : 'regular'} />
                <span className="text-xs font-medium hidden md:inline">
                  {item.label}
                </span>
              </button>
            );
          })}

          {/* Notifications Button directly to the left of Chat */}
          <button
            type="button"
            data-notifications-toggle="true"
            onClick={() => {
              playPress();
              onOpenNotifications?.();
            }}
            aria-label="Notifications"
            aria-pressed={notificationsOpen}
            title="Activity Notifications"
            className={`relative flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
              notificationsOpen
                ? 'bg-retro-accent text-retro-accent-text'
                : 'text-retro-muted hover:text-retro-fg hover:bg-glass-w8 active:scale-95'
            }`}
          >
            <Bell
              className="w-4 h-4"
              weight={notificationsOpen ? 'fill' : 'regular'}
            />
            <span className="text-xs font-medium hidden md:inline">Alerts</span>
            {unreadNotificationsCount > 0 && (
              <span className="w-2 h-2 rounded-full bg-retro-error ring-2 ring-retro-panel" />
            )}
          </button>

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
                ? 'bg-retro-accent text-retro-accent-text'
                : 'text-retro-muted hover:text-retro-fg hover:bg-glass-w8 active:scale-95'
            }`}
          >
            <ChatCircleText
              className="w-4 h-4"
              weight={messagesOpen || mainView === 'messages' ? 'fill' : 'regular'}
            />
            <span className="text-xs font-medium hidden md:inline">Chat</span>
            {unreadMessagesCount > 0 && (
              <span className="w-2 h-2 rounded-full bg-retro-error ring-2 ring-retro-panel" />
            )}
          </button>

          {/* User Profile Button directly on the Pill */}
          <button
            type="button"
            onClick={() => {
              playPress(800);
              if (onOpenProfile) onOpenProfile();
              else handleNavClick('profile');
            }}
            aria-label="Profile"
            aria-current={mainView === 'profile' ? 'page' : undefined}
            title={`Profile (${displayName})`}
            className={`relative flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
              mainView === 'profile'
                ? 'bg-retro-accent text-retro-accent-text'
                : 'text-retro-muted hover:text-retro-fg hover:bg-glass-w8 active:scale-95'
            }`}
          >
            <div className="w-5 h-5 rounded-full overflow-hidden border border-white/20 bg-black/40 flex items-center justify-center shrink-0">
              {profilePic ? (
                <img src={profilePic} alt="" className="w-full h-full object-cover" />
              ) : (
                <User className="w-3.5 h-3.5" weight={mainView === 'profile' ? 'fill' : 'regular'} />
              )}
            </div>
            <span className="text-xs font-medium hidden md:inline">Profile</span>
          </button>
        </div>

        {/* Contextual Capsule */}
        {renderContextualAction() && (
          <>
            <div className="h-4 w-[1px] bg-glass-w10 mx-0.5 shrink-0" />
            <div className="flex items-center gap-1 shrink-0">
              {renderContextualAction()}
            </div>
          </>
        )}

        <div className="h-4 w-[1px] bg-glass-w10 mx-0.5 shrink-0" />

        {/* More Options / Expand-Collapse Toggle */}
        <button
          type="button"
          onClick={toggleSatellite}
          aria-label="More options"
          aria-pressed={satelliteOpen}
          title={satelliteOpen ? 'Collapse extra tools' : 'Expand extra tools to the right'}
          className={`p-1.5 rounded-full transition-all shrink-0 active:scale-95 ${
            satelliteOpen
              ? 'bg-glass-w15 text-retro-fg shadow-inner'
              : 'text-retro-muted hover:text-retro-fg hover:bg-glass-w8'
          }`}
        >
          <DotsThree className="w-4 h-4" weight="bold" />
        </button>

        {/* Expanded Right Section of the Pill Bar */}
        {satelliteOpen && (
          <div className="flex items-center gap-1 sm:gap-1.5 shrink-0 animate-orbit-fade-in duration-300">
            <div className="h-4 w-[1px] bg-glass-w10 mx-0.5 shrink-0" />

            {/* Store */}
            <button
              type="button"
              onClick={() => {
                playPress(800);
                if (onOpenStore) onOpenStore();
                else handleNavClick('store');
              }}
              aria-label="Store"
              aria-current={mainView === 'store' ? 'page' : undefined}
              title="Store & Boosters"
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                mainView === 'store'
                  ? 'bg-retro-accent text-retro-accent-text'
                  : 'text-retro-muted hover:text-retro-fg hover:bg-glass-w8 active:scale-95'
              }`}
            >
              <ShoppingBag className="w-3.5 h-3.5 text-retro-warning shrink-0" weight={mainView === 'store' ? 'fill' : 'regular'} />
              <span className="text-xs hidden sm:inline">Store</span>
            </button>

            {/* Servers */}
            <button
              type="button"
              onClick={() => handleNavClick('servers')}
              aria-label="Servers"
              aria-current={mainView === 'servers' ? 'page' : undefined}
              title="Public & Private Servers"
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                mainView === 'servers'
                  ? 'bg-retro-accent text-retro-accent-text'
                  : 'text-retro-muted hover:text-retro-fg hover:bg-glass-w8 active:scale-95'
              }`}
            >
              <HardDrives className="w-3.5 h-3.5 text-retro-online shrink-0" weight={mainView === 'servers' ? 'fill' : 'regular'} />
              <span className="text-xs hidden sm:inline">Servers</span>
            </button>

            {/* Domination */}
            <button
              type="button"
              onClick={() => handleNavClick('pc_domination')}
              aria-label="Domination"
              aria-current={mainView === 'pc_domination' ? 'page' : undefined}
              title="PC Domination Battles"
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                mainView === 'pc_domination'
                  ? 'bg-retro-accent text-retro-accent-text'
                  : 'text-retro-muted hover:text-retro-fg hover:bg-glass-w8 active:scale-95'
              }`}
            >
              <Monitor className="w-3.5 h-3.5 text-retro-info shrink-0" weight={mainView === 'pc_domination' ? 'fill' : 'regular'} />
              <span className="text-xs hidden sm:inline">Domination</span>
            </button>

            {/* Rooms (conditional on courier active) */}
            {showRooms && (
              <button
                type="button"
                onClick={() => handleNavClick('rooms')}
                aria-label="Rooms"
                aria-current={mainView === 'rooms' ? 'page' : undefined}
                title="Blind Courier Rooms"
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                  mainView === 'rooms'
                    ? 'bg-retro-accent text-retro-accent-text'
                    : 'text-retro-muted hover:text-retro-fg hover:bg-glass-w8 active:scale-95'
                }`}
              >
                <Users className="w-3.5 h-3.5 text-retro-muted shrink-0" weight={mainView === 'rooms' ? 'fill' : 'regular'} />
                <span className="text-xs hidden sm:inline">Rooms</span>
              </button>
            )}

            {/* Wallpaper */}
            <button
              type="button"
              data-theme-toggle="true"
              onClick={() => {
                playPress(800);
                onOpenWallpaper?.();
              }}
              aria-label="Wallpaper"
              aria-pressed={themeOpen}
              title="Custom Wallpaper Settings"
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                themeOpen
                  ? 'bg-retro-accent text-retro-accent-text'
                  : 'text-retro-muted hover:text-retro-fg hover:bg-glass-w8 active:scale-95'
              }`}
            >
              <PaintBrush className="w-3.5 h-3.5 shrink-0" weight={themeOpen ? 'fill' : 'regular'} />
              <span className="text-xs hidden sm:inline">Theme</span>
            </button>

            {/* Settings */}
            <button
              type="button"
              data-settings-toggle="true"
              onClick={() => {
                playPress(800);
                onOpenSettings?.();
              }}
              aria-label="Settings"
              aria-pressed={settingsOpen}
              title="Application Settings"
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                settingsOpen
                  ? 'bg-retro-accent text-retro-accent-text'
                  : 'text-retro-muted hover:text-retro-fg hover:bg-glass-w8 active:scale-95'
              }`}
            >
              <Gear className="w-3.5 h-3.5 shrink-0" weight={settingsOpen ? 'fill' : 'regular'} />
              <span className="text-xs hidden sm:inline">Settings</span>
            </button>

            {/* Admin (conditional on admin flag) */}
            {isAdmin && (
              <button
                type="button"
                onClick={() => {
                  playPress(840);
                  handleNavClick('admin');
                }}
                aria-label="Admin"
                aria-current={mainView === 'admin' ? 'page' : undefined}
                title="Admin Control Panel"
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                  mainView === 'admin'
                    ? 'bg-retro-accent text-retro-accent-text'
                    : 'text-retro-muted hover:text-retro-fg hover:bg-glass-w8 active:scale-95'
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5 text-retro-error shrink-0" weight={mainView === 'admin' ? 'fill' : 'regular'} />
                <span className="text-xs hidden sm:inline">Admin</span>
              </button>
            )}

            {/* Logout (conditional on onLogout) */}
            {onLogout && (
              <>
                <div className="h-3.5 w-[1px] bg-glass-w10 mx-0.5 shrink-0" />
                <button
                  type="button"
                  onClick={() => {
                    playPress(700);
                    onLogout();
                  }}
                  aria-label="Log out"
                  title="Log out"
                  className="flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium text-retro-error/80 hover:text-retro-error hover:bg-retro-error/10 active:scale-95 transition-all"
                >
                  <SignOut className="w-3.5 h-3.5 shrink-0" />
                  <span className="text-xs hidden sm:inline">Logout</span>
                </button>
              </>
            )}
          </div>
        )}
      </nav>
    </>
  );
}
