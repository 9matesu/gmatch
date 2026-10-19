import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { OrbitIdentity } from '@orbit/crypto'
import { MailClient, type MailSocket } from '../utils/mail-client'
import { DmManager, DmStore, scopedKey, type DmMessage } from '../utils/mail-dm'
import { DominationMeshManager } from '../utils/dominationMeshManager'
import { deliveryToken } from '@orbit/protocol'
import { rotateEpoch, peerAddressToken, type EpochState } from '../utils/handleRotation'
import { getSecureItem, setSecureItem } from '../utils/secure-storage'
import { RoomManager, type Room, type RoomMessage } from '../utils/rooms'
import { detectMailMode, cachedMailMode, isKnownSiteCourier, type MailMode } from '../utils/mail-mode'
import { getApiBaseUrl } from '../utils/api'
import { logger } from '../utils/logger'
import { handleInboundSignal } from '../utils/courierSignaling'
import { ownDisplayName } from '../utils/displayName'
import { activeTypists, pruneTypingState } from '../utils/dmTyping'

export interface CourierDeps {
  webSocketFactory?: (url: string) => MailSocket
  fetchImpl?: typeof fetch
  /** Inbound DM/room arrived (opened + stored): surface sound/toast. */
  onNotify?: (msg: DmMessage) => void
  /** Inbound room message arrived. */
  onRoomMessage?: (msg: RoomMessage, room: Room) => void
  /** Receiver local consent lookup for mesh domination actions. Closed by
   *  default: without this, every inbound action is declined. */
  dominationConsent?: (action: string) => boolean
  /** A consented mesh domination action arrived — render the effect. */
  onDomEffect?: (action: string, fromOrbitId: string, senderName?: string) => void
  /** A mesh receipt arrived for our outbox (landed | declined). */
  onDomReceipt?: (requestId: string, status: 'landed' | 'declined') => void
}

/**
 * Courier DM runtime (plan P3.3 wiring). Active ONLY in courier mode
 * (official SITE: GET /api/pm 404s). In legacy mode this hook is inert and
 * the server-inbox path in App.tsx stays authoritative — self-host/dev keep
 * working untouched.
 *
 * deps is a caller-inline options object: kept in a ref, NEVER in a
 * dependency array (a fresh literal each render would loop the effects).
 */
