"use client";

import { useEffect, useCallback, useState, useRef } from 'react';
import { useIdentity } from './useIdentity';
import { useSettings } from './useSettings';
import type { LobbyState } from '@orbit/shared';
import { playMatchOnce, playMsgReceive, playQueueJoin, playPress } from '../utils/sounds';

/**
 * Mirrors the server's `NotificationType` (apps/api/src/notifications.ts:20).
 * It used to list 6 values, so like/follow/comment engagement never rendered
 * as a browser notification even when the row existed. Keep the two in sync.
 */
type ServerNotificationType =
  | 'match_invite' | 'match_result' | 'pm' | 'babecock_invite' | 'babecock_start'
  | 'like' | 'comment' | 'reply' | 'comment_like' | 'mention' | 'follow'
  | 'card_received' | 'card_purchase' | 'system';

interface NotificationData {
  /** `match_start` is legacy-local; the rest come straight off the server union. */
  type: ServerNotificationType | 'match_start';
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: {
    url?: string;
    matchId?: string;
    inviteId?: string;
    postId?: string;
    action?: string;
  };
  actions?: Array<{ action: string; title: string }>;
  requireInteraction?: boolean;
  sound?: string;
}

/** Engagement that should surface even when the app is in the background. */
const ENGAGEMENT_TYPES = new Set<ServerNotificationType>([
  'like', 'comment', 'reply', 'comment_like', 'mention', 'follow',
  'card_purchase', 'card_received',
]);

interface MatchInviteData {
  id: string;
  inviter_id: string;
  inviter_name: string;
  inviter_pfp?: string;
  expires_at: string;
}

