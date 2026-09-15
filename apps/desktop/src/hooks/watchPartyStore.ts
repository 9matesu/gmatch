// Watch Party client store: module singleton + useSyncExternalStore.
// Control frames only travel while a party is open; zero traffic otherwise.
// Up to MAX_SLOTS parties can play side by side; each is its own WS room.
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

export interface PartyRuntime extends PartyInfo {
  frame: SyncFrame | null
  members: Array<{ id: string; name: string }>
}

export interface WatchPartyState {
  open: boolean
  parties: PartyRuntime[]
  subscribed: boolean
}

export const MAX_SLOTS = 4

const state: WatchPartyState = { open: false, parties: [], subscribed: false }

// Immutable snapshot rebuilt on every mutation (getSnapshot must change
// reference when data changes, or useSyncExternalStore never re-renders).
let snapshot: WatchPartyState = { ...state, parties: [] }

const listeners = new Set<() => void>()
function emit() {
  snapshot = { ...state, parties: state.parties.map((p) => ({ ...p })) }
  for (const l of listeners) l()
}

export const watchPartyStore = {
  getSnapshot: () => snapshot,
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

function upsertParty(info: PartyInfo): void {
  const existing = state.parties.find((p) => p.id === info.id)
  if (existing) Object.assign(existing, info)
  else state.parties.push({ ...info, frame: null, members: [] })
  if (state.parties.length > MAX_SLOTS) state.parties.shift()
  watchPartyStore.set({})
}

export function resetWatchParty(): void {
  stopClockPing()
  unsubscribe?.()
  unsubscribe = null
  watchPartyStore.set({ open: false, parties: [], subscribed: false })
}

export function handleWatchMessage(msg: any): void {
  if (!msg || typeof msg !== 'object') return
  if (msg.type === 'watch.sync' || msg.type === 'watch.roster') {
    const party = state.parties.find((p) => p.id === msg.party)
    if (!party) return
    if (msg.type === 'watch.sync') party.frame = msg.frame as SyncFrame
    else party.members = Array.isArray(msg.members) ? msg.members : []
    watchPartyStore.set({})
    return
  }
  if (msg.type === 'watch.pong') {
    pongResolve?.(msg)
  }
}

let unsubscribe: (() => void) | null = null
let pongResolve: ((v: any) => void) | null = null

function pingOnce(): Promise<{ t0: number; t1: number; t3: number }> {
  return new Promise((resolve) => {
    const t0 = Date.now() / 1000
    const done = (pong: any) => {
      const t3 = Date.now() / 1000
      if (pongResolve === done) pongResolve = null
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

function ensureSubscribed(identity: IdentityLike): void {
  if (!state.subscribed) {
    unsubscribe?.()
    unsubscribe = subscribeOrbitWebSocket(identity, handleWatchMessage)
    watchPartyStore.set({ subscribed: true })
    startClockPing()
  }
}

function maybeUnsubscribe(): void {
  if (state.parties.length === 0 && state.subscribed) {
    stopClockPing()
    unsubscribe?.()
    unsubscribe = null
    watchPartyStore.set({ subscribed: false })
  }
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

export async function joinPartyById(identity: IdentityLike, partyId: string): Promise<boolean> {
  try {
    const res = await orbitFetch(`/api/watchparty/${partyId}`, {}, identity)
    if (!res.ok) return false
    const snap = await res.json() as any
    joinParty(identity, { id: snap.id, name: snap.name, url: snap.url })
    return true
  } catch {
    return false
  }
}

export function joinParty(identity: IdentityLike, party: PartyInfo): void {
  ensureSubscribed(identity)
  upsertParty(party)
  watchPartyStore.set({ open: true })
  sendOrbitWebSocket({ type: 'watch.join', party: party.id, name: identity.orbitId })
}

export function leaveParty(partyId: string): void {
  state.parties = state.parties.filter((p) => p.id !== partyId)
  watchPartyStore.set({})
  maybeUnsubscribe()
}

/** Send a party transport command. The server re-stamps and relays it. */
export function controlPlayback(partyId: string, action: 'play' | 'pause', position: number): void {
  if (!sendOrbitWebSocket({ type: 'watch', party: partyId, action, position: Math.max(0, position) })) {
    logger.warn('[watch] control frame dropped (socket offline)')
  }
}

export function useWatchParty(): WatchPartyState {
  return useSyncExternalStore(watchPartyStore.subscribe, watchPartyStore.getSnapshot)
}
