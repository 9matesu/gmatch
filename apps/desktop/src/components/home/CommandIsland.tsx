"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  UsersThree,
  Bell,
} from '@phosphor-icons/react';
import { playPress } from '../../utils/sounds';
import { useCommunityInvite, openCommunityInvite } from '../../services/community';
import { resolveMediaUrl } from '../../utils/media';
import { CountBadge } from './CountBadge';
import { MediaPickerPanel } from '../media/MediaPickerModal';
import type { MediaSelection } from '../media/picker';
import type { ViewMode } from '../../game/types';
export type MainViewType = 'feed' | 'games' | 'create' | 'messages' | 'profile' | 'game' | 'gallery' | 'store' | 'pc_domination' | 'grid' | 'rooms' | 'servers' | 'watch';

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
  /** A media pick from the Post bubble goes straight into the post creator
   *  pre-attached. Omitted → the bubble is not offered (tests / embeds). */
  onPickMedia?: (sel: MediaSelection) => void;
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
  /** Unread notification count for the pill (0 hides it). */
  notificationCount?: number;
  /** Toggle the left notification sidebar. */
  onToggleNotifications?: () => void;
  notificationsOpen?: boolean;
}

export function CommandIsland({
  mainView,
  setMainView,
  wsConnected: _wsConnected = false,
  unreadMessagesCount = 0,
  gamesOnlineCount = 0,
  watchWatchingCount = 0,
  feedNewPostsCount = 0,
  recessed = false,
  displayName = 'You',
  profilePic,
  onOpenCreatePost,
  onPickMedia,
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
  gridSize: _gridSize,
  onGridSizeChange: _onGridSizeChange,
  notificationCount = 0,
  onToggleNotifications,
  notificationsOpen = false,
}: CommandIslandProps) {
  const [satelliteOpen, setSatelliteOpen] = useState<boolean>(readSatelliteOpen);
  const [postPickerOpen, setPostPickerOpen] = useState(false);
  // The media balloon is STABLE: a click opens it, it stays put while the player
  // switches panes, and only an explicit pick / close / Escape / outside click
  // dismisses it. It used to open on hover and close on mouse-leave, so moving
  // the pointer onto a tab could dismiss the very thing about to be clicked.
  const pickerTriggerRef = useRef<HTMLDivElement | null>(null);
  const pickerBubbleRef = useRef<HTMLDivElement | null>(null);
  const communityUrl = useCommunityInvite();

  /** Every close goes through here. */
  const closePicker = useCallback(() => setPostPickerOpen(false), []);
  const togglePicker = () => {
    playPress(900);
    setPostPickerOpen((v) => !v);
  };

  // Outside click + Escape. The trigger is excluded so a second click on the
  // Post button toggles rather than closing and instantly re-opening.
  useEffect(() => {
    if (!postPickerOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (pickerBubbleRef.current?.contains(target)) return;
      if (pickerTriggerRef.current?.contains(target)) return;
      closePicker();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePicker();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [postPickerOpen, closePicker]);

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


  return (
    <>
      {/* Primary Floating Command Island Dock.
          `left-1/2` alone was the bug: it moved the box's LEFT EDGE to the
          midline, so a dock wider than half the viewport hung off the right
          side (measured: right edge 853 at a 768px viewport). The inset pair
          centres the box on both axes and lets `w-max` shrink to the content. */}
      <nav
        aria-label="Command Island"
        className={`command-island fixed bottom-5 inset-x-0 mx-auto w-max max-w-[calc(100vw-1.5rem)] z-[var(--z-dropdown)] flex items-center justify-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-full select-none transition duration-300 overflow-x-auto flex-nowrap ${recessed ? 'island-recessed' : ''}`}
      >
        {/* Left zone: primary nav tabs, kept intact (shrink-0) so a narrow
            window scrolls the dock instead of squashing the icons. */}
        <div className="flex items-center gap-0.5 sm:gap-1 shrink-0 justify-end">
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
                className={`relative flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-full text-xs font-medium transition ${
                  isActive
                    ? 'bg-glass-w15 text-retro-fg'
                    : 'text-retro-muted hover:text-retro-fg hover:bg-glass-w8 active:scale-(--scale-press)'
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
        </div>

        <div className="h-4 w-[1px] bg-glass-w10 mx-0.5 shrink-0" />

        {/* Center: THE Post button — one focal point in the island. A CLICK
            opens the SAME media-picker balloon (never two different modals);
            a pick flows into the composer pre-attached. The balance counter is
            gone: the g$ ledger lives in the Vault, not the chrome. */}
        {onOpenCreatePost && (
          <div
            ref={pickerTriggerRef}
            className="relative shrink-0"
            onKeyDown={(e) => { if (e.key === 'Escape') closePicker(); }}
          >
            <button
              type="button"
              onClick={togglePicker}
              aria-label="Create a post"
              aria-haspopup={onPickMedia ? 'dialog' : undefined}
              aria-expanded={onPickMedia ? postPickerOpen : undefined}
              title="Create a post — opens the media picker"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-retro-accent text-retro-accent-text hover:bg-retro-accent-hover hover:-translate-y-0.5 hover: active:scale-95 active:translate-y-0 transition text-xs font-bold tracking-wide"
            >
              <Plus className="w-3.5 h-3.5" weight="bold" />
              <span className="hidden sm:inline">Post</span>
            </button>
          </div>
        )}

        <div className="h-4 w-[1px] bg-glass-w10 mx-0.5 shrink-0" />

        {/* Right zone: chat, profile, contextual action, extra tools. */}
        <div className="flex items-center gap-0.5 sm:gap-1 shrink-0 justify-start">

          {/* Notifications: chat-style button + unread pill, opens the left sidebar. */}
          {onToggleNotifications && (
            <button
              type="button"
              onClick={() => { playPress(760); onToggleNotifications(); }}
              aria-label="Notifications"
              aria-expanded={notificationsOpen}
              className={`relative flex items-center gap-1 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-full text-xs font-medium transition ${notificationsOpen ? 'bg-glass-w15 text-retro-fg' : 'text-retro-muted hover:text-retro-fg hover:bg-glass-w8 active:scale-(--scale-press)'}`}
            >
              <Bell className="w-4 h-4" weight={notificationsOpen ? 'fill' : 'regular'} />
              {notificationCount > 0 && (
                <CountBadge count={notificationCount} label={`${notificationCount} unread notifications`} />
              )}
            </button>
          )}

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
            className={`relative flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-full text-xs font-medium transition ${
              messagesOpen || mainView === 'messages' || mainView === 'rooms'
                ? 'bg-glass-w15 text-retro-fg'
                : 'text-retro-muted hover:text-retro-fg hover:bg-glass-w8 active:scale-(--scale-press)'
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
            className={`relative flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded-full text-xs font-medium transition ${
              mainView === 'profile'
                ? 'bg-glass-w15 text-retro-fg'
                : 'text-retro-muted hover:text-retro-fg hover:bg-glass-w8 active:scale-(--scale-press)'
            }`}
          >
            <div className="w-5 h-5 rounded-full overflow-hidden border border-edge bg-black/40 flex items-center justify-center shrink-0">
              {profilePic ? (
                <img src={resolveMediaUrl(profilePic)} alt="" className="w-full h-full object-cover" />
              ) : (
                <User className="w-3.5 h-3.5" weight={mainView === 'profile' ? 'fill' : 'regular'} />
              )}
            </div>
            <span className="text-xs font-medium hidden md:inline">Profile</span>
          </button>



        <div className="h-4 w-[1px] bg-glass-w10 mx-0.5 shrink-0" />

        {/* More Options / Expand-Collapse Toggle */}
        <button
          type="button"
          onClick={toggleSatellite}
          aria-label="More options"
          aria-pressed={satelliteOpen}
          title={satelliteOpen ? 'Collapse extra tools' : 'Expand extra tools to the right'}
          className={`p-1.5 rounded-full transition shrink-0 active:scale-(--scale-press) ${
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
              className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium transition ${
                mainView === 'store'
                  ? 'bg-glass-w15 text-retro-fg'
                  : 'text-retro-muted hover:text-retro-fg hover:bg-glass-w8 active:scale-(--scale-press)'
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
              className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium transition ${
                mainView === 'servers'
                  ? 'bg-glass-w15 text-retro-fg'
                  : 'text-retro-muted hover:text-retro-fg hover:bg-glass-w8 active:scale-(--scale-press)'
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
              className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium transition ${
                mainView === 'pc_domination'
                  ? 'bg-glass-w15 text-retro-fg'
                  : 'text-retro-muted hover:text-retro-fg hover:bg-glass-w8 active:scale-(--scale-press)'
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
              className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium transition ${
                themeOpen
                  ? 'bg-glass-w15 text-retro-fg'
                  : 'text-retro-muted hover:text-retro-fg hover:bg-glass-w8 active:scale-(--scale-press)'
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
              className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium transition ${
                settingsOpen
                  ? 'bg-glass-w15 text-retro-fg'
                  : 'text-retro-muted hover:text-retro-fg hover:bg-glass-w8 active:scale-(--scale-press)'
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
              className="flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium text-retro-muted hover:text-retro-fg hover:bg-glass-w8 active:scale-(--scale-press) transition"
            >
              <Question className="w-3.5 h-3.5 shrink-0" />
              <span className="text-xs hidden xl:inline">Help</span>
            </button>

            {/* Community: the invite lives on the node's public settings, with
                a constant fallback so it is never buried in old chat. */}
            <button
              type="button"
              data-community-toggle="true"
              onClick={() => {
                playPress(740);
                openCommunityInvite(communityUrl);
              }}
              aria-label="Community"
              title="Join the community"
              className="flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium text-retro-muted hover:text-retro-fg hover:bg-glass-w8 active:scale-(--scale-press) transition"
            >
              <UsersThree className="w-3.5 h-3.5 shrink-0" />
              <span className="text-xs hidden xl:inline">Community</span>
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
                className="flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium text-retro-muted hover:text-retro-fg hover:bg-glass-w8 active:scale-(--scale-press) transition"
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
                  className="flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium text-retro-muted hover:text-retro-fg hover:bg-glass-w8 active:scale-(--scale-press) transition"
                >
                  <SignOut className="w-3.5 h-3.5 shrink-0" />
                  <span className="text-xs hidden xl:inline">Logout</span>
                </button>
              </>
            )}
          </div>
        )}
        </div>
      </nav>

      {/* The picker bubble renders OUTSIDE the pill so the island's own
          overflow/transform can never clip it; fixed above the island's
          center — the same spot as the Post button it belongs to. */}
        {postPickerOpen && onPickMedia && (
          <div
            ref={pickerBubbleRef}
            role="dialog"
            aria-label="Pick post media"
            className="fixed bottom-[calc(1.25rem+60px)] left-1/2 -translate-x-1/2 z-[var(--z-picker)] w-[340px] max-w-[calc(100vw-1.5rem)] animate-orbit-pop origin-bottom"
          >
            <MediaPickerPanel
              compact
              options={{ accept: ['image', 'video'], sources: ['browse', 'upload', 'url'], title: 'Pick post media' }}
              onPick={(sel) => { closePicker(); onPickMedia(sel); }}
              onClose={closePicker}
            />
            {/* Text-only posts have no media: one click opens the composer
                with an empty body instead of forcing a pick first. */}
            <button
              type="button"
              onClick={() => { closePicker(); onOpenCreatePost?.(); }}
              className="mt-1.5 w-full px-3 py-1.5 rounded-lg text-2xs font-medium text-retro-muted hover:text-retro-fg hover:bg-glass-w10 transition-colors cursor-pointer"
            >
              Write a text post
            </button>
          </div>
        )}
    </>
  );
}