export function useCourierDms(identity: OrbitIdentity | null, deps: CourierDeps = {}) {
  const [mode, setMode] = useState<MailMode>(() => {
    const base = getApiBaseUrl()
    if (isKnownSiteCourier(base)) return 'courier'
    return cachedMailMode(base) || 'legacy'
  })
  const [threads, setThreads] = useState<Record<string, DmMessage[]>>({})
  const [rooms, setRoomsState] = useState<Room[]>([])
  /** peer -> last typing ping (transient; swept, never persisted). */
  const [typingAt, setTypingAt] = useState<Record<string, number>>({})
  const clientRef = useRef<MailClient | null>(null)
  const managerRef = useRef<DmManager | null>(null)
  const domMgrRef = useRef<DominationMeshManager | null>(null)
  const roomsRef = useRef<RoomManager | null>(null)
  const storeRef = useRef<DmStore | null>(null)
  const depsRef = useRef(deps)
  depsRef.current = deps

  useEffect(() => {
    let cancelled = false
    void detectMailMode(getApiBaseUrl(), depsRef.current.fetchImpl).then((m) => {
      if (!cancelled) setMode(m)
    })
    return () => { cancelled = true }
  }, [])

  // One client+manager per (identity, courier-mode). Mutual dependency is
  // broken with a lazy facade: the manager seals through whatever client
  // exists at call time (assigned right after construction).
  useEffect(() => {
    if (!identity || mode !== 'courier') {
      storeRef.current = null
      managerRef.current = null
      domMgrRef.current = null
      clientRef.current = null
      setThreads({})
      return
    }
    const store = new DmStore(identity)
    const refresh = (peerId: string) => {
      setThreads((prev) => ({ ...prev, [peerId]: store.thread(peerId) }))
    }
    const refreshRooms = () => setRoomsState(roomMgr.rooms())
    const facade: Pick<MailClient, 'send' | 'epoch'> = {
      send: (body, kind, recipient, opts) => {
        if (!clientRef.current) return Promise.reject(new Error('mail client not ready'))
        return clientRef.current.send(body, kind, recipient, opts)
      },
      get epoch() {
        return clientRef.current?.epoch ?? { cur: '', prev: '' }
      },
    }
    const mailAsClient = facade as unknown as MailClient
    const roomMgr = new RoomManager({
      identity,
      mail: mailAsClient,
      peers: store,
      onChanged: refreshRooms,
      onIncoming: (m, r) => depsRef.current.onRoomMessage?.(m, r),
    })
    const manager = new DmManager({
      mail: mailAsClient,
      store,
      identity,
      onThreadChanged: refresh,
      onTyping: (peerId, at) => setTypingAt((prev) => ({ ...prev, [peerId]: at })),
      onIncoming: (m) => {
        // A delivered message ends the "typing" state: whatever they were
        // typing has arrived. Without this the bubble lingers for its TTL.
        setTypingAt((prev) => {
          if (!(m.peerId in prev)) return prev
          const next = { ...prev }
          delete next[m.peerId]
          return next
        })
        depsRef.current.onNotify?.(m)
      },
    })
    // Mesh domination (Fase 5/6): same sealed transport as DMs, receiver's
    // local consent is authoritative. Events are the stable contract for the
    // UI (DominationEffects + outbox listeners); explicit dep callbacks exist
    // for tests and direct wiring.
    const domMgr = new DominationMeshManager({
      mail: {
        send: (body, keys) => {
          if (!clientRef.current) return Promise.reject(new Error('mail client not ready'));
          return clientRef.current.send(body, 'mail', keys, {
            to: peerAddressToken(keys, deliveryToken),
          });
        },
      },
      getPeerKeys: (peerId) => {
        const k = store.peerKeys(peerId);
        return k?.publicKeyHex && k?.encryptionPubHex
          ? { publicKeyHex: k.publicKeyHex, encryptionPubHex: k.encryptionPubHex }
          : null;
      },
      addressPeer: (keys) => peerAddressToken(keys, deliveryToken),
      isConsented: (action) => depsRef.current.dominationConsent?.(action) === true,
      onOutboxStatus: (id, status) => {
        depsRef.current.onDomReceipt?.(id, status);
        window.dispatchEvent(new CustomEvent('gmatch:domination-receipt', { detail: { id, status } }));
      },
      onIncomingEffect: (action, from, extra) => {
        const detail = {
          action,
          from,
          senderName: extra?.senderName,
          payload: extra?.payload,
          meshId: extra?.id,
        };
        depsRef.current.onDomEffect?.(action, from, extra?.senderName);
        window.dispatchEvent(new CustomEvent('gmatch:domination-mesh-effect', { detail }));
      },
    })
    const client = new MailClient({
      apiBase: getApiBaseUrl(),
      identity,
      webSocketFactory: depsRef.current.webSocketFactory,
      fetchImpl: depsRef.current.fetchImpl,
      // DM first; if the opened body is not a DM/ack, try domination mesh,
      // then the room layer, then signal routing.
      onMail: (opened, env) => {
        if (!manager.handleOpened(opened, env)) {
          if (!domMgr.handleOpened(opened, env)) {
            if (!roomMgr.handleOpened(opened)) {
              if (opened.kind === 'signal') {
                void handleInboundSignal(opened, identity, undefined, depsRef.current.fetchImpl)
              }
            }
          }
        }
      },
      log: (m) => logger.log(m),
    })
    // Wave 2 (C2): rotate the session handle once per boot; prev is kept one
    // cycle so mail addressed to yesterday's token still drains. (Dev
    // StrictMode double-mount rotates twice — worst case one overlap cycle
    // is skipped in dev only.)
    const epochKey = scopedKey('orbit_mail_epoch_v1', identity.orbitId)
    let stored: EpochState | null = null
    try { stored = getSecureItem(epochKey) ? JSON.parse(getSecureItem(epochKey) as string) : null } catch { /* fresh */ }
    const rotated = rotateEpoch(stored)
    setSecureItem(epochKey, JSON.stringify(rotated))
    client.epoch = rotated
    storeRef.current = store
    managerRef.current = manager
    domMgrRef.current = domMgr
    roomsRef.current = roomMgr
    clientRef.current = client
    client.start()
    setThreads(store.threads())
    setRoomsState(roomMgr.rooms())
    void client.pull() // drain whatever arrived while closed
    return () => {
      client.stop()
      clientRef.current = null
      managerRef.current = null
      domMgrRef.current = null
      roomsRef.current = null
      storeRef.current = null
    }
  }, [identity, mode])

  // The sender is always the local user, so the name is read from the shared
  // storage key rather than threaded through every call site — a caller that
  // forgot to pass it is exactly how names went missing.
  const send = useCallback(async (peerId: string, text: string, attachmentId?: string, opts?: { replyToId?: string }): Promise<DmMessage | null> => {
    if (!managerRef.current) return null
    return managerRef.current.send(peerId, text, attachmentId, ownDisplayName() || undefined, opts)
  }, [])

  const pull = useCallback(async () => {
    await clientRef.current?.pull()
    if (storeRef.current) setThreads(storeRef.current.threads())
  }, [])

  const threadFor = useCallback((peerId: string): DmMessage[] | null => {
    if (!storeRef.current) return null
    return storeRef.current.thread(peerId)
  }, [])

  /** Sealed message events. All return false when the peer cannot be reached,
   *  so the UI reports a failure instead of pretending the change landed. */
  const edit = useCallback((peerId: string, id: string, text: string): Promise<boolean> => {
    return managerRef.current?.edit(peerId, id, text) ?? Promise.resolve(false)
  }, [])

  const remove = useCallback(
    (peerId: string, id: string, opts?: { forEveryone?: boolean }): Promise<boolean> => {
      return managerRef.current?.remove(peerId, id, opts) ?? Promise.resolve(false)
    },
    [],
  )

  const react = useCallback(
    (peerId: string, id: string, emoji: string, on: boolean): Promise<boolean> => {
      return managerRef.current?.react(peerId, id, emoji, on) ?? Promise.resolve(false)
    },
    [],
  )

  const type = useCallback((peerId: string) => {
    managerRef.current?.type(peerId)
  }, [])

  const markRead = useCallback((peerId: string, upTo: number) => {
    managerRef.current?.markRead(peerId, upTo)
  }, [])

  /** True when the peer has a typing ping inside its TTL. */
  const isTyping = useCallback(
    (peerId: string) => activeTypists(typingAt, Date.now()).includes(peerId),
    [typingAt],
  )

  // Typing has no history, so nothing else will ever clear it: sweep the map
  // on a timer. `pruneTypingState` returns the same object when nothing
  // expired, so an idle chat does not re-render every 2s.
  useEffect(() => {
    if (!identity) return
    const timer = setInterval(() => {
      setTypingAt((prev) => pruneTypingState(prev, Date.now()))
    }, 2_000)
    return () => clearInterval(timer)
  }, [identity])

  const registerPeerKeys = useCallback((orbitId: string, publicKeyHex: string, encryptionPubHex: string) => {
    storeRef.current?.rememberPeer(orbitId, { publicKeyHex, encryptionPubHex })
  }, [])

  /** Mesh domination send (Fase 5/6): sealed dom_request, free, no server.
   *  Null when the peer has no known keys — the caller falls back to the
   *  server route; the mesh never fires blind. */
  const meshSend = useCallback(
    async (targetOrbitId: string, action: string, payload: unknown, senderName?: string) => {
      if (!domMgrRef.current) return { ok: false as const, reason: 'not-ready' as const };
      return domMgrRef.current.sendEffect(targetOrbitId, action, payload, senderName);
    },
    [],
  )

  /** Whether the peer is mesh-addressable (keys known from roster/TOFU). */
  const meshPeerKnown = useCallback((orbitId: string): boolean => {
    const k = storeRef.current?.peerKeys(orbitId);
    return Boolean(k?.publicKeyHex && k?.encryptionPubHex);
  }, [])

  // Mesh camera verdicts (Fase 5/6): the receiver approved/denied a pending
  // request in DominationEffects — seal the receipt back (landed | declined).
  useEffect(() => {
    const onCameraDecision = (e: Event) => {
      const d = (e as CustomEvent<{ id?: string; approved?: boolean }>).detail;
      if (!d?.id || !domMgrRef.current) return;
      if (d.approved) void domMgrRef.current.land(d.id);
      else void domMgrRef.current.decline(d.id);
    };
    window.addEventListener('gmatch:domination-camera-decision', onCameraDecision);
    return () => window.removeEventListener('gmatch:domination-camera-decision', onCameraDecision);
  }, [])

  const createRoom = useCallback((name: string): Room | null => roomsRef.current?.createRoom(name) ?? null, [])
  const inviteToRoom = useCallback((roomId: string, peerId: string) => {
    const r = roomsRef.current
    return r ? r.invite(roomId, peerId) : Promise.resolve(false)
  }, [])
  const sayInRoom = useCallback((roomId: string, text: string) => {
    const r = roomsRef.current
    return r ? r.say(roomId, text, ownDisplayName() || undefined) : Promise.resolve(null)
  }, [])
  const leaveRoom = useCallback((roomId: string) => roomsRef.current?.leave(roomId), [])
  const roomMessages = useCallback((roomId: string) => roomsRef.current?.messages(roomId) ?? [], [])

  const courierActive = useMemo(() => mode === 'courier' && !!identity, [mode, identity])

  return { mode, courierActive, send, pull, threadFor, registerPeerKeys, meshSend, meshPeerKnown, threads, rooms, createRoom, inviteToRoom, sayInRoom, leaveRoom, roomMessages, edit, remove, react, type, markRead, isTyping }
}