export function useNotifications(lobbyState?: LobbyState | null) {
  const { identity } = useIdentity();
  const { settings } = useSettings();
  
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>('default');
  const [swRegistered, setSwRegistered] = useState(false);
  const permissionRequestedRef = useRef(false);
  const matchStartSoundPlayedRef = useRef(false);

  // Check notification permission on mount
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setNotificationPermission(Notification.permission);
    }
  }, []);

  // Live server pushes -> browser notification. `orbit-incoming-notification`
  // carries the whole notification row (useLobby dispatches it on the WS
  // `notification:new` frame). PMs and match invites are excluded: they have
  // their own channels and would double up.
  const showServerNotificationRef = useRef<
    ((row: { id?: string; type: string; title?: string; body?: string | null; data?: unknown }) => void) | null
  >(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onIncoming = (e: Event) => {
      const row = (e as CustomEvent<{ type?: string }>).detail;
      const type = row?.type;
      if (!type || type === 'pm' || type === 'match_invite') return;
      showServerNotificationRef.current?.({ ...row, type });
    };
    window.addEventListener('orbit-incoming-notification', onIncoming);
    return () => window.removeEventListener('orbit-incoming-notification', onIncoming);
  }, []);

  // Register Service Worker
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    let cancelled = false;

    const registerSW = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
        });
        
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                // New version available - could prompt user to refresh
              }
            });
          }
        });

        if (!cancelled) {
          setSwRegistered(true);
        }
      } catch {
      }
    };

    registerSW();

    return () => {
      cancelled = true;
    };
  }, []);

  // Request notification permission on user gesture (e.g., joining queue)
  const requestNotificationPermission = useCallback(async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) return false;
    if (permissionRequestedRef.current) return Notification.permission === 'granted';
    
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;

    permissionRequestedRef.current = true;
    
    try {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
      return permission === 'granted';
    } catch {
      return false;
    }
  }, []);

  // Play SFX via main thread (can be called from anywhere)
  const playSFX = useCallback((soundType: 'match' | 'message' | 'queue' | 'press') => {
    if (!settings.soundEffects) return;
    
    switch (soundType) {
      case 'match':
        playMatchOnce();
        break;
      case 'message':
        playMsgReceive();
        break;
      case 'queue':
        playQueueJoin();
        break;
      case 'press':
      default:
        playPress();
        break;
    }
  }, [settings.soundEffects]);

  // Show browser notification via Service Worker
  const showBrowserNotification = useCallback(async (notification: NotificationData) => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    
    if (Notification.permission !== 'granted') return;

    try {
      const registration = await navigator.serviceWorker.ready;
      
      await registration.showNotification(notification.title, {
        body: notification.body,
        icon: notification.icon || '/icon-192.png',
        badge: notification.badge || '/badge-72.png',
        tag: notification.tag || 'goonmatch-notification',
        data: notification.data || {},
        // @ts-expect-error - actions is not in TypeScript's NotificationOptions but is supported by browsers
        actions: notification.actions || [],
        requireInteraction: notification.requireInteraction ?? true,
        vibrate: [200, 100, 200],
        timestamp: Date.now(),
      });

      // Trigger SFX via BroadcastChannel to main thread
      if (notification.sound) {
        const channel = new BroadcastChannel('goonmatch-sfx');
        channel.postMessage({ type: 'PLAY_SOUND', sound: notification.sound });
        channel.close();
      }
    } catch {
    }
  }, []);

  // Show a server notification row (likes, follows, comments, ...) as a browser
  // notification. This path did not exist: engagement rows were written by the
  // server but only ever rendered inside the in-app bell, so a backgrounded
  // tab showed nothing at all.
  const showServerNotification = useCallback((row: {
    id?: string
    type: string
    title?: string
    body?: string | null
    data?: unknown
  }) => {
    if (!row?.title) return
    const type = row.type as ServerNotificationType
    const data = (typeof row.data === 'string'
      ? (() => { try { return JSON.parse(row.data) as Record<string, unknown> } catch { return {} } })()
      : (row.data as Record<string, unknown> | undefined)) || {}
    const postId = typeof data.post_id === 'string' ? data.post_id : undefined
    showBrowserNotification({
      type,
      title: row.title,
      body: row.body || '',
      tag: `gmatch-${type}-${row.id ?? ''}`,
      data: postId ? { postId, action: type } : { action: type },
      // Engagement is FYI: don't demand interaction, or the tab keeps a
      // notification parked on screen forever.
      requireInteraction: !ENGAGEMENT_TYPES.has(type),
      sound: ENGAGEMENT_TYPES.has(type) ? 'like' : undefined,
    })
  }, [showBrowserNotification]);
  showServerNotificationRef.current = showServerNotification;

  // Show match invite notification
  const showMatchInviteNotification = useCallback((invite: MatchInviteData) => {
    showBrowserNotification({
      type: 'match_invite',
      title: 'Match Invitation',
      body: `${invite.inviter_name} invited you to a match`,
      icon: invite.inviter_pfp || '/icon-192.png',
      tag: `match-invite-${invite.id}`,
      data: {
        url: `/match/${invite.id}`,
        inviteId: invite.id,
        action: 'match_invite',
      },
      actions: [
        { action: 'accept', title: 'Accept' },
        { action: 'decline', title: 'Decline' },
      ],
      requireInteraction: true,
      sound: 'match',
    });
  }, []);

  // Show match start notification
  const showMatchStartNotification = useCallback((matchId: string, opponentName: string) => {
    showBrowserNotification({
      type: 'match_start',
      title: 'Match Started!',
      body: `Your match against ${opponentName} has begun`,
      icon: '/icon-192.png',
      tag: `match-start-${matchId}`,
      data: {
        url: `/match/${matchId}`,
        matchId,
        action: 'match_start',
      },
      requireInteraction: true,
      sound: 'match',
    });
  }, []);

  // Show match result notification
  const showMatchResultNotification = useCallback((
    matchId: string, 
    won: boolean, 
    opponentName: string
  ) => {
    showBrowserNotification({
      type: 'match_result',
      title: won ? 'Victory!' : 'Defeat',
      body: won 
        ? `You defeated ${opponentName}!` 
        : `${opponentName} defeated you.`,
      icon: '/icon-192.png',
      tag: `match-result-${matchId}`,
      data: {
        url: `/match/${matchId}`,
        matchId,
        action: 'match_result',
      },
      requireInteraction: true,
      sound: 'match',
    });
  }, []);

  // Show private message notification
  const showPMNotification = useCallback((senderName: string, preview: string, url: string) => {
    showBrowserNotification({
      type: 'pm',
      title: `New message from ${senderName}`,
      body: preview,
      icon: '/icon-192.png',
      tag: `pm-${senderName}`,
      data: {
        url,
        action: 'pm',
      },
      requireInteraction: false,
      sound: 'message',
    });
  }, []);

  // Focus window and navigate to URL
  const focusAndNavigate = useCallback((url: string) => {
    if (typeof window !== 'undefined') {
      window.focus();
      if (window.location.href !== url) {
        window.location.href = url;
      }
    }
  }, []);

  // Handle match start - play SFX and show notification if tab hidden
  useEffect(() => {
    if (!lobbyState?.match) {
      matchStartSoundPlayedRef.current = false;
      return;
    }

    // Play match start SFX only when tab is in background (foreground is handled by MatchRoundPanel)
    if (!matchStartSoundPlayedRef.current && settings.soundEffects && typeof document !== 'undefined' && document.hidden) {
      playMatchOnce();
      matchStartSoundPlayedRef.current = true;
    }

    // If tab is hidden, show browser notification
    if (typeof document !== 'undefined' && document.hidden) {
      const match = lobbyState.match;
      const opponent = match.opponent;
      showBrowserNotification({
        type: 'match_start',
        title: 'Match Started!',
        body: `Your match against ${opponent?.display_name || 'opponent'} has begun`,
        icon: '/icon-192.png',
        tag: `match-start-${match.id}`,
        data: {
          url: `/match/${match.id}`,
          matchId: match.id,
          action: 'match_start',
        },
        requireInteraction: true,
        sound: 'match',
      });
    }
  }, [lobbyState?.match, identity, settings.soundEffects]);

  // Handle incoming invite - show notification if tab hidden
  useEffect(() => {
    if (!identity) return;

    const handleInvite = (e: CustomEvent) => {
      const invite = e.detail as MatchInviteData;
      
      // Always play sound for invites
      if (settings.soundEffects) {
        playMsgReceive();
      }

      // Show browser notification if tab hidden
      if (typeof document !== 'undefined' && document.hidden) {
        showBrowserNotification({
          type: 'match_invite',
          title: 'Match Invitation',
          body: `${invite.inviter_name} invited you to a match`,
          icon: invite.inviter_pfp || '/icon-192.png',
          tag: `match-invite-${invite.id}`,
          data: {
            url: `/match/${invite.id}`,
            inviteId: invite.id,
            action: 'match_invite',
          },
          actions: [
            { action: 'accept', title: 'Accept' },
            { action: 'decline', title: 'Decline' },
          ],
          requireInteraction: true,
          sound: 'match',
        });
      }
    };

    window.addEventListener('orbit-invite-new', handleInvite as EventListener);
    return () => window.removeEventListener('orbit-invite-new', handleInvite as EventListener);
  }, [identity, settings.soundEffects]);

  // Listen for SFX broadcast from SW
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const channel = new BroadcastChannel('goonmatch-sfx');
    
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'PLAY_SOUND' && settings.soundEffects) {
        const soundMap: Record<string, () => void> = {
          match: playMatchOnce,
          message: playMsgReceive,
          queue: playQueueJoin,
          press: playPress,
        };
        const playFn = soundMap[event.data.sound];
        if (playFn) playFn();
      }
    };

    channel.addEventListener('message', handleMessage);
    return () => {
      channel.removeEventListener('message', handleMessage);
      channel.close();
    };
  }, [settings.soundEffects]);

  // Handle Page Visibility - focus tab when match starts if we have a match
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden && lobbyState?.match) {
        // Tab became visible while in match - reset sound played flag
        matchStartSoundPlayedRef.current = false;
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [lobbyState?.match]);

  return {
    notificationPermission,
    swRegistered,
    requestNotificationPermission,
    showBrowserNotification,
    showMatchInviteNotification,
    showMatchStartNotification,
    showMatchResultNotification,
    showPMNotification,
    showServerNotification,
    playSFX,
    focusAndNavigate,
  };
}