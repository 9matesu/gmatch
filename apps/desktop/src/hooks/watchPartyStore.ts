// Watch Rooms client store: module singleton + useSyncExternalStore.
// Control frames only travel while a room is open; zero traffic otherwise.
// Up to MAX_SLOTS rooms can play side by side; each is its own WS room.
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

export interface QueueEntry {
  id: string
  name: string
  url: string
}

export interface PartyRuntime extends PartyInfo {
  frame: (SyncFrame & { by?: string }) | null
  members: Array<{ id: string; name: string; muted?: boolean }>
  chat: Array<{ id: string; from?: string; name: string; text: string; at: number; sys?: boolean }>
  host: string
  mutedIds: Record<string, boolean>
  lockVideo: boolean
  isPrivate: boolean
  mediaName: string
  queue: QueueEntry[]
  current: string
}

export interface WatchPartyState {
  open: boolean
  parties: PartyRuntime[]
  subscribed: boolean
  kickedNotice: string
}

export const MAX_SLOTS = 4

const state: WatchPartyState = { open: false, parties: [], subscribed: false, kickedNotice: '' }

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

// Display name for the room roster (App sets it after profile load).
let myDisplayName = ''
export function setWatchDisplayName(name: string): void {
  myDisplayName = name.slice(0, 40)
}

function blankParty(info: PartyInfo): PartyRuntime {
  return {
    ...info,
    frame: null,
    members: [],
    chat: [],
    host: '',
    mutedIds: {},
    lockVideo: false,
    isPrivate: false,
    mediaName: '',
    queue: [],
    current: '',
  }
}

function upsertParty(info: PartyInfo): PartyRuntime {
  let existing = state.parties.find((p) => p.id === info.id)
  if (!existing) {
    existing = blankParty(info)
    state.parties.push(existing)
  } else {
    Object.assign(existing, info)
  }
  if (state.parties.length > MAX_SLOTS) state.parties.shift()
  return existing
}

export function resetWatchParty(): void {
  stopClockPing()
  unsubscribe?.()
  unsubscribe = null
  subscribedIdentity = null
  watchPartyStore.set({ open: false, parties: [], subscribed: false, kickedNotice: '' })
}

export function handleWatchMessage(msg: any): void {
  if (!msg || typeof msg !== 'object') return
  if (msg.type === '__ws_reconnected') {
    // The server-side socket is brand new and holds no watch rooms: re-join
    // everything we still have open. The join snapshot restores position.
    if (!subscribedIdentity) return
    for (const p of state.parties) {
      sendOrbitWebSocket({ type: 'watch.join', party: p.id, name: myDisplayName || subscribedIdentity.orbitId })
    }
    return
  }
  if (msg.type === 'watch.kicked' || msg.type === 'watch.gone') {
    const party = state.parties.find((p) => p.id === msg.party)
    if (party) {
      state.parties = state.parties.filter((p) => p.id !== msg.party)
      watchPartyStore.set({
        kickedNotice: msg.type === 'watch.gone'
          ? `"${party.name}" has closed.`
          : `Removed from ${party.name}.`,
      })
      maybeUnsubscribe()
    }
    return
  }
  if (msg.type === 'watch.sync' || msg.type === 'watch.roster' || msg.type === 'watch.chat'
      || msg.type === 'watch.chat_del' || msg.type === 'watch.system'
      || msg.type === 'watch.settings' || msg.type === 'watch.queue') {
    const party = state.parties.find((p) => p.id === msg.party)
    if (!party) return
    switch (msg.type) {
      case 'watch.sync':
        party.frame = msg.frame
        break
      case 'watch.roster':
        party.members = Array.isArray(msg.members) ? msg.members : []
        if (typeof msg.host === 'string' && msg.host) party.host = msg.host
        for (const m of party.members) if (m.muted) party.mutedIds[m.id] = true
        // join snapshots ride this frame: full state recovery in one message
        if (msg.frame) party.frame = msg.frame
        if (Array.isArray(msg.chat)) party.chat = msg.chat.map((c: any) => ({ id: String(c.id || ''), from: String(c.from || ''), name: String(c.name || ''), text: String(c.text || ''), at: Number(c.at) || 0 }))
        if (Array.isArray(msg.queue)) party.queue = msg.queue.map((q: any) => ({ id: String(q.id), name: String(q.name), url: String(q.url) }))
        if (typeof msg.current === 'string') {
          party.current = msg.current
          party.mediaName = party.queue.find((q) => q.id === party.current)?.name || party.mediaName
        }
        break
      case 'watch.chat':
        party.chat = [...party.chat, { id: String(msg.msgId || ''), from: String(msg.from?.id || ''), name: msg.from?.name || 'Unknown User', text: String(msg.text || '').slice(0, 80), at: Number(msg.at) || Date.now() }].slice(-80)
        break
      case 'watch.chat_del':
        party.chat = party.chat.filter((c) => c.id !== String(msg.msgId))
        break
      case 'watch.system':
        party.chat = [...party.chat, { id: `sys${Date.now()}`, name: '', text: String(msg.text || ''), at: Date.now(), sys: true }].slice(-80)
        break
      case 'watch.settings':
        if (typeof msg.name === 'string') party.name = msg.name
        if (typeof msg.isPrivate === 'boolean') party.isPrivate = msg.isPrivate
        if (typeof msg.lockVideo === 'boolean') party.lockVideo = msg.lockVideo
        if (msg.muted && typeof msg.muted === 'object') party.mutedIds = { ...party.mutedIds, ...msg.muted }
        break
      case 'watch.queue':
        party.queue = Array.isArray(msg.queue) ? msg.queue : []
        party.current = String(msg.current || '')
        if (msg.frame) {
          party.frame = msg.frame
          party.url = String(msg.frame.url || party.url)
          const entry = party.queue.find((q) => q.id === party.current)
          party.mediaName = entry?.name || ''
        }
        break
    }
    watchPartyStore.set({})
    return
  }
  if (msg.type === 'watch.pong') {
    pongResolve?.(msg)
  }
}

