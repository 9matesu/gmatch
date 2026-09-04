"use client";

import { useEffect, useRef, useCallback } from "react";
import { subscribeOrbitWebSocket, sendOrbitWebSocket } from "../utils/orbitWebSocket";
import type { OrbitIdentity } from "@orbit/crypto";
import type { AdminState } from "../utils/adminTypes";

interface AdminWebSocketMessage {
  type: 'stats_update' | 'match_update' | 'report_update' | 'user_update' | 'chat_message' | 'announcement_update';
  payload: unknown;
  timestamp: number;
}

interface UseAdminWebSocketOptions {
  identity: OrbitIdentity | null;
  pinVerified: boolean;
  enabled?: boolean;
  onStatsUpdate?: (stats: AdminState['stats']) => void;
  onMatchUpdate?: (match: unknown) => void;
  onReportUpdate?: (report: unknown) => void;
  onUserUpdate?: (user: unknown) => void;
  onChatMessage?: (message: unknown) => void;
  onAnnouncementUpdate?: (announcement: unknown) => void;
}

export function useAdminWebSocket({
  identity,
  pinVerified,
  enabled = true,
  onStatsUpdate,
  onMatchUpdate,
  onReportUpdate,
  onUserUpdate,
  onChatMessage,
  onAnnouncementUpdate,
}: UseAdminWebSocketOptions) {
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const handlersRef = useRef({
    onStatsUpdate,
    onMatchUpdate,
    onReportUpdate,
    onUserUpdate,
    onChatMessage,
    onAnnouncementUpdate,
  });

  // Always update handlers ref - this effect runs on every render
  useEffect(() => {
    handlersRef.current = {
      onStatsUpdate,
      onMatchUpdate,
      onReportUpdate,
      onUserUpdate,
      onChatMessage,
      onAnnouncementUpdate,
    };
  }, [onStatsUpdate, onMatchUpdate, onReportUpdate, onUserUpdate, onChatMessage, onAnnouncementUpdate]);

  const handleMessage = useCallback((message: AdminWebSocketMessage) => {
    switch (message.type) {
      case 'stats_update':
        handlersRef.current.onStatsUpdate?.(message.payload as AdminState['stats']);
        break;
      case 'match_update':
        handlersRef.current.onMatchUpdate?.(message.payload);
        break;
      case 'report_update':
        handlersRef.current.onReportUpdate?.(message.payload);
        break;
      case 'user_update':
        handlersRef.current.onUserUpdate?.(message.payload);
        break;
      case 'chat_message':
        handlersRef.current.onChatMessage?.(message.payload);
        break;
      case 'announcement_update':
        handlersRef.current.onAnnouncementUpdate?.(message.payload);
        break;
    }
  }, []);

  // Main subscription effect - always runs cleanup to prevent hook order issues
  useEffect(() => {
    // Always clean up previous subscription first
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }

    // Only subscribe if enabled and authenticated
    if (!enabled || !identity || !pinVerified) {
      return;
    }

    unsubscribeRef.current = subscribeOrbitWebSocket(identity, handleMessage as (message: any) => void);

    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, [enabled, identity, pinVerified, handleMessage]);

  const sendMessage = useCallback((message: unknown) => {
    return sendOrbitWebSocket(message);
  }, []);

  return { sendMessage };
}