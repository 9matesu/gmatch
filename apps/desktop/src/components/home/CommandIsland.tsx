"use client";

import React, { useState } from 'react';
import {
  House,
  SquaresFour,
  Sword,
  Cards,
  ChatCircleText,
  Plus,
  CaretLeft,
  CaretRight,
  Gear,
  Question,
  ShoppingBag,
  HardDrives,
  ShieldCheck,
  SignOut,
  PaintBrush,
  Monitor,
  FilmSlate,
  User,
} from '@phosphor-icons/react';
import { playPress } from '../../utils/sounds';
import { resolveMediaUrl } from '../../utils/media';
import { CountBadge } from './CountBadge';
import { formatCount } from '../../ui/format';
import type { ViewMode } from '../../game/types';
export type MainViewType = 'feed' | 'games' | 'create' | 'messages' | 'profile' | 'game' | 'gallery' | 'store' | 'pc_domination' | 'grid' | 'rooms' | 'servers' | 'watch';

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
  /** Live players in queue + in match (Arena badge). Hidden at 0. */
  gamesOnlineCount?: number;
  /** People watching in public rooms (Watch badge). Hidden at 0. */
  watchWatchingCount?: number;
  /** Posts newer than the last feed visit (Feed badge). Hidden while feed is open. */
  feedNewPostsCount?: number;
  /** Watch tab: fade the island to a hairline so only the video shows;
   * hovering the bottom edge brings it back (CSS .island-recessed). */
  recessed?: boolean;
  displayName?: string;
  profilePic?: string;
  onOpenCreatePost?: () => void;
  onOpenSettings?: () => void;
  /** Open the Help & documentation modal. */
  onOpenHelp?: () => void;
  onOpenStore?: () => void;
  onToggleMessages?: () => void;
  messagesOpen?: boolean;
  onOpenWallpaper?: () => void;
  themeOpen?: boolean;
  onLogout?: () => void;
  onOpenProfile?: () => void;
  onOpenAdmin?: () => void;
  /** Host mode or a node administered by this identity. The button is hidden
   *  otherwise; the PIN verify inside the panel remains the real gate. */
  showAdmin?: boolean;
  onOpenCreateCard?: () => void;
  settingsOpen?: boolean;
  /** Active Clicker layout; the pill only renders when this prop pair is given. */
  gridSize?: ViewMode;
  onGridSizeChange?: (mode: ViewMode) => void;
}