let unsubscribe: (() => void) | null = null
let pongResolve: ((v: any) => void) | null = null
let subscribedIdentity: IdentityLike | null = null

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
    subscribedIdentity = identity
    watchPartyStore.set({ subscribed: true })
    startClockPing()
  }
}

function maybeUnsubscribe(): void {
  if (state.parties.length === 0 && state.subscribed) {
    stopClockPing()
    unsubscribe?.()
    unsubscribe = null
    subscribedIdentity = null
    watchPartyStore.set({ subscribed: false })
  }
}

export async function createParty(identity: IdentityLike, url: string, name: string): Promise<{ ok: boolean; partyId?: string; error?: string }> {
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
  return { ok: true, partyId: body.party?.id }
}

/** Resolve + queue/change a room's video over HTTP (the server runs the
 * media pipeline, then relays the queue frame). */
export async function loadPartyVideo(identity: IdentityLike, partyId: string, url: string, name: string, queueOnly = false): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await orbitFetch(`/api/watchparty/${partyId}/video`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, name, queueOnly }),
    }, identity)
    const body = await res.json().catch(() => ({})) as any
    if (!res.ok) return { ok: false, error: body?.error || 'Could not find a playable video at that link.' }
    return { ok: true }
  } catch {
    return { ok: false, error: 'Could not reach the server.' }
  }
}

export async function loadPartyVideos(
  identity: IdentityLike, partyId: string, urls: string[], queueOnly = false,
): Promise<{ ok: boolean; added: number; failed: string[]; error?: string }> {
  try {
    const res = await orbitFetch(`/api/watchparty/${partyId}/video`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls, queueOnly }),
    }, identity)
    const body = await res.json().catch(() => ({})) as any
    if (!res.ok) return { ok: false, added: 0, failed: Array.isArray(body?.failed) ? body.failed.map(String) : [], error: body?.error || 'Could not load these videos.' }
    return { ok: true, added: (body.added || []).length, failed: body.failed || [] }
  } catch {
    return { ok: false, added: 0, failed: [], error: 'Could not reach the server.' }
  }
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
  watchPartyStore.set({ kickedNotice: '' })
  upsertParty(party)
  watchPartyStore.set({ open: true })
  sendOrbitWebSocket({ type: 'watch.join', party: party.id, name: myDisplayName || identity.orbitId })
}

export function sendPartyChat(partyId: string, text: string): void {
  const trimmed = text.trim().slice(0, 80)
  if (!trimmed) return
  sendOrbitWebSocket({ type: 'watch.chat', party: partyId, text: trimmed })
}

export function deletePartyChat(partyId: string, msgId: string): void {
  sendOrbitWebSocket({ type: 'watch.chat.del', party: partyId, msgId })
}

/** One-shot room command frames (kick/ban/mute/host/settings/queue ops). */
export function sendRoomFrame(type: string, payload: Record<string, unknown>): void {
  sendOrbitWebSocket({ type, ...payload })
}

/** Host-gated UI helpers ride one generic frame type; the server gates. */
export function kickParty(partyId: string, target: string): void {
  sendRoomFrame('watch.kick', { party: partyId, target })
}
export function banParty(partyId: string, target: string): void {
  sendRoomFrame('watch.ban', { party: partyId, target })
}
export function muteParty(partyId: string, target: string, on: boolean): void {
  sendRoomFrame('watch.mute', { party: partyId, target, on })
}
export function transferParty(partyId: string, target: string): void {
  sendRoomFrame('watch.host', { party: partyId, target })
}
export function setPartySettings(partyId: string, patch: { name?: string; isPrivate?: boolean; lockVideo?: boolean }): void {
  sendRoomFrame('watch.settings', { party: partyId, ...patch })
}
export function queueOp(partyId: string, op: 'remove' | 'play' | 'next', id = ''): void {
  sendRoomFrame('watch.queue', { party: partyId, op, id })
}

export function leaveParty(partyId: string): void {
  sendOrbitWebSocket({ type: 'watch.leave', party: partyId })
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
