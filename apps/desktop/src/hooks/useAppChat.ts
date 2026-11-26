/**
 * The chat lane of the App shell (extracted from App.tsx, behavior unchanged).
 *
 * Owns the sealed courier wiring (DMs + rooms), the PM/group loaders and
 * senders, the unread derivations and the courier half of the notification
 * centre. App-declared state (threads, seen stamps, modals) is threaded in
 * through the context object; hook-owned state (roomTick, groups, transport
 * labels) is returned.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type * as React from 'react'
import type { OrbitIdentity } from '@orbit/crypto'
import type { AppSettings } from './useSettings'
import { getApiBaseUrl, orbitFetch } from '../utils/api'
import { courierThreadToChatMessages, chatRowEqual } from '../utils/courierChat'
import { countChatUnread, countThreadUnread } from '../utils/chatUnread'
import { countMentions, createMentionMatcher } from '../utils/mentions'
import { saveSeen, readScopedJson, writeScopedJson } from '../utils/scopedSeen'
import { useNotificationCenter } from './useNotificationCenter'
import type { AppNotification } from '../utils/notifications'
import type { useNotifications } from './useNotifications'
import type { useLobby } from './useLobby'
import { userFacingError } from '../utils/userError'
import type { ChatMessage } from './useP2P'
import { generateFallbackName, type User } from '@orbit/shared'
import { parseApiTimestamp } from '../utils/timeAgo'
import { findUserById } from '../utils/userLookup'
import { toChatPeer, type ChatPeer } from '../components/chat/chatPeer'
import { buildPreviewRows } from '../components/chat/RoomsPreview'
import type { GroupMember } from '../components/chat/GroupMembersPopover'
import { cachedMailMode, detectMailMode } from '../utils/mail-mode'
import { useCourierDms } from './useCourierDms'
import { usePeerReports } from './usePeerReports'
import { ensureGroupRoom, mergeGroupMessages, roomIdForGroup, type GroupRoomOps } from '../services/groupRooms'
import { usePresence } from '../game/presenceStore'
import { DOM_ACTION_CONSENT } from '../utils/dominationMesh'
import { playChime, playMsgReceive } from '../utils/sounds'
import { resolveDisplayName, UNKNOWN_NAME } from '../utils/displayName'
import type { toNameRoster } from '../utils/displayName'
import type { MainViewType } from '../components/home/CommandIsland'

import { logger } from '../utils/logger'
const DM_SEEN_KEY = 'gmatch_dm_seen_v1';
const ROOM_SEEN_KEY = 'gmatch_room_seen_v1';
const LAST_DM_PEER_KEY = 'gmatch_last_dm_peer_v1';

export interface AppChatContext {
  identity: OrbitIdentity | null
  settings: AppSettings
  toast: (text: string, type?: 'success' | 'error' | 'info' | 'warning') => void
  notifications: ReturnType<typeof useNotifications>
  users: User[]
  usersRef: React.RefObject<User[]>
  peers: User[]
  nameRoster: ReturnType<typeof toNameRoster>
  myProfile: { displayName: string; tags: string[] }
  chatOpen: boolean
  mainView: MainViewType
  handleSetMainView: (view: MainViewType) => void
  roomSeen: Record<string, number>
  setRoomSeen: React.Dispatch<React.SetStateAction<Record<string, number>>>
  dmSeen: Record<string, number>
  setDmSeen: React.Dispatch<React.SetStateAction<Record<string, number>>>
  seenScopeRef: React.RefObject<string | null>
  stampDmSeen: (peerId: string) => void
  pmPeer: ChatPeer | null
  setPmPeer: React.Dispatch<React.SetStateAction<ChatPeer | null>>
  pmPeerId: string
  pmMessagesByPeer?: Record<string, ChatMessage[]>
  setPmMessagesByPeer: React.Dispatch<React.SetStateAction<Record<string, ChatMessage[]>>>
  pmThreads: {
    peer_id: string
    peer_name?: string | null
    last_id?: string
    last_body?: string
    last_sender_id?: string
    last_created_at?: string
  }[]
  setPmThreads: React.Dispatch<React.SetStateAction<{
    peer_id: string
    peer_name?: string | null
    last_id?: string
    last_body?: string
    last_sender_id?: string
    last_created_at?: string
  }[]>>
  pmUnreadCount: number
  setPmUnreadCount: React.Dispatch<React.SetStateAction<number>>
  attachmentModal: {
    isOpen: boolean
    target: 'pm' | 'group' | 'lobby'
    peerId?: string
    groupId?: string
    replyToId?: string
    initialFiles?: File[]
    initialUrl?: string
  } | null
  setAttachmentModal: React.Dispatch<React.SetStateAction<{
    isOpen: boolean
    target: 'pm' | 'group' | 'lobby'
    peerId?: string
    groupId?: string
    replyToId?: string
    initialFiles?: File[]
    initialUrl?: string
  } | null>>
  groupPickerOpen?: boolean
  setGroupPickerOpen: React.Dispatch<React.SetStateAction<boolean>>
  activeGroupId: string | null
  setActiveGroupId: React.Dispatch<React.SetStateAction<string | null>>
  setActiveRoomId: React.Dispatch<React.SetStateAction<string | null>>
  chatMessages: ChatMessage[]
  lobby: ReturnType<typeof useLobby>
  sendChatMessage: (text: string, channel?: string, attachment?: { id: string; url: string; isVideo?: boolean }) => void
}
export function useAppChat(ctx: AppChatContext) {
  const {
    identity,
    settings,
    toast,
    notifications,
    users,
    usersRef,
    peers,
    nameRoster,
    myProfile,
    chatOpen,
    mainView,
    handleSetMainView,
    roomSeen,
    setRoomSeen,
    dmSeen,
    setDmSeen,
    seenScopeRef,
    stampDmSeen,
    pmPeer,
    setPmPeer,
    pmPeerId,
    setPmMessagesByPeer,
    pmThreads,
    setPmThreads,
    pmUnreadCount,
    setPmUnreadCount,
    attachmentModal,
    setAttachmentModal,
    setGroupPickerOpen,
    activeGroupId,
    setActiveGroupId,
    setActiveRoomId,
    chatMessages,
    lobby,
    sendChatMessage,
  } = ctx

  const courier = useCourierDms(identity, {
    dominationConsent: (action: string) => {
      // Receiver-side consent authority for mesh domination (Fase 5/6):
      // the local settings map decides, never the server.
      const key = DOM_ACTION_CONSENT[action];
      return key ? (settings as unknown as Record<string, unknown>)[key] === true : false;
    },
    onNotify: (msg) => {
      if (settings.chatNotificationSfx) playMsgReceive()
      const name = usersRef.current.find((u) => u.id === msg.peerId)?.display_name || 'Someone'
      toast(`${name} sent you a message`, 'info')
      // Hidden window: the in-app toast is invisible, so surface an OS
      // notification instead. Sender name ONLY — the body of a sealed DM must
      // never land on a lock screen (privacy posture, SPEC §10d).
      if (typeof document !== 'undefined' && document.hidden) {
        void notifications.showBrowserNotification({
          type: 'pm',
          title: `New message from ${name}`,
          body: '',
          tag: `dm-${msg.peerId}`,
          requireInteraction: false,
          sound: 'message',
        })
      }
    },
    onRoomMessage: (msg, room) => {
      setRoomTick((t) => t + 1)
      if (msg.senderOrbitId === identity?.orbitId) return
      if (settings.chatNotificationSfx) playMsgReceive()
      const name = usersRef.current.find((u) => u.id === msg.senderOrbitId)?.display_name || 'Someone'
      toast(`${name} → ${room.name}`, 'info')
      // Same reasoning as DMs: one notification per room (tag), name only.
      if (typeof document !== 'undefined' && document.hidden) {
        void notifications.showBrowserNotification({
          type: 'pm',
          title: `New message in ${room.name}`,
          body: '',
          tag: `room-${room.id}`,
          requireInteraction: false,
          sound: 'message',
        })
      }
    },
  })
  // Keep the courier's TOFU key registry stocked from the user directory.
  // Destructured stable members: the hook returns a fresh object each render,
  // so never put `courier` itself in a dependency array.
  const courierActive = courier.courierActive
  const registerCourierKeys = courier.registerPeerKeys
  const courierPull = courier.pull
  const courierThreadFor = courier.threadFor
  const courierSend = courier.send
  const courierMarkRead = courier.markRead
  const courierEdit = courier.edit
  const courierRemove = courier.remove
  const courierReact = courier.react
  const courierType = courier.type
  const courierIsTyping = courier.isTyping
  const meshSend = courier.meshSend
  const peerAddressable = courier.peerAddressable
  useEffect(() => {
    if (!courierActive) return
    // Courier nodes serve no directory (`/api/users` 404s at the blind
    // courier): the PRESENCE ROSTER is the key source out here. Beacons
    // carry each peer's Ed25519 + X25519 keys and are signature-verified
    // before entering the roster — exactly what first-contact sealing
    // needs. TOFU from inbound mail covers the reply direction; this
    // covers the first outbound DM/effect to a peer never written before.
    for (const u of users) {
      if (u.publicKey && u.encryptionPubKey) {
        registerCourierKeys(u.id, u.publicKey, u.encryptionPubKey)
      }
    }
    for (const p of peers) {
      if (p.publicKey && p.encryptionPubKey) {
        registerCourierKeys(p.id, p.publicKey, p.encryptionPubKey)
      }
    }
    // The chat player list reads the shared presence store, whose poller
    // hits `/api/servers/dashboard` — another route the courier 404s.
    // The roster IS the courier-mode presence feed: ingest it so peers
    // are visible and PM-able at all out here.
    if (peers.length > 0) usePresence.getState().ingest(peers)
  }, [users, peers, courierActive, registerCourierKeys])

  // Courier mode owns the thread list locally (sealed E2EE store; the server
  // is blind by design, /api/pm/threads is dead). Legacy nodes keep the fetch.
  useEffect(() => {
    if (!courierActive || !identity) return
    const rows = Object.values(courier.threads)
      .filter((th) => th.length)
      .map((th) => {
        const last = th[th.length - 1]
        return {
          peer_id: last.peerId,
          peer_name: null, // GMatchDMs.displayNameFor resolves it from the users prop
          last_id: last.id,
          last_body: last.text,
          last_sender_id: last.own ? identity.orbitId : last.peerId,
          last_created_at: new Date(last.ts).toISOString(),
        }
      })
      .sort((a, b) => (b.last_created_at || '').localeCompare(a.last_created_at || ''))
    setPmThreads(rows)
  }, [courierActive, courier.threads, identity])

  const loadPmThreads = useCallback(() => {
    if (!identity) return Promise.resolve()
    const base = getApiBaseUrl()
    // Await the mode probe before deciding: firing the legacy fetch while
    // the cache is still empty 404-spams the console on courier-only nodes.
    return detectMailMode(base).then((mode) => {
      if (courierActive || mode === 'courier') return
      return orbitFetch(`/api/pm/threads?_t=${Date.now()}`, {}, identity)
        .then(async (res) => {
          if (!res.ok) return
          const data = await res.json()
          if (Array.isArray(data)) {
            setPmThreads(data)
          }
        })
        .catch(() => { })
    })
  }, [identity, courierActive])

  // ─── Unified rooms chat (rooms ARE the chat system; dock shows a preview) ───
  const chatRooms = useMemo(
    () => courier.rooms.map((r) => ({ id: r.id, name: r.name, ownerId: r.ownerId, members: r.members, epoch: r.epoch, seenAt: roomSeen[r.id] })),
    [courier.rooms, roomSeen]
  )
  // RoomMessage -> ChatMessage adapter so the existing thread renderer/blocks
  // work untouched for sealed rooms.
  //
  // The name comes from the message itself (sealed into the room payload by
  // RoomManager.say). This used to hardcode `senderName: ''`, which combined
  // with the renderer's roster fallback is why EVERY room sender showed up as
  // "User" — a room member is often absent from the capped /api/users page, and
  // the room's own roster only carries orbit ids, never names.
  const chatRoomMessages = useCallback((roomId: string): ChatMessage[] =>
    courier.roomMessages(roomId).map((m) => ({
      id: m.id,
      senderId: m.senderOrbitId,
      senderName: m.displayName ?? '',
      text: m.text,
      timestamp: m.ts,
    })), [courier.roomMessages])
  const openRoomChat = useCallback((roomId: string | null) => {
    setActiveRoomId(roomId)
    if (roomId) {
      setRoomSeen((prev) => {
        const next = { ...prev, [roomId]: Date.now() }
        saveSeen(ROOM_SEEN_KEY, seenScopeRef.current, next)
        return next
      })
    }
  }, [])
  // courier.roomMessages reads a mutable local store; bump this on every
  // incoming room message so the preview/unread memos recompute.
  const [roomTick, setRoomTick] = useState(0)
  const roomUnread = useCallback((roomId: string): boolean => {
    const last = courier.roomMessages(roomId).slice(-1)[0]
    return !!last && last.ts > (roomSeen[roomId] || 0) && last.senderOrbitId !== identity?.orbitId
  }, [courier.roomMessages, roomSeen, identity?.orbitId, roomTick])

  // Chat badge: total NEW inbound messages across courier DM threads and
  // sealed rooms (both local-only lanes) plus the legacy server lane.
  // Recomputes live as threads/rooms arrive via the existing courier state.
  const chatUnreadCount = useMemo(() => countChatUnread({
    threads: courier.threads,
    dmSeen,
    roomIds: courier.rooms.map((r) => r.id),
    roomMessages: (id) => courier.roomMessages(id),
    roomSeen,
    selfId: identity?.orbitId,
    serverUnread: pmUnreadCount,
  }), [courier.threads, courier.rooms, courier.roomMessages, roomTick, dmSeen, roomSeen, pmUnreadCount, identity?.orbitId])

  // Per-conversation unread + mention counts. ONE source: the courier threads
  // and the shared `dmSeen` stamp. The chat component used to keep its own
  // `orbit_read_dms` set, so a thread marked read once never went unread again.
  const dmUnreadByPeer = useMemo(() => {
    const out: Record<string, number> = {}
    for (const [peerId, thread] of Object.entries(courier.threads)) {
      const n = countThreadUnread(thread, dmSeen[peerId], identity?.orbitId)
      if (n > 0) out[peerId] = n
    }
    return out
  }, [courier.threads, dmSeen, identity?.orbitId])

  const dmMentionByPeer = useMemo(() => {
    if (!identity) return {} as Record<string, number>
    const matcher = createMentionMatcher({ displayName: myProfile.displayName, orbitId: identity.orbitId })
    const out: Record<string, number> = {}
    for (const [peerId, thread] of Object.entries(courier.threads)) {
      const n = countMentions(thread, matcher, dmSeen[peerId] ?? 0)
      if (n > 0) out[peerId] = n
    }
    return out
  }, [courier.threads, dmSeen, identity, myProfile.displayName])

  // ─── Notification centre: ONE owner of the unread badge ───
  // Merges the server's persistent rows (likes/comments/replies/mentions/
  // follows/card/match) with rows derived from the sealed courier lanes (DMs,
  // rooms). The badge is derived from the merged items, so it can never
  // disagree with the list behind it — the defect the WS frame path had, where
  // the list grew but `unreadCount` did not.
  //
  // Both callbacks are stable so the derive memo (which walks every thread and
  // room) is not thrown away on every unrelated re-render.
  const resolveNotifyName = useCallback(
    (peerId: string, payloadName?: string) => {
      const resolved = resolveDisplayName({
        selfId: identity?.orbitId ?? null,
        senderId: peerId,
        payloadName,
        roster: nameRoster,
      })
      // "Unknown User" carries no information; the readable handle names the
      // conversation the player is about to open without exposing a raw id.
      return resolved === UNKNOWN_NAME ? generateFallbackName(peerId) : resolved
    },
    [identity?.orbitId, nameRoster],
  )
  // Reports about my own content (peer lane): in a mesh the author is the
  // one who can act on a report, so it belongs in the same centre.
  const peerReports = usePeerReports(identity?.orbitId)
  const notificationCenter = useNotificationCenter({
    rows: lobby.notifications,
    peerReports,
    threads: courier.threads,
    dmSeen,
    rooms: courier.rooms,
    // Stable references (the derive memo walks every thread and room, so an
    // inline closure here would invalidate it on every unrelated re-render):
    // `courier.roomMessages` is a `useCallback([])`, `resolveNotifyName` is
    // memoized above.
    roomMessages: courier.roomMessages,
    roomSeen,
    selfId: identity?.orbitId ?? null,
    selfName: myProfile.displayName,
    resolveName: resolveNotifyName,
    version: roomTick,
  })

  // Tapping a courier row marks that conversation read — the SAME stamp the
  // chat badge reads, so opening a notification and opening the chat agree.
  const openLocalNotification = useCallback((item: AppNotification) => {
    if (item.type === 'room' && item.target.roomId) {
      const room = courier.rooms.find((r) => r.id === item.target.roomId)
      if (!room) {
        // Room is gone (the client only remembers what it joined): say so
        // instead of navigating into an empty view.
        toast('That room is no longer available.', 'warning')
        return
      }
      openRoomChat(room.id)
      handleSetMainView('rooms')
      return
    }
    const peerId = item.target.conversationId
    if (!peerId) return
    stampDmSeen(peerId)
    const known = findUserById(users, peerId)
    setPmPeer(toChatPeer(known) || toChatPeer({ orbitId: peerId, name: item.actorName || generateFallbackName(peerId) }))
    handleSetMainView('messages')
  }, [courier.rooms, openRoomChat, stampDmSeen, users, toast])

  // Mark the courier lanes read for the row(s) tapped.
  const markLocalNotificationsRead = useCallback((keys: string[]) => {
    const now = Date.now()
    setDmSeen((prev) => {
      const next = { ...prev }
      let changed = false
      for (const key of keys) {
        if (!key.startsWith('dm:')) continue
        next[key.slice(3)] = now
        changed = true
      }
      if (changed) saveSeen(DM_SEEN_KEY, seenScopeRef.current, next)
      return changed ? next : prev
    })
    setRoomSeen((prev) => {
      const next = { ...prev }
      let changed = false
      for (const key of keys) {
        if (!key.startsWith('room:')) continue
        next[key.slice(5)] = now
        changed = true
      }
      if (changed) saveSeen(ROOM_SEEN_KEY, seenScopeRef.current, next)
      return changed ? next : prev
    })
  }, [])



  const loadPmUnreadCount = useCallback(() => {
    if (!identity) return Promise.resolve()
    // Same courier gate as loadPmThreads: the legacy route is 404 on official
    // nodes; probing it every poll is the console-spam report.
    return detectMailMode(getApiBaseUrl()).then((mode) => {
      if (mode === 'courier') { setPmUnreadCount(0); return }
      return orbitFetch(`/api/pm/unread-count?_t=${Date.now()}`, {}, identity)
        .then(async (res) => {
          if (!res.ok) return
          const data = await res.json()
          setPmUnreadCount(Math.max(0, Number(data?.count || 0)))
        })
    }).catch(() => { })
  }, [identity])

  // Opening chat clears its badge: stamp all sealed rooms + all courier DM
  // threads seen, plus best-effort per-thread legacy read, then reconcile
  // the server count. Optimistically zero first so the badge clears
  // instantly even if a call fails.
  const markAllChatRead = useCallback(() => {
    const now = Date.now();
    setRoomSeen((prev) => {
      const next = { ...prev };
      for (const r of courier.rooms) next[r.id] = now;
      saveSeen(ROOM_SEEN_KEY, seenScopeRef.current, next);
      return next;
    });
    setDmSeen((prev) => {
      const next = { ...prev };
      for (const peerId of Object.keys(courier.threads)) next[peerId] = now;
      saveSeen(DM_SEEN_KEY, seenScopeRef.current, next);
      return next;
    });
    setPmUnreadCount(0);
  }, [courier])

  const loadPmMessages = useCallback((peerId: string) => {
    if (!identity) return Promise.resolve()
    // Courier mode: the thread lives in our local store; a "load" is a pull.
    if (courierActive) {
      return (async () => {
        await courierPull()
        stampDmSeen(peerId)
        const thread = courierThreadFor(peerId) || []
        // `m.senderName` is the name sealed into the DM body, so a peer who is
        // not in the capped /api/users page still renders by name.
        const msgs = courierThreadToChatMessages({
          thread,
          peerId,
          selfId: identity.orbitId,
          resolveName: (payloadName, senderId) =>
            resolveDisplayName({ selfId: identity.orbitId, senderId, payloadName, roster: nameRoster }),
        })
        setPmMessagesByPeer((prev) => {
          const before = prev[peerId]
          if (before && before.length === msgs.length && before.every((m, i) => chatRowEqual(m, msgs[i]))) return prev
          return { ...prev, [peerId]: msgs }
        })
      })()
    }
    if (peerId !== 'global_lobby' && peerId !== 'card_queue') {
      // Server /api/pm/read is retired; unread state tracked locally
      void loadPmUnreadCount();
    }
    // Await the mode probe before deciding: firing the legacy fetch while the
    // node is courier-only 404-spams the console (same gate as loadPmThreads).
    return detectMailMode(getApiBaseUrl()).then((mode) => {
      if (mode === 'courier') return
      return orbitFetch(`/api/pm?peer=${encodeURIComponent(peerId)}&_t=${Date.now()}`, {}, identity)
      .then(async (res) => {
        if (!res.ok) return
        const data = await res.json()
        if (Array.isArray(data)) {
          const msgs: ChatMessage[] = data.map((m: any) => ({
            id: m.id,
            senderId: m.sender_id,
            senderName: resolveDisplayName({
              selfId: identity.orbitId,
              senderId: m.sender_id,
              payloadName: m.sender_name,
              roster: nameRoster,
            }),
            text: m.body,
            timestamp: parseApiTimestamp(m.created_at)?.getTime() || Date.now(),
            replyToId: m.reply_to || undefined,
            attachmentId: m.attachment_id || undefined,
            attachmentUrl: m.attachment_id ? `/api/objects/${m.attachment_id}` : undefined,
            attachmentMime: m.attachment_mime || undefined,
            editedAt: m.edited_at || undefined,
            readByRecipient: Boolean(m.read_by_recipient),
          })).sort((a: ChatMessage, b: ChatMessage) => a.timestamp - b.timestamp)
          setPmMessagesByPeer(prev => {
            const existing = prev[peerId] || []
            const serverIds = new Set(msgs.map(m => m.id))
            // Preserve unconfirmed local (optimistic) messages that the server
            // hasn't returned yet so sends never visibly vanish mid-refetch.
            const pendingLocal = existing.filter(m => m.id.startsWith('local_') && !serverIds.has(m.id))
            return { ...prev, [peerId]: [...msgs, ...pendingLocal].sort((a, b) => a.timestamp - b.timestamp) }
          })
        }
      })
      .catch(() => { })
    })
  }, [identity, users, myProfile.displayName, loadPmUnreadCount, courierActive, courierPull, courierThreadFor, courierMarkRead, stampDmSeen])

  // Courier threads ARE the local source of truth. Mirror the open thread into
  // the chat shape whenever the store changes — send, inbound, edit, delete,
  // reaction, read watermark — so the bubble reflects the actual record instead
  // of waiting for a manual reload.
  useEffect(() => {
    if (!courierActive || !identity || !pmPeerId) return
    if (pmPeerId === 'global_lobby' || pmPeerId === 'card_queue') return
    const thread = courierThreadFor(pmPeerId)
    if (!thread) return
    const msgs = courierThreadToChatMessages({
      thread,
      peerId: pmPeerId,
      selfId: identity.orbitId,
      resolveName: (payloadName, senderId) =>
        resolveDisplayName({ selfId: identity.orbitId, senderId, payloadName, roster: nameRoster }),
    })
    setPmMessagesByPeer((prev) => {
      const before = prev[pmPeerId]
      if (before && before.length === msgs.length && before.every((m, i) => chatRowEqual(m, msgs[i]))) return prev
      return { ...prev, [pmPeerId]: msgs }
    })
  }, [courier.threads, courierActive, identity, pmPeerId, courierThreadFor, nameRoster])

  /** Newest inbound (not deleted) message in the open conversation. */
  const pmLastInboundTs = useMemo(() => {
    if (!courierActive || !pmPeerId) return 0
    const thread = courierThreadFor(pmPeerId) || []
    for (let i = thread.length - 1; i >= 0; i -= 1) {
      const m = thread[i]
      if (!m.own && !m.deletedTs) return m.ts
    }
    return 0
  }, [courier.threads, courierActive, pmPeerId, courierThreadFor])

  // Read watermark — only while the conversation is actually in front of the
  // player, in the chat view, on a visible document. It was stamped inside the
  // loader, which also runs when the conversation is restored at boot: the peer
  // was told "Seen" for a thread nobody had looked at.
  useEffect(() => {
    if (!courierActive || !identity || !pmPeerId) return
    if (pmPeerId === 'global_lobby' || pmPeerId === 'card_queue') return
    if (pmLastInboundTs <= 0) return
    if (!(mainView === 'messages' || mainView === 'rooms' || chatOpen)) return
    const commit = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      courierMarkRead(pmPeerId, pmLastInboundTs)
      stampDmSeen(pmPeerId)
    }
    commit()
    document.addEventListener('visibilitychange', commit)
    return () => document.removeEventListener('visibilitychange', commit)
  }, [courierActive, identity, pmPeerId, pmLastInboundTs, mainView, chatOpen, courierMarkRead, stampDmSeen])

  // Reopen the last conversation on boot. The chat used to drop back to the
  // empty thread list every launch, which reads as "my history is gone" even
  // though the local threads were intact.
  useEffect(() => {
    try {
      if (pmPeer && pmPeer.id !== 'global_lobby' && pmPeer.id !== 'card_queue') {
        // Identity-scoped: the other account on this install must not reopen
        // this conversation on its next boot.
        writeScopedJson(LAST_DM_PEER_KEY, identity?.orbitId ?? null, pmPeer)
      }
      // Closing a conversation deliberately does NOT clear the mirror: the
      // point is to reopen where the player was, and boot runs this before the
      // restore effect (clearing here would erase the pointer first).
    } catch { /* private mode: remembering is a nicety */ }
  }, [pmPeer, identity?.orbitId])

  const restoredPeerRef = useRef(false)
  useEffect(() => {
    if (restoredPeerRef.current || !identity || pmPeer) return
    restoredPeerRef.current = true
    const stored = readScopedJson<{ id?: string; name?: string; pfp?: string } | null>(
      LAST_DM_PEER_KEY,
      identity.orbitId,
      null,
    )
    if (!stored) return
    const peer = toChatPeer(stored)
    if (!peer) return
    setPmPeer(peer)
    void loadPmMessages(peer.id)
  }, [identity, pmPeer, loadPmMessages])

  const sendPm = useCallback(async (peerId: string, text: string, replyToId?: string, attachment?: { id: string; url: string }): Promise<boolean> => {
    if (!identity) return false
    if (!text.trim() && !attachment) return false
    // Blind-courier mode (official SITE): sealed envelope to the peer's box,
    // never a server inbox. Attachments ride the sealed body as object refs.
    if (courierActive) {
      // Attachments ride the sealed body as a private object id (the upload
      // already added the peer to Recipients, so they can fetch the bytes).
      // Replies ride it too — the reference survives persistence, so a reply
      // to a message from three days ago still resolves.
      // Keys first, send second. The sealed lane cannot address a peer whose
      // keys were never cached (the roster is capped), so resolve them from the
      // public profile BEFORE the single send attempt: sending first appended a
      // failed row, and the old "retry once" appended a second one under a new
      // id — which is how one Enter came to render as two messages.
      if (!peerAddressable(peerId)) {
        try {
          const pres = await orbitFetch(`/api/users/${encodeURIComponent(peerId)}`, {}, identity)
          if (pres.ok) {
            const pu = ((await pres.json()) as { user?: { public_key?: string; encryption_pub_key?: string } }).user
            if (pu?.public_key) registerCourierKeys(peerId, pu.public_key, pu.encryption_pub_key || '')
          }
        } catch { /* offline: the single send below reports the failure */ }
      }
      const msg = await courierSend(peerId, text.trim(), attachment?.id, replyToId ? { replyToId } : undefined)
      const ok = !!msg && msg.status !== 'failed'
      if (!ok) {
        toast('Message not delivered — it stays local. Check your connection, or that you have their key.', 'error')
      }
      void loadPmMessages(peerId)
      loadPmThreads()
      return ok
    }
    const optimisticId = `local_${Date.now()}`
    const optimistic: ChatMessage = {
      id: optimisticId,
      senderId: identity.orbitId,
      senderName: resolveDisplayName({ selfId: identity.orbitId, senderId: identity.orbitId, roster: nameRoster }),
      text: text.trim(),
      timestamp: Date.now(),
      replyToId,
      attachmentId: attachment?.id,
      attachmentUrl: attachment?.url,
    }
    setPmMessagesByPeer(prev => ({ ...prev, [peerId]: [...(prev[peerId] || []), optimistic] }))
    try {
      const res = await orbitFetch('/api/pm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient_id: peerId,
          body: text.trim(),
          reply_to: replyToId || null,
          attachment_id: attachment?.id || null,
        }),
      }, identity)
      if (!res.ok) {
        // No silent failure: a dead bundled server or a 4xx must be visible,
        // and the optimistic bubble rolled back (1.0.1 bug: DMs appeared to
        // vanish with no feedback).
        setPmMessagesByPeer(prev => ({ ...prev, [peerId]: (prev[peerId] || []).filter(m => m.id !== optimisticId) }))
        const detail = await res.json().catch(() => ({}) as { error?: string })
        toast(detail.error || `Could not send message (HTTP ${res.status})`, 'error')
        return false
      }
      // Drop the optimistic copy now the server has confirmed it — the fresh
      // (cache-busted) refetch carries the authoritative row under its real id.
      setPmMessagesByPeer(prev => ({ ...prev, [peerId]: (prev[peerId] || []).filter(m => m.id !== optimisticId) }))
      loadPmMessages(peerId)
      loadPmThreads()
      return true
    } catch {
      setPmMessagesByPeer(prev => ({ ...prev, [peerId]: (prev[peerId] || []).filter(m => m.id !== optimisticId) }))
      toast('Couldn\'t send the message. The server is unreachable.', 'error')
      return false
    }
  }, [identity, myProfile.displayName, loadPmMessages, loadPmThreads, toast, courierActive, courierSend, registerCourierKeys, peerAddressable])

  useEffect(() => {
    if (!identity) return
    loadPmThreads()
    const handlePmNew = (e: Event) => {
      if (settings.chatNotificationSfx) playMsgReceive()
      // The WS push carries the full PM row — append it immediately to the
      // right conversation so the message appears before the refetch lands.
      const detail = (e as CustomEvent<unknown>).detail as Record<string, unknown> | null
      if (detail && typeof detail.id === 'string' && identity) {
        const incoming = typeof detail.sender_id === 'string' ? detail.sender_id : ''
        const peerId = incoming && incoming !== identity.orbitId
          ? incoming
          : (typeof detail.recipient_id === 'string' ? detail.recipient_id : '')
        if (peerId && peerId !== 'global_lobby' && peerId !== 'card_queue') {
          const attachmentId = typeof detail.attachment_id === 'string' ? detail.attachment_id : undefined
          const msg: ChatMessage = {
            id: String(detail.id),
            senderId: incoming || identity.orbitId,
            senderName: resolveDisplayName({
              selfId: identity.orbitId,
              senderId: incoming || identity.orbitId,
              payloadName: typeof detail.sender_name === 'string' ? detail.sender_name : null,
              roster: nameRoster,
            }),
            text: typeof detail.body === 'string' ? detail.body : '',
            timestamp: parseApiTimestamp(typeof detail.created_at === 'string' ? detail.created_at : null)?.getTime() || Date.now(),
            replyToId: typeof detail.reply_to === 'string' ? detail.reply_to : undefined,
            attachmentId,
            attachmentUrl: attachmentId ? `/api/objects/${attachmentId}` : undefined,
            attachmentMime: typeof detail.attachment_mime === 'string' ? detail.attachment_mime : undefined,
            editedAt: typeof detail.edited_at === 'string' ? detail.edited_at : undefined,
            readByRecipient: Boolean(detail.read_by_recipient),
          }
          setPmMessagesByPeer(prev => {
            const list = prev[peerId] || []
            if (list.some((m) => m.id === msg.id)) return prev
            return { ...prev, [peerId]: [...list, msg].sort((a, b) => a.timestamp - b.timestamp) }
          })
        }
      }
      loadPmThreads()
      loadPmUnreadCount()
      if (pmPeer?.id) loadPmMessages(pmPeer.id)
    }

    const handlePmEdited = (e: Event) => {
      const detail = (e as CustomEvent<unknown>).detail as Record<string, unknown> | null
      if (!detail || !identity) return
      const msgId = typeof detail.id === 'string' ? detail.id : ''
      const newText = typeof detail.body === 'string' ? detail.body : ''
      const editedAt = typeof detail.edited_at === 'string' ? detail.edited_at : undefined
      const incoming = typeof detail.sender_id === 'string' ? detail.sender_id : ''
      const peerId = incoming && incoming !== identity.orbitId
        ? incoming
        : (typeof detail.recipient_id === 'string' ? detail.recipient_id : '')
      if (!msgId || !peerId || peerId === 'global_lobby' || peerId === 'card_queue') return
      setPmMessagesByPeer(prev => {
        const list = prev[peerId] || []
        const idx = list.findIndex(m => m.id === msgId)
        if (idx === -1) return prev
        const updated = [...list]
        updated[idx] = { ...updated[idx], text: newText, editedAt }
        return { ...prev, [peerId]: updated }
      })
    }

    const handlePmDeletedEveryone = (e: Event) => {
      const detail = (e as CustomEvent<unknown>).detail as Record<string, unknown> | null
      if (!detail || !identity) return
      const msgId = typeof detail.messageId === 'string' ? detail.messageId : ''
      const incoming = typeof detail.sender_id === 'string' ? detail.sender_id : ''
      const peerId = incoming && incoming !== identity.orbitId
        ? incoming
        : (typeof detail.recipient_id === 'string' ? detail.recipient_id : '')
      if (!msgId || !peerId || peerId === 'global_lobby' || peerId === 'card_queue') return
      setPmMessagesByPeer(prev => {
        const list = prev[peerId] || []
        return { ...prev, [peerId]: list.filter(m => m.id !== msgId) }
      })
    }

    window.addEventListener('orbit-pm-new', handlePmNew)
    window.addEventListener('orbit-pm-edited', handlePmEdited)
    window.addEventListener('orbit-pm-deleted-everyone', handlePmDeletedEveryone)
    return () => {
      window.removeEventListener('orbit-pm-new', handlePmNew)
      window.removeEventListener('orbit-pm-edited', handlePmEdited)
      window.removeEventListener('orbit-pm-deleted-everyone', handlePmDeletedEveryone)
    }
  }, [identity, users, myProfile.displayName, pmPeer, loadPmThreads, loadPmMessages, loadPmUnreadCount, settings.chatNotificationSfx])

  const [groupMessagesByGroup, setGroupMessagesByGroup] = useState<Record<string, ChatMessage[]>>({})

  // Real-time group-chat push: append the incoming message to the group's
  // cached thread (creating the entry if it hasn't been opened yet).
  useEffect(() => {
    const handleGroupNew = (e: Event) => {
      const detail = (e as CustomEvent<unknown>).detail as Record<string, unknown> | null
      if (!detail || typeof detail.id !== 'string' || typeof detail.group_id !== 'string' || !identity) return
      const senderId = typeof detail.sender_id === 'string' ? detail.sender_id : ''
      const attachmentId = typeof detail.attachment_id === 'string' ? detail.attachment_id : undefined
      const groupId = detail.group_id as string
      const msg: ChatMessage = {
        id: String(detail.id),
        senderId: senderId || identity.orbitId,
        senderName: resolveDisplayName({
          selfId: identity.orbitId,
          senderId: senderId || identity.orbitId,
          payloadName: typeof detail.sender_name === 'string' ? detail.sender_name : null,
          roster: nameRoster,
        }),
        text: typeof detail.body === 'string' ? detail.body : '',
        timestamp: parseApiTimestamp(typeof detail.created_at === 'string' ? detail.created_at : null)?.getTime() || Date.now(),
        replyToId: typeof detail.reply_to === 'string' ? detail.reply_to : undefined,
        attachmentId,
        attachmentUrl: attachmentId ? `/api/objects/${attachmentId}` : undefined,
        attachmentMime: typeof detail.attachment_mime === 'string' ? detail.attachment_mime : undefined,
      }
      setGroupMessagesByGroup(prev => {
        const list = prev[groupId] || []
        if (list.some((m) => m.id === msg.id)) return prev
        return { ...prev, [groupId]: [...list, msg].sort((a, b) => a.timestamp - b.timestamp) }
      })
    }
    window.addEventListener('orbit-group-new', handleGroupNew)
    return () => window.removeEventListener('orbit-group-new', handleGroupNew)
  }, [identity, myProfile.displayName])

  // Real-time notifications push: SFX & tab title flash (notifications stay inside the notifications tab)
  useEffect(() => {
    const handleIncomingNotif = (e: Event) => {
      const detail = (e as CustomEvent<unknown>).detail as Record<string, unknown> | null
      if (!detail) return
      // PMs arrive on their own socket channel too (message + sound there);
      // the server's 'pm' notification row exists for the panel/reload, so
      // re-announcing it here is the duplicate the user reported.
      if (detail.type === 'pm') return
      playChime()

      if (typeof document !== 'undefined' && document.hidden) {
        const oldTitle = document.title
        document.title = '(1) New interaction · gMatch'
        const restore = () => {
          document.title = oldTitle
          window.removeEventListener('focus', restore)
        }
        window.addEventListener('focus', restore, { once: true })
      }
    }
    window.addEventListener('orbit-incoming-notification', handleIncomingNotif)
    return () => window.removeEventListener('orbit-incoming-notification', handleIncomingNotif)
  }, [])

  const reportPmMessage = useCallback(async (messageId: string) => {
    if (!identity) return
    try {
      await orbitFetch(`/api/pm/${messageId}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Reported from DM' }),
      }, identity)
      toast('Message reported', 'info')
    } catch (err) {
      logger.warn('[useAppChat] POST /api/pm/:id/report failed', err)
    }
  }, [identity, toast])

  const reportPmUser = useCallback(async (userId: string) => {
    if (!identity) return
    try {
      await orbitFetch('/api/pm/report-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, reason: 'Reported from DM' }),
      }, identity)
      toast('User reported', 'info')
    } catch (err) {
      logger.warn('[useAppChat] POST /api/pm/:id/report failed', err)
    }
  }, [identity, toast])

  /** Delete from this device. Courier rows become tombstones so a re-pulled
   *  envelope cannot bring the message back; the old /api/pm DELETE route no
   *  longer exists on any node, so calling it was a silent no-op. */
  const deletePmMessage = useCallback(async (messageId: string, peerId: string) => {
    if (!identity) return
    if (courierActive) {
      await courierRemove(peerId, messageId, { forEveryone: false })
      await loadPmMessages(peerId)
      loadPmThreads()
      return
    }
    setPmMessagesByPeer((prev) => ({
      ...prev,
      [peerId]: (prev[peerId] || []).filter((m) => m.id !== messageId),
    }))
  }, [identity, courierActive, courierRemove, loadPmMessages, loadPmThreads])

  /** Sealed delete for everyone. False => the local delete stands, the peer was
   *  not told (the caller must not claim otherwise). */
  const deletePmForEveryone = useCallback(async (peerId: string, messageId: string) => {
    if (!courierActive) return false
    const ok = await courierRemove(peerId, messageId)
    await loadPmMessages(peerId)
    loadPmThreads()
    return ok
  }, [courierActive, courierRemove, loadPmMessages, loadPmThreads])

  const editPmMessage = useCallback(async (peerId: string, messageId: string, text: string) => {
    if (!courierActive) return false
    const ok = await courierEdit(peerId, messageId, text)
    await loadPmMessages(peerId)
    loadPmThreads()
    return ok
  }, [courierActive, courierEdit, loadPmMessages, loadPmThreads])

  const reactPmMessage = useCallback((peerId: string, messageId: string, emoji: string, on: boolean) => {
    if (!courierActive) return
    void courierReact(peerId, messageId, emoji, on).then((ok) => {
      if (!ok) toast('Reaction not delivered — the peer could not be reached.', 'warning')
      void loadPmMessages(peerId)
    })
  }, [courierActive, courierReact, loadPmMessages, toast])

  /** Local, throttled typing ping for the sealed lane only. */
  const notifyPmTyping = useCallback((peerId: string) => {
    if (!courierActive) return
    if (peerId === 'global_lobby' || peerId === 'card_queue') return
    courierType(peerId)
  }, [courierActive, courierType])

  const deleteThread = useCallback(async (peerId: string) => {
    if (!identity) return
    const base = getApiBaseUrl()
    const isCourier = courierActive || cachedMailMode(base) === 'courier'
    try {
      if (isCourier) {
        // Delete for me: tombstone every row so a later pull cannot restore a
        // conversation the player cleared. The peer keeps their own copy.
        for (const m of courierThreadFor(peerId) || []) {
          await courierRemove(peerId, m.id, { forEveryone: false })
        }
        stampDmSeen(peerId)
      } else {
        await orbitFetch(`/api/pm/threads/${peerId}`, { method: 'DELETE' }, identity)
      }
      setPmPeer(null)
      setPmMessagesByPeer(prev => {
        const next = { ...prev }
        delete next[peerId]
        return next
      })
      loadPmThreads()
      loadPmUnreadCount()
    } catch (err) {
      logger.warn('[useAppChat] DELETE /api/pm/threads/:id failed', err)
    }
  }, [identity, courierActive, courierThreadFor, courierRemove, stampDmSeen, loadPmThreads, loadPmUnreadCount])

  const loadPmHistory = useCallback(async (peerId: string, beforeTimestamp: string): Promise<boolean> => {
    if (!identity) return false
    try {
      const res = await orbitFetch(`/api/pm/history/${encodeURIComponent(peerId)}?before=${encodeURIComponent(beforeTimestamp)}&limit=50`, {}, identity)
      if (!res.ok) return false
      const data = await res.json()
      if (!data || !Array.isArray(data.messages)) return false
      const older: ChatMessage[] = data.messages.map((m: any) => ({
        id: m.id,
        senderId: m.sender_id,
        senderName: resolveDisplayName({
          selfId: identity.orbitId,
          senderId: m.sender_id,
          payloadName: m.sender_name,
          roster: nameRoster,
        }),
        text: m.body,
        timestamp: parseApiTimestamp(m.created_at)?.getTime() || Date.now(),
        replyToId: m.reply_to || undefined,
        attachmentId: m.attachment_id || undefined,
        attachmentUrl: m.attachment_id ? `/api/objects/${m.attachment_id}` : undefined,
        attachmentMime: m.attachment_mime || undefined,
        editedAt: m.edited_at || undefined,
        readByRecipient: Boolean(m.read_by_recipient),
      })).sort((a: ChatMessage, b: ChatMessage) => a.timestamp - b.timestamp)
      if (older.length === 0) return false
      setPmMessagesByPeer(prev => {
        const existing = prev[peerId] || []
        const existingIds = new Set(existing.map(m => m.id))
        const newMsgs = older.filter(m => !existingIds.has(m.id))
        return { ...prev, [peerId]: [...newMsgs, ...existing].sort((a, b) => a.timestamp - b.timestamp) }
      })
      return Boolean(data.hasMore)
    } catch {
      return false
    }
  }, [identity, users, myProfile.displayName])

  // ─── Group chats ───
  const [chatGroups, setChatGroups] = useState<Array<{ id: string; name: string; owner_id: string; member_count: number; is_member: number }>>([])

  // Dock preview rows: one line per chat surface (lobby, queue, rooms, groups,
  // DM threads) — clicking a row opens the unified Rooms chat on it.
  const previewRows = useMemo(() => {
    const lobby = chatMessages.filter((m) => !m.channel || m.channel === 'global_lobby')
    const queue = chatMessages.filter((m) => m.channel === 'card_queue')
    let readIds = new Set<string>()
    try { readIds = new Set(JSON.parse(localStorage.getItem('orbit_read_dms') || '[]')) } catch { /* fresh */ }
    return buildPreviewRows({
      rooms: chatRooms,
      roomLast: (id) => chatRoomMessages(id).slice(-1)[0]?.text,
      roomUnread,
      groups: chatGroups,
      groupLast: (id) => (groupMessagesByGroup[id] || []).slice(-1)[0]?.text,
      threads: pmThreads,
      myOrbitId: identity?.orbitId,
      readIds,
      lobbyLast: lobby.slice(-1)[0]?.text,
      queueLast: queue.slice(-1)[0]?.text,
    })
  }, [chatMessages, chatRooms, chatRoomMessages, roomUnread, chatGroups, groupMessagesByGroup, pmThreads, identity?.orbitId, roomTick])

  const loadChatGroups = useCallback(() => {
    if (!identity) return Promise.resolve()
    return orbitFetch('/api/groups', {}, identity)
      .then(async (res) => {
        if (!res.ok) return
        const data = await res.json()
        setChatGroups(Array.isArray(data?.groups) ? data.groups : [])
      })
      .catch(() => { })
  }, [identity])

  const loadGroupMembers = useCallback(async (groupId: string): Promise<GroupMember[]> => {
    if (!identity) return []
    const res = await orbitFetch(`/api/groups/${groupId}/members`, {}, identity)
    if (!res.ok) throw new Error(`Could not load members (${res.status})`)
    const data = await res.json()
    return Array.isArray(data?.members) ? data.members : []
  }, [identity])

  // The conversation of a group travels through a SEALED ROOM (roadmap L6):
  // the node owns the membership, the words are group-sealed and fanned out
  // to the members' mailboxes. The node's rows stay as the history from
  // before the room existed, and the two are merged by id.
  const groupRoomOps = useMemo<GroupRoomOps>(() => ({
    rooms: () => courier.rooms,
    createRoom: (name, id) => courier.createRoomWithId(name, id) ?? {
      id, name, dekHex: '', epoch: 0, ownerId: identity?.orbitId || '', members: [], createdAt: Date.now(),
    },
    invite: (roomId, peerId) => courier.inviteToRoom(roomId, peerId),
    messages: (roomId) => courier.roomMessages(roomId),
    say: (roomId, text) => courier.sayInRoom(roomId, text),
  }), [courier.rooms, courier.createRoomWithId, courier.inviteToRoom, courier.roomMessages, courier.sayInRoom, identity?.orbitId])

  /** groupId -> what the transport did (for an honest badge in the UI). */
  const [groupTransport, setGroupTransport] = useState<Record<string, 'sealed' | 'node'>>({})

  const loadGroupMessages = useCallback((groupId: string) => {
    if (!identity) return Promise.resolve()
    return orbitFetch(`/api/groups/${groupId}/messages`, {}, identity)
      .then(async (res) => {
        if (!res.ok) return
        const data = await res.json()
        if (Array.isArray(data)) {
          const msgs: ChatMessage[] = data.map((m: any) => ({
            id: m.id,
            senderId: m.sender_id,
            senderName: resolveDisplayName({
              selfId: identity.orbitId,
              senderId: m.sender_id,
              payloadName: m.sender_name,
              roster: nameRoster,
            }),
            text: m.body,
            timestamp: parseApiTimestamp(m.created_at)?.getTime() || Date.now(),
            replyToId: m.reply_to || undefined,
            attachmentId: m.attachment_id || undefined,
            attachmentUrl: m.attachment_id ? `/api/objects/${m.attachment_id}` : undefined,
            attachmentMime: m.attachment_mime || undefined,
          })).sort((a: ChatMessage, b: ChatMessage) => a.timestamp - b.timestamp)

          // The sealed room carries what comes next. Make sure it exists and
          // that the members have the DEK, then merge both halves.
          let merged: ChatMessage[] = msgs
          try {
            const group = chatGroups.find((g) => g.id === groupId)
            const members = await loadGroupMembers(groupId)
            if (group) {
              const result = await ensureGroupRoom(group, members, groupRoomOps, identity.orbitId)
              const roomRows = groupRoomOps.messages(result.roomId)
              merged = mergeGroupMessages(
                msgs,
                roomRows,
                identity.orbitId,
                myProfile.displayName || 'You',
              ) as ChatMessage[]
              const sealed = roomRows.length > 0 || result.invited.length > 0
              setGroupTransport((prev) => ({ ...prev, [groupId]: sealed ? 'sealed' : 'node' }))
            }
          } catch {
            /* the sealed lane is unavailable: the node rows still stand */
          }
          setGroupMessagesByGroup(prev => ({ ...prev, [groupId]: merged }))
        }
      })
      .catch(() => { })
  }, [identity, nameRoster, chatGroups, loadGroupMembers, groupRoomOps, myProfile.displayName])

  useEffect(() => {
    const refreshChat = () => {
      if (document.visibilityState !== 'visible') return
      if (pmPeer?.id && pmPeer.id !== 'global_lobby' && pmPeer.id !== 'card_queue') void loadPmMessages(pmPeer.id)
      if (activeGroupId) void loadGroupMessages(activeGroupId)
      void loadChatGroups()
    }
    window.addEventListener('focus', refreshChat)
    document.addEventListener('visibilitychange', refreshChat)
    return () => {
      window.removeEventListener('focus', refreshChat)
      document.removeEventListener('visibilitychange', refreshChat)
    }
  }, [activeGroupId, loadChatGroups, loadGroupMessages, loadPmMessages, pmPeer?.id])

  const addGroupMembers = useCallback(async (groupId: string, ids: string[]) => {
    if (!identity || ids.length === 0) return false
    try {
      const res = await orbitFetch(`/api/groups/${groupId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ member_ids: ids }),
      }, identity)
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        toast(data?.error || `Could not add members (${res.status})`, 'error')
        return false
      }
      loadChatGroups()
      return true
    } catch (err) {
      toast(userFacingError(err, { fallback: 'Could not add members.' }), 'error')
      return false
    }
  }, [identity, loadChatGroups, toast])

  const createGroup = useCallback(async (name: string, memberIds: string[]) => {
    if (!identity || !name.trim()) return null
    try {
      const res = await orbitFetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), member_ids: memberIds }),
      }, identity)
      if (res.ok) {
        const data = await res.json()
        loadChatGroups()
        if (data.group?.id) {
          setActiveGroupId(data.group.id)
        }
        return data.group?.id || null
      }
      return null
    } catch { return null }
  }, [identity, loadChatGroups])

  const sendGroupMessage = useCallback(async (groupId: string, text: string, replyToId?: string, attachment?: { id: string; url: string; isVideo?: boolean }) => {
    if (!identity || (!text.trim() && !attachment)) return
    // The sealed room is the transport when it can reach the members. An
    // attachment still goes to the node (the bytes are node-hosted today),
    // so that case stays on the node path.
    if (!attachment && text.trim()) {
      try {
        const roomId = roomIdForGroup(groupId)
        const room = groupRoomOps.rooms().find((r) => r.id === roomId)
        const reachable = room?.members.filter((m) => m !== identity.orbitId) ?? []
        if (room && reachable.length > 0) {
          const sentId = await groupRoomOps.say(roomId, text.trim())
          if (sentId) {
            setGroupMessagesByGroup((prev) => ({
              ...prev,
              [groupId]: [...(prev[groupId] || []), {
                id: sentId,
                senderId: identity.orbitId,
                senderName: myProfile.displayName || 'You',
                text: text.trim(),
                timestamp: Date.now(),
              }],
            }))
            return
          }
        }
      } catch {
        /* fall through to the node route */
      }
    }
    try {
      const res = await orbitFetch(`/api/groups/${groupId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text.trim(), reply_to: replyToId || null, attachment_id: attachment?.id || null }),
      }, identity)
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        toast(data?.error || `Could not send group message (${res.status})`, 'error')
        return
      }
      loadGroupMessages(groupId)
    } catch (err) {
      toast(userFacingError(err, { fallback: 'Could not send group message. The server is unreachable.' }), 'error')
    }
  }, [identity, loadGroupMessages, toast, groupRoomOps, myProfile.displayName])

  const openAttachmentModal = useCallback((
    target: 'pm' | 'group' | 'lobby',
    peerId?: string,
    groupId?: string,
    replyToId?: string,
    files?: File[],
    url?: string,
  ) => {
    if (target === 'group' && !groupId) {
      // No specific group selected - open group picker first
      setGroupPickerOpen(true)
        // Store the replyToId for later
      ; (window as any).__pendingGroupReplyToId = replyToId
        // A paste into the group-less state still has to survive the picker,
        // or choosing a group would silently discard the image.
      ; (window as any).__pendingAttachmentFiles = files
      ; (window as any).__pendingAttachmentUrl = url
    } else {
      setAttachmentModal({ isOpen: true, target, peerId, groupId, replyToId, initialFiles: files, initialUrl: url })
    }
  }, [])

  

  const closeAttachmentModal = useCallback(() => {
    setAttachmentModal(null)
    setGroupPickerOpen(false)
  }, [])

  const handleAttachmentSuccess = useCallback((attachment: { id: string; url: string; isVideo?: boolean }) => {
    if (!attachmentModal || !identity) return
    // Check for pending babecock attachment (shared from gallery)
    const pendingAttachment = (window as any).__pendingBabecockAttachment
    const finalAttachment = pendingAttachment || attachment
    if (pendingAttachment) {
      ; (window as any).__pendingBabecockAttachment = null
    }
    if (attachmentModal.target === 'pm' && attachmentModal.peerId) {
      void sendPm(attachmentModal.peerId, '', attachmentModal.replyToId, finalAttachment)
    } else if (attachmentModal.target === 'group' && attachmentModal.groupId) {
      void sendGroupMessage(attachmentModal.groupId, '', attachmentModal.replyToId, finalAttachment)
    } else if (attachmentModal.target === 'lobby') {
      sendChatMessage('', 'global_lobby', finalAttachment)
    }
    closeAttachmentModal()
  }, [attachmentModal, identity, sendPm, sendGroupMessage, sendChatMessage, closeAttachmentModal])

  const handleGroupPickerSelect = useCallback((groupId: string) => {
    const pendingAttachment = (window as any).__pendingBabecockAttachment
    const replyToId = (window as any).__pendingGroupReplyToId
    const pastedFiles = (window as any).__pendingAttachmentFiles as File[] | undefined
    const pastedUrl = (window as any).__pendingAttachmentUrl as string | undefined
      ; (window as any).__pendingBabecockAttachment = null
      ; (window as any).__pendingGroupReplyToId = null
      ; (window as any).__pendingAttachmentFiles = undefined
      ; (window as any).__pendingAttachmentUrl = undefined
    setGroupPickerOpen(false)
    if (pendingAttachment) {
      // Send directly without opening attachment modal
      void sendGroupMessage(groupId, '', replyToId, pendingAttachment)
    } else {
      // Open attachment modal for this group, carrying the pasted image (if
      // any) through the picker rather than dropping it on the floor.
      setAttachmentModal({ isOpen: true, target: 'group', groupId, replyToId, initialFiles: pastedFiles, initialUrl: pastedUrl })
    }
  }, [sendGroupMessage])

  // Listen for babecock share-to-group event
  useEffect(() => {
    const handler = (e: CustomEvent<{ attachment: { id: string; url: string; isVideo?: boolean } }>) => {
      // Open group picker for group chat selection
      setGroupPickerOpen(true)
        // Store the attachment and replyToId for when group is selected
        ; (window as any).__pendingBabecockAttachment = e.detail.attachment
        ; (window as any).__pendingGroupReplyToId = undefined
    }
    window.addEventListener('babecock-share-to-group', handler as EventListener)
    return () => window.removeEventListener('babecock-share-to-group', handler as EventListener)
  }, [])

  const leaveGroup = useCallback(async (groupId: string) => {
    if (!identity) return
    try {
      await orbitFetch(`/api/groups/${groupId}/leave`, { method: 'POST' }, identity)
      loadChatGroups()
    } catch (err) {
      logger.warn('[useAppChat] POST /api/groups/:id/leave failed', err)
    }
  }, [identity, loadChatGroups])

  useEffect(() => {
    if (identity) loadChatGroups()
  }, [identity, loadChatGroups])

  return {
    courier,
    courierActive,
    registerCourierKeys,
    courierPull,
    courierThreadFor,
    courierSend,
    courierMarkRead,
    courierEdit,
    courierRemove,
    courierReact,
    courierType,
    courierIsTyping,
    meshSend,
    peerAddressable,
    roomTick,
    groupMessagesByGroup,
    chatGroups,
    groupTransport,
    loadPmThreads,
    chatRooms,
    chatRoomMessages,
    openRoomChat,
    roomUnread,
    chatUnreadCount,
    dmUnreadByPeer,
    dmMentionByPeer,
    resolveNotifyName,
    peerReports,
    notificationCenter,
    openLocalNotification,
    markLocalNotificationsRead,
    loadPmUnreadCount,
    markAllChatRead,
    loadPmMessages,
    pmLastInboundTs,
    sendPm,
    reportPmMessage,
    reportPmUser,
    deletePmMessage,
    deletePmForEveryone,
    editPmMessage,
    reactPmMessage,
    notifyPmTyping,
    deleteThread,
    loadPmHistory,
    previewRows,
    loadChatGroups,
    loadGroupMembers,
    groupRoomOps,
    loadGroupMessages,
    addGroupMembers,
    createGroup,
    sendGroupMessage,
    openAttachmentModal,
    closeAttachmentModal,
    handleAttachmentSuccess,
    handleGroupPickerSelect,
    leaveGroup,
  }
}
