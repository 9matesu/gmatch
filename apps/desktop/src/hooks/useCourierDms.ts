import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { OrbitIdentity } from '@orbit/crypto'
import { MailClient, type MailSocket } from '../utils/mail-client'
import { DmManager, DmStore, type DmMessage } from '../utils/mail-dm'
import { detectMailMode, type MailMode } from '../utils/mail-mode'
import { getApiBaseUrl } from '../utils/api'
import { logger } from '../utils/logger'

export interface CourierDeps {
  webSocketFactory?: (url: string) => MailSocket
  fetchImpl?: typeof fetch
  /** Inbound DM arrived (opened + stored): surface sound/toast. */
  onNotify?: (msg: DmMessage) => void
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
  const clientRef = useRef<MailClient | null>(null)
  const managerRef = useRef<DmManager | null>(null)
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
    const facade: Pick<MailClient, 'send'> = {
      send: (body, kind, recipient, opts) => {
        if (!clientRef.current) return Promise.reject(new Error('mail client not ready'))
        return clientRef.current.send(body, kind, recipient, opts)
      },
    }
    const manager = new DmManager({
      mail: facade as unknown as MailClient,
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
      onMail: (opened, env) => manager.handleOpened(opened, env),
      log: (m) => logger.log(m),
    })
    storeRef.current = store
    managerRef.current = manager
    clientRef.current = client
    client.start()
    setThreads(store.threads())
    void client.pull() // drain whatever arrived while closed
    return () => {
      client.stop()
      clientRef.current = null
      managerRef.current = null
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

  const courierActive = useMemo(() => mode === 'courier' && !!identity, [mode, identity])

  return { mode, courierActive, send, pull, threadFor, registerPeerKeys, threads }
}
