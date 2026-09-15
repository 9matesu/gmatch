// Watch Party client store: module singleton + useSyncExternalStore.
// Control frames only travel while a party is open; zero traffic otherwise.
import { useSyncExternalStore } from 'react'
import { orbitFetch } from '../utils/api'
import { subscribeOrbitWebSocket, sendOrbitWebSocket } from '../utils/orbitWebSocket'
import { ClockOffset, type SyncFrame } from '../utils/watchSync'
import { logger } from '../utils/logger'

interface IdentityLike {
  orbitId: string
  publicKeyHex: string
  privateKeyHex: string
}

export interface PartyInfo {
  id: string
  name: string
  url: string
}

export interface WatchPartyState {
  open: boolean
  party: PartyInfo | null
  frame: SyncFrame | null
  members: Array<{ id: string; name: string }>
  subscribed: boolean
}

export const MAX_SLOTS = 4

const state: WatchPartyState = {
  open: false,
  party: null,
  frame: null,
  members: [],
  subscribed: false,
}

const listeners = new Set<() => void>()
function emit() {
  for (const l of listeners) l()
}

export const watchPartyStore = {
  getSnapshot: () => state,
  subscribe: (l: () => void) => {
    listeners.add(l)
    return () => listeners.delete(l)
  },
  set: (patch: Partial<WatchPartyState>) => {
    Object.assign(state, patch)
    emit()
  },
}

export const clock = new ClockOffset()

export function serverNow(): number {
  return clock.now()
}

export function resetWatchParty(): void {
  stopClockPing()
  unsubscribe?.()
  unsubscribe = null
  watchPartyStore.set({ open: false, party: null, frame: null, members: [], subscribed: false })
}

export function handleWatchMessage(msg: any): void {
  if (!msg || typeof msg !== 'object') return
  const party = watchPartyStore.getSnapshot().party
  if (msg.type === 'watch.sync' && party && msg.party === party.id) {
    watchPartyStore.set({ frame: msg.frame as SyncFrame })
    return
  }
  if (msg.type === 'watch.roster' && party && msg.party === party.id) {
    watchPartyStore.set({ members: Array.isArray(msg.members) ? msg.members : [] })
    return
  }
  if (msg.type === 'watch.pong') {
    pongResolve?.(msg)
    return
  }
}

let unsubscribe: (() => void) | null = null
let pongResolve: ((v: any) => void) | null = null

function pingOnce(): Promise<{ t0: number; t1: number; t3: number }> {
  return new Promise((resolve) => {
    const t0 = Date.now() / 1000
    const done = (pong: any) => {
      const t3 = Date.now() / 1000
      pongResolve = null
      resolve({ t0, t1: Number(pong?.t1) || t3, t3 })
    }
    pongResolve = done
    if (!sendOrbitWebSocket({ type: 'watch.ping', t0 })) {
      done({ t1: t0 })
    }
    // never hang the estimator if the pong is lost
    setTimeout(() => {
      if (pongResolve === done) done({ t1: t0 })
    }, 3000)
  })
}

let pingTimer: ReturnType<typeof setTimeout> | null = null
function startClockPing(): void {
  stopClockPing()
  let sent = 0
  const tick = () => {
    void clock.sample(pingOnce)
    sent += 1
    // burst the first samples for a fast lock, then idle
    pingTimer = setTimeout(tick, sent < 3 ? 2000 : 30000)
  }
  tick()
}
function stopClockPing(): void {
  if (pingTimer) clearTimeout(pingTimer)
  pingTimer = null
  pongResolve = null
}

export async function createParty(identity: IdentityLike, url: string, name: string): Promise<{ ok: boolean; error?: string }> {
  let res: Response
  try {
    res = await orbitFetch('/api/watchparty', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, name }),
    }, identity)
  } catch {
    return { ok: false, error: 'Could not reach the server.' }
  }
  const body = await res.json().catch(() => ({})) as any
  if (!res.ok) return { ok: false, error: body?.error || 'Could not find a playable video at that link.' }
  joinParty(identity, body.party)
  return { ok: true }
}

export function joinParty(identity: IdentityLike, party: PartyInfo): void {
  unsubscribe?.()
  unsubscribe = subscribeOrbitWebSocket(identity, handleWatchMessage)
  watchPartyStore.set({ party, open: true, frame: null, members: [], subscribed: true })
  sendOrbitWebSocket({ type: 'watch.join', party: party.id, name: identity.orbitId })
  startClockPing()
}

export function leaveParty(): void {
  stopClockPing()
  unsubscribe?.()
  unsubscribe = null
  watchPartyStore.set({ party: null, frame: null, members: [], subscribed: false })
}

/** Send a party transport command. The server re-stamps and relays it. */
export function controlPlayback(action: 'play' | 'pause', position: number): void {
  const { party } = watchPartyStore.getSnapshot()
  if (!party) return
  if (!sendOrbitWebSocket({ type: 'watch', party: party.id, action, position: Math.max(0, position) })) {
    logger.warn('[watch] control frame dropped (socket offline)')
  }
}

export function useWatchParty(): WatchPartyState {
  return useSyncExternalStore(watchPartyStore.subscribe, watchPartyStore.getSnapshot)
}