export function CommandIsland({
  mainView,
  setMainView,
  balance = 0,
  wsConnected: _wsConnected = false,
  unreadMessagesCount = 0,
  gamesOnlineCount = 0,
  watchWatchingCount = 0,
  feedNewPostsCount = 0,
  recessed = false,
  displayName = 'You',
  profilePic,
  onOpenCreatePost,
  onOpenSettings,
  onOpenHelp,
  settingsOpen = false,
  onOpenStore,
  onToggleMessages,
  messagesOpen = false,
  onOpenWallpaper,
  themeOpen = false,
  onLogout,
  onOpenProfile,
  onOpenAdmin,
  showAdmin,
  onOpenCreateCard,
  gridSize: _gridSize,
  onGridSizeChange: _onGridSizeChange,
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
      badge: feedNewPostsCount,
      badgeLabel: (n: number) => `${n} new posts`,
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
      badge: gamesOnlineCount,
      badgeLabel: (n: number) => `${n} in lobby`,
    },
    {
      id: 'gallery' as MainViewType,
      label: 'Vault',
      icon: Cards,
      active: mainView === 'gallery',
      badge: 0,
    },
    {
      id: 'watch' as MainViewType,
      label: 'Watch',
      icon: FilmSlate,
      active: mainView === 'watch',
      badge: watchWatchingCount,
      badgeLabel: (n: number) => `${n} watching`,
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
          className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-full bg-retro-accent text-retro-accent-text hover:bg-retro-accent-hover active:scale-[0.98] transition-all text-xs font-semibold"
          title="Forge Card"
          aria-label="Forge Card"
        >
          <Plus className="w-3.5 h-3.5" weight="bold" />
          <span className="hidden sm:inline">Forge</span>
        </button>
      );
    }

    // There is deliberately no "Play" button here for the Arena view. It used
    // to render one that called handleNavClick('games') from inside the branch
    // that only renders when mainView is ALREADY 'games' — so it set the view
    // to the value it already had and did nothing but make a noise. Labelled
    // "Play" and styled as the primary green CTA, that is worse than no button:
    // it is the most prominent control on the screen and it does not work. The
    // real action is "Queue for Perverts" in the Arena itself, and the Help >
    // Card Duels guide now says so.

    return null;
  };

  return (
    <>
      {/* Primary Floating Command Island Dock */}
      <nav
        aria-label="Command Island"
        className={`command-island fixed bottom-5 left-1/2 -translate-x-1/2 z-[var(--z-dropdown)] flex max-w-[calc(100vw-1.5rem)] items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-full select-none transition-all duration-300 overflow-hidden flex-nowrap ${recessed ? 'island-recessed' : ''}`}
      >
        {/* Left Telemetry: $G Balance */}
        <div
          aria-label={`Balance: ${formatCount(balance)} dollars`}
          className="flex items-center px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full bg-glass-w5 border border-border-glass text-xs font-mono tabular-nums text-retro-body shrink-0"
        >
          <span className="font-semibold text-retro-fg tracking-tight">
            ${formatCount(balance)}
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
                className={`relative flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-full text-xs font-medium transition-all ${
                  isActive
                    ? 'bg-retro-accent text-retro-accent-text'
                    : 'text-retro-muted hover:text-retro-fg hover:bg-glass-w8 active:scale-[0.98]'
                }`}
              >
                <Icon className="w-4 h-4" weight={isActive ? 'fill' : 'regular'} />
                <span className="text-xs font-medium hidden md:inline">
                  {item.label}
                </span>
                {item.badge > 0 && (
                  <CountBadge count={item.badge} label={item.badgeLabel ? item.badgeLabel(item.badge) : `${item.badge} players online`} />
                )}
              </button>
            );
          })}

          {/* The notification bell lives in the header now (single entry point);
              the footer island no longer duplicates it. */}

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
            className={`relative flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-full text-xs font-medium transition-all ${
              messagesOpen || mainView === 'messages' || mainView === 'rooms'
                ? 'bg-retro-accent text-retro-accent-text'
                : 'text-retro-muted hover:text-retro-fg hover:bg-glass-w8 active:scale-[0.98]'
            }`}
          >
            <ChatCircleText
              className="w-4 h-4"
              weight={messagesOpen || mainView === 'messages' || mainView === 'rooms' ? 'fill' : 'regular'}
            />
            <span className="text-xs font-medium hidden md:inline">Chat</span>
            <CountBadge count={unreadMessagesCount} />
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
                : 'text-retro-muted hover:text-retro-fg hover:bg-glass-w8 active:scale-[0.98]'
            }`}
          >
            <div className="w-5 h-5 rounded-full overflow-hidden border border-white/20 bg-black/40 flex items-center justify-center shrink-0">
              {profilePic ? (
                <img src={resolveMediaUrl(profilePic)} alt="" className="w-full h-full object-cover" />
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
          className={`p-1.5 rounded-full transition-all shrink-0 active:scale-[0.98] ${
            satelliteOpen
              ? 'bg-glass-w15 text-retro-fg shadow-inner'
              : 'text-retro-muted hover:text-retro-fg hover:bg-glass-w8'
          }`}
        >
          {satelliteOpen
            ? <CaretLeft className="w-4 h-4" />
            : <CaretRight className="w-4 h-4" />}
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
              className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium transition-all ${
                mainView === 'store'
                  ? 'bg-retro-accent text-retro-accent-text'
                  : 'text-retro-muted hover:text-retro-fg hover:bg-glass-w8 active:scale-[0.98]'
              }`}
            >
              <ShoppingBag className="w-3.5 h-3.5 shrink-0" weight={mainView === 'store' ? 'fill' : 'regular'} />
              <span className="text-xs hidden xl:inline">Store</span>
            </button>

            {/* Servers */}
            <button
              type="button"
              onClick={() => handleNavClick('servers')}
              aria-label="Servers"
              aria-current={mainView === 'servers' ? 'page' : undefined}
              title="Public & Private Servers"
              className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium transition-all ${
                mainView === 'servers'
                  ? 'bg-retro-accent text-retro-accent-text'
                  : 'text-retro-muted hover:text-retro-fg hover:bg-glass-w8 active:scale-[0.98]'
              }`}
            >
              <HardDrives className="w-3.5 h-3.5 shrink-0" weight={mainView === 'servers' ? 'fill' : 'regular'} />
              <span className="text-xs hidden xl:inline">Servers</span>
            </button>

            {/* Domination */}
            <button
              type="button"
              onClick={() => handleNavClick('pc_domination')}
              aria-label="Domination"
              aria-current={mainView === 'pc_domination' ? 'page' : undefined}
              title="PC Domination Battles"
              className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium transition-all ${
                mainView === 'pc_domination'
                  ? 'bg-retro-accent text-retro-accent-text'
                  : 'text-retro-muted hover:text-retro-fg hover:bg-glass-w8 active:scale-[0.98]'
              }`}
            >
              <Monitor className="w-3.5 h-3.5 shrink-0" weight={mainView === 'pc_domination' ? 'fill' : 'regular'} />
              <span className="text-xs hidden xl:inline">Domination</span>
            </button>

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
              className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium transition-all ${
                themeOpen
                  ? 'bg-retro-accent text-retro-accent-text'
                  : 'text-retro-muted hover:text-retro-fg hover:bg-glass-w8 active:scale-[0.98]'
              }`}
            >
              <PaintBrush className="w-3.5 h-3.5 shrink-0" weight={themeOpen ? 'fill' : 'regular'} />
              <span className="text-xs hidden xl:inline">Theme</span>
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
              className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium transition-all ${
                settingsOpen
                  ? 'bg-retro-accent text-retro-accent-text'
                  : 'text-retro-muted hover:text-retro-fg hover:bg-glass-w8 active:scale-[0.98]'
              }`}
            >
              <Gear className="w-3.5 h-3.5 shrink-0" weight={settingsOpen ? 'fill' : 'regular'} />
              <span className="text-xs hidden xl:inline">Settings</span>
            </button>

            {/* Help */}
            <button
              type="button"
              data-help-toggle="true"
              onClick={() => {
                playPress(760);
                onOpenHelp?.();
              }}
              aria-label="Help"
              title="Help & documentation"
              className="flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium text-retro-muted hover:text-retro-fg hover:bg-glass-w8 active:scale-[0.98] transition-all"
            >
              <Question className="w-3.5 h-3.5 shrink-0" />
              <span className="text-xs hidden xl:inline">Help</span>
            </button>

            {/* Admin: host mode or a node that says this identity administers
                it. The PIN verify inside the panel is the real boundary — this
                only keeps dead navigation away from non-admins. */}
            {showAdmin && (
              <button
                type="button"
                onClick={() => {
                  playPress(840);
                  onOpenAdmin?.();
                }}
                aria-label="Admin"
                title="Admin Control Panel"
                className="flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium text-retro-muted hover:text-retro-fg hover:bg-glass-w8 active:scale-[0.98] transition-all"
              >
                <ShieldCheck className="w-3.5 h-3.5 shrink-0" weight="regular" />
                <span className="text-xs hidden xl:inline">Admin</span>
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
                  className="flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium text-retro-muted hover:text-retro-fg hover:bg-glass-w8 active:scale-[0.98] transition-all"
                >
                  <SignOut className="w-3.5 h-3.5 shrink-0" />
                  <span className="text-xs hidden xl:inline">Logout</span>
                </button>
              </>
            )}
          </div>
        )}
      </nav>
    </>
  );
}
