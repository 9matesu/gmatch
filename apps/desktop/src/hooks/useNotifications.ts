"use client";

import { useEffect, useCallback, useState, useRef } from 'react';
import { useIdentity } from './useIdentity';
import { useSettings } from './useSettings';
import type { LobbyState } from '@orbit/shared';
import { orbitFetch } from '../utils/api';
import { playMatch, playMsgReceive, playQueueJoin, playPress } from '../utils/sounds';

interface NotificationData {
  type: 'match_invite' | 'match_start' | 'match_result' | 'pm' | 'babecock_invite' | 'system';
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: {
    url?: string;
    matchId?: string;
    inviteId?: string;
    action?: string;
  };
  actions?: Array<{ action: string; title: string }>;
  requireInteraction?: boolean;
  sound?: string;
}

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
      } catch (err) {
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
    } catch (err) {
      return false;
    }
  }, []);

  // Play SFX via main thread (can be called from anywhere)
  const playSFX = useCallback((soundType: 'match' | 'message' | 'queue' | 'press') => {
    if (!settings.soundEffects) return;
    
    switch (soundType) {
      case 'match':
        playMatch();
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
    } catch (err) {
    }
  }, []);

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
      playMatch();
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
          match: playMatch,
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
    playSFX,
    focusAndNavigate,
  };
}