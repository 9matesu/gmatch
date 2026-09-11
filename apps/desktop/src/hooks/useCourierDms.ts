import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { OrbitIdentity } from '@orbit/crypto'
import { MailClient, type MailSocket } from '../utils/mail-client'
import { DmManager, DmStore, scopedKey, type DmMessage } from '../utils/mail-dm'
import { rotateEpoch, type EpochState } from '../utils/handleRotation'
import { getSecureItem, setSecureItem } from '../utils/secure-storage'
import { RoomManager, type Room, type RoomMessage } from '../utils/rooms'
import { detectMailMode, type MailMode } from '../utils/mail-mode'
import { getApiBaseUrl } from '../utils/api'
import { logger } from '../utils/logger'

export interface CourierDeps {
  webSocketFactory?: (url: string) => MailSocket
  fetchImpl?: typeof fetch
  /** Inbound DM/room arrived (opened + stored): surface sound/toast. */
  onNotify?: (msg: DmMessage) => void
  /** Inbound room message arrived. */
  onRoomMessage?: (msg: RoomMessage, room: Room) => void
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
  const [mode, setMode] = useState<MailMode>('legacy')
  const [threads, setThreads] = useState<Record<string, DmMessage[]>>({})
  const [rooms, setRoomsState] = useState<Room[]>([])
  const clientRef = useRef<MailClient | null>(null)
  const managerRef = useRef<DmManager | null>(null)
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
      onIncoming: (m) => depsRef.current.onNotify?.(m),
    })
    const client = new MailClient({
      apiBase: getApiBaseUrl(),
      identity,
      webSocketFactory: depsRef.current.webSocketFactory,
      fetchImpl: depsRef.current.fetchImpl,
      // DM first; if the opened body is not a DM/ack, try the room layer.
      onMail: (opened, env) => {
        if (!manager.handleOpened(opened, env)) roomMgr.handleOpened(opened)
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
      roomsRef.current = null
      storeRef.current = null
    }
  }, [identity, mode])

  const send = useCallback(async (peerId: string, text: string): Promise<DmMessage | null> => {
    if (!managerRef.current) return null
    return managerRef.current.send(peerId, text)
  }, [])

  const pull = useCallback(async () => {
    await clientRef.current?.pull()
    if (storeRef.current) setThreads(storeRef.current.threads())
  }, [])

  const threadFor = useCallback((peerId: string): DmMessage[] | null => {
    if (!storeRef.current) return null
    return storeRef.current.thread(peerId)
  }, [])

  const registerPeerKeys = useCallback((orbitId: string, publicKeyHex: string, encryptionPubHex: string) => {
    storeRef.current?.rememberPeer(orbitId, { publicKeyHex, encryptionPubHex })
  }, [])

  const createRoom = useCallback((name: string): Room | null => roomsRef.current?.createRoom(name) ?? null, [])
  const inviteToRoom = useCallback((roomId: string, peerId: string) => {
    const r = roomsRef.current
    return r ? r.invite(roomId, peerId) : Promise.resolve(false)
  }, [])
  const sayInRoom = useCallback((roomId: string, text: string) => {
    const r = roomsRef.current
    return r ? r.say(roomId, text) : Promise.resolve(null)
  }, [])
  const leaveRoom = useCallback((roomId: string) => roomsRef.current?.leave(roomId), [])
  const roomMessages = useCallback((roomId: string) => roomsRef.current?.messages(roomId) ?? [], [])

  const courierActive = useMemo(() => mode === 'courier' && !!identity, [mode, identity])

  return { mode, courierActive, send, pull, threadFor, registerPeerKeys, threads, rooms, createRoom, inviteToRoom, sayInRoom, leaveRoom, roomMessages }
}
