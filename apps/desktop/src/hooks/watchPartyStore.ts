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
  hash?: string
  size?: number
  local?: boolean
  status?: 'queued' | 'proposed' | 'unavailable'
  provider?: string
}

export interface PartyRuntime extends PartyInfo {
  frame: (SyncFrame & { by?: string; rev?: number }) | null
  members: Array<{ id: string; name: string; muted?: boolean }>
  chat: Array<{ id: string; from?: string; name: string; text: string; at: number; sys?: boolean }>
  host: string
  mutedIds: Record<string, boolean>
  lockVideo: boolean
  isPrivate: boolean
  sharedControl: boolean
  requireApproval: boolean
  mediaName: string
  queue: QueueEntry[]
  current: string
  frameRev: number
  queueRev: number
  settingsRev: number
  /** Local-file readiness: entryId -> member ids that verified the bytes. */
  ready: Record<string, string[]>
}

export interface WatchPartyState {
  open: boolean
  parties: PartyRuntime[]
  subscribed: boolean
  kickedNotice: string
}

export const MAX_SLOTS = 4

const state: WatchPartyState = { open: false, parties: [], subscribed: false, kickedNotice: '' }

// ---------------------------------------------------------------------------
// Remembered rooms
//
// The server deliberately never deletes an emptied room (watchparty.ts
// removeMember), and it serializes name/media/queue/chat to watchparties.json
// every 30s. So the room survives — but this store is a MODULE-LEVEL SINGLETON
// with no persistence at all: a reload, a crash or an app restart wiped
// `parties`, and a private room you left then became unreachable (listParties
// filters out private rooms). Remembering the ids locally is what makes "I
// created a room, left, came back" actually work.
//
// Entries are a re-entry hint only. The authoritative name/media/queue/chat
// always come back from GET /api/watchparty/:id, so a stale entry can never
// resurrect a room that really ended — restore treats 404 as "forget it".
// ---------------------------------------------------------------------------
const REMEMBERED_KEY = 'gmatch_watchparties_v1'
const REMEMBERED_MAX = 12

export interface RememberedRoom {
  id: string
  name: string
  /** Last known media URL, for instant title/poster before the snapshot lands. */
  url?: string
  /** ISO timestamp of the last time we were in this room. */
  at: number
}

function readRemembered(): RememberedRoom[] {
  try {
    if (typeof localStorage === 'undefined') return []
    const raw = localStorage.getItem(REMEMBERED_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((r: any) => r && typeof r.id === 'string' && r.id)
      .map((r: any) => ({ id: String(r.id), name: String(r.name || 'Watch party'), url: r.url ? String(r.url) : undefined, at: Number(r.at) || 0 }))
  } catch {
    return []
  }
}

let rememberedCache: RememberedRoom[] | null = null
/** The remembered set, in memory, seeded from storage on first use. */
function remembered(): RememberedRoom[] {
  if (rememberedCache === null) rememberedCache = readRemembered()
  return rememberedCache
}

let rememberedWriteTimer: ReturnType<typeof setTimeout> | null = null
function scheduleRememberedWrite(): void {
  if (typeof window === 'undefined') return
  if (rememberedWriteTimer) clearTimeout(rememberedWriteTimer)
  rememberedWriteTimer = setTimeout(() => {
    rememberedWriteTimer = null
    try {
      const rows = remembered()
        .slice()
        .sort((a, b) => b.at - a.at)
        .slice(0, REMEMBERED_MAX)
      localStorage.setItem(REMEMBERED_KEY, JSON.stringify(rows))
    } catch { /* private mode */ }
  }, 400)
}

/** Note a room as mine (join/create/rejoin). */
function rememberRoom(id: string, name: string, url?: string): void {
  const rows = remembered().filter((r) => r.id !== id)
  rows.push({ id, name: name || 'Watch party', url, at: Date.now() })
  rememberedCache = rows
  scheduleRememberedWrite()
}

/**
 * Drop a room we no longer want to remember — ONLY when the server says it
 * really ended. Leaving does not forget: that is the whole point of this list.
 */
function forgetRemembered(partyId: string): void {
  const rows = remembered().filter((r) => r.id !== partyId)
  if (rows.length === remembered().length) return
  rememberedCache = rows
  scheduleRememberedWrite()
}

/**
 * Rooms this device opened that are not currently joined — the "recently
 * watched" list. Includes PRIVATE rooms, which the server's public listing
 * deliberately omits, so a private room is still reachable after leaving it.
 * `excludeIds` should carry the currently-joined rooms: a room you are IN is
 * not "recently watched", and it must be listed immediately after you leave it
 * (an age-based filter would hide it for exactly as long as you are most
 * likely to be looking for it).
 */
export function rememberedRooms(excludeIds: string[] = []): RememberedRoom[] {
  const skip = new Set(excludeIds)
  return remembered()
    .filter((r) => !skip.has(r.id))
    .sort((a, b) => b.at - a.at)
}

/**
 * Re-join every room this device remembers. Runs at boot once the identity is
 * known: fetches each snapshot, re-joins what still exists, and forgets the
 * rest (a room the host disbanded is gone, not resurrected).
 */
export async function restoreRememberedParties(identity: IdentityLike): Promise<{ restored: number; gone: number }> {
  const rows = rememberedRooms()
  if (rows.length === 0) return { restored: 0, gone: 0 }
  let restored = 0
  let gone = 0
  for (const row of rows) {
    try {
      const res = await orbitFetch(`/api/watchparty/${encodeURIComponent(row.id)}`, {}, identity)
      if (!res.ok) {
        // 404 = the room ended for good. Anything else (offline, 5xx) is
        // transient, so keep the entry and try again next boot.
        if (res.status === 404) forgetRemembered(row.id)
        else continue
        gone += 1
        continue
      }
      const snap = await res.json() as any
      if (!snap?.id) continue
      joinParty(identity, { id: snap.id, name: snap.name || row.name, url: snap.url || row.url })
      restored += 1
    } catch {
      /* offline: keep the entry */
    }
  }
  return { restored, gone }
}

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
    sharedControl: false,
    requireApproval: false,
    mediaName: '',
    queue: [],
    current: '',
    frameRev: 0,
    queueRev: 0,
    settingsRev: 0,
    ready: {},
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
  if (state.parties.length > MAX_SLOTS) {
    // This used to shift() the oldest room out with no signal at all, which is
    // indistinguishable from "the room disappeared". Say so instead — and keep
    // the room remembered so it is not lost, just closed.
    const dropped = state.parties.shift()
    if (dropped) {
      rememberRoom(dropped.id, dropped.name, dropped.url)
      watchPartyStore.set({ kickedNotice: `${MAX_SLOTS} rooms open — "${dropped.name}" was closed to make room.` })
    }
  }
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
  if (msg.type === 'watch.nack') {
    // Our control frame was refused (non-host, or the 200ms throttle). The
    // optimistic frame we applied locally is a lie; roll it back to the last
    // authoritative one and say why, instead of leaving the button showing
    // "playing" while the room is paused.
    const p = state.parties.find((x) => x.id === msg.party)
    if (p) {
      logger.warn(`[watch] control frame refused (${msg.action}) — not host, or throttled`)
      window.dispatchEvent(new CustomEvent('watch-control-refused', {
        detail: { party: msg.party, action: msg.action },
      }))
    }
    return
  }
  if (msg.type === 'watch.kicked' || msg.type === 'watch.gone') {
    const party = state.parties.find((p) => p.id === msg.party)
    if (party) {
      state.parties = state.parties.filter((p) => p.id !== msg.party)
      // Kicked is still a room I may return to; "gone" means it is over.
      if (msg.type === 'watch.gone') forgetRemembered(msg.party)
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
      case 'watch.sync': {
        const rev = Number(msg.frame?.rev)
        // Authoritative revisions only move forward. Legacy frames without a
        // revision are still applied; a stale revision is dropped.
        if (Number.isFinite(rev) && rev >= 0 && rev <= party.frameRev) break
        party.frame = msg.frame
        if (Number.isFinite(rev) && rev >= 0) party.frameRev = Math.floor(rev)
        break
      }
      case 'watch.roster': {
        party.members = Array.isArray(msg.members) ? msg.members : []
        if (typeof msg.host === 'string' && msg.host) party.host = msg.host
        for (const m of party.members) if (m.muted) party.mutedIds[m.id] = true
        // join snapshots ride this frame: full state recovery in one message
        if (msg.frame) {
          party.frame = msg.frame
          const rev = Number(msg.frame?.rev)
          if (Number.isFinite(rev) && rev >= 0) party.frameRev = Math.floor(rev)
        }
        if (Array.isArray(msg.chat)) party.chat = msg.chat.map((c: any) => ({ id: String(c.id || ''), from: String(c.from || ''), name: String(c.name || ''), text: String(c.text || ''), at: Number(c.at) || 0 }))
        if (Array.isArray(msg.queue)) party.queue = msg.queue.map((q: any) => ({ id: String(q.id), name: String(q.name), url: String(q.url), hash: typeof q.hash === 'string' ? q.hash : undefined, size: Number.isFinite(Number(q.size)) ? Number(q.size) : undefined, local: q.local === true ? true : undefined, status: q.status === 'proposed' || q.status === 'unavailable' ? q.status : undefined, provider: typeof q.provider === 'string' ? q.provider : undefined }))
        if (typeof msg.current === 'string') {
          party.current = msg.current
          party.mediaName = party.queue.find((q) => q.id === party.current)?.name || party.mediaName
        }
        const queueRev = Number((msg as any).queueRev)
        if (Number.isFinite(queueRev) && queueRev >= 0) party.queueRev = Math.floor(queueRev)
        const settingsRev = Number((msg as any).settingsRev)
        if (Number.isFinite(settingsRev) && settingsRev >= 0) party.settingsRev = Math.floor(settingsRev)
        if (msg.ready && typeof msg.ready === 'object') party.ready = msg.ready as Record<string, string[]>
        if (typeof (msg as any).sharedControl === 'boolean') party.sharedControl = (msg as any).sharedControl
        if (typeof (msg as any).requireApproval === 'boolean') party.requireApproval = (msg as any).requireApproval
        if (typeof (msg as any).lockVideo === 'boolean') party.lockVideo = (msg as any).lockVideo
        if (typeof (msg as any).isPrivate === 'boolean') party.isPrivate = (msg as any).isPrivate
        break
      }
      case 'watch.chat':
        party.chat = [...party.chat, { id: String(msg.msgId || ''), from: String(msg.from?.id || ''), name: msg.from?.name || 'Unknown User', text: String(msg.text || '').slice(0, 80), at: Number(msg.at) || Date.now() }].slice(-80)
        break
      case 'watch.chat_del':
        party.chat = party.chat.filter((c) => c.id !== String(msg.msgId))
        break
      case 'watch.system':
        party.chat = [...party.chat, { id: `sys${Date.now()}`, name: '', text: String(msg.text || ''), at: Date.now(), sys: true }].slice(-80)
        break
      case 'watch.settings': {
        const settingsRev = Number((msg as any).settingsRev)
        if (Number.isFinite(settingsRev) && settingsRev >= 0 && settingsRev <= party.settingsRev) break
        if (typeof msg.name === 'string') party.name = msg.name
        if (typeof msg.isPrivate === 'boolean') party.isPrivate = msg.isPrivate
        if (typeof msg.lockVideo === 'boolean') party.lockVideo = msg.lockVideo
        if (typeof (msg as any).sharedControl === 'boolean') party.sharedControl = (msg as any).sharedControl
        if (typeof (msg as any).requireApproval === 'boolean') party.requireApproval = (msg as any).requireApproval
        if (msg.muted && typeof msg.muted === 'object') party.mutedIds = { ...party.mutedIds, ...msg.muted }
        if (Number.isFinite(settingsRev) && settingsRev >= 0) party.settingsRev = Math.floor(settingsRev)
        break
      }
      case 'watch.queue': {
        const queueRev = Number((msg as any).queueRev)
        if (Number.isFinite(queueRev) && queueRev >= 0 && queueRev <= party.queueRev) break
        party.queue = Array.isArray(msg.queue) ? msg.queue : []
        party.current = String(msg.current || '')
        if (msg.frame) {
          party.frame = msg.frame
          const frameRev = Number(msg.frame?.rev)
          if (Number.isFinite(frameRev) && frameRev >= 0) party.frameRev = Math.floor(frameRev)
          party.url = String(msg.frame.url || party.url)
          const entry = party.queue.find((q) => q.id === party.current)
          party.mediaName = entry?.name || ''
        }
        if (Number.isFinite(queueRev) && queueRev >= 0) party.queueRev = Math.floor(queueRev)
        if (msg.ready && typeof msg.ready === 'object') party.ready = msg.ready as Record<string, string[]>
        break
      }
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

export interface ExpandPlaylistResult {
  ok: boolean
  isPlaylist: boolean
  count: number
  playlistTitle?: string
  items: Array<{ url: string; title?: string; playlistTitle?: string }>
  error?: string
}

function newCmdId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch { /* fall through */ }
  return `cmd-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`
}

export async function mintPartyInvite(identity: IdentityLike, partyId: string): Promise<{ ok: boolean; invite?: string; error?: string }> {
  try {
    const res = await orbitFetch(`/api/watchparty/${encodeURIComponent(partyId)}/invite`, { method: 'POST' }, identity)
    const body = await res.json().catch(() => ({})) as any
    if (!res.ok) return { ok: false, error: body?.error || 'Only the host can mint invites.' }
    return { ok: true, invite: String(body?.invite || '') }
  } catch {
    return { ok: false, error: 'Could not reach the server.' }
  }
}

export async function revokePartyInvite(identity: IdentityLike, partyId: string): Promise<boolean> {
  try {
    const res = await orbitFetch(`/api/watchparty/${encodeURIComponent(partyId)}/invite`, { method: 'DELETE' }, identity)
    return res.ok
  } catch {
    return false
  }
}
export async function expandPlaylist(identity: IdentityLike, url: string): Promise<ExpandPlaylistResult> {
  // 1. Try server-side expansion first
  try {
    const res = await orbitFetch('/api/watchparty/expand', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    }, identity)
    if (res.ok) {
      const body = await res.json().catch(() => ({})) as any
      const items = Array.isArray(body.items) ? body.items : []
      if (body.isPlaylist && items.length > 0) {
        return {
          ok: true,
          isPlaylist: true,
          count: Number(body.count) || items.length,
          playlistTitle: body.playlistTitle,
          items,
        }
      }
    }
  } catch {
    /* Fall through to client-side expander */
  }

  // 2. Client-side fallback: handles pmvhaven playlists even if central node is an older deploy
  const m = url.match(/(?:https?:\/\/)?(?:www\.)?pmvhaven\.com\/playlists?\/([0-9a-fA-F]{24}|[a-zA-Z0-9_-]{12,32})/i)
  if (m) {
    const playlistId = m[1]
    try {
      let data: any = null
      if (typeof window !== 'undefined' && (window as any).gmatch?.pmvPlaylist) {
        data = await (window as any).gmatch.pmvPlaylist(playlistId)
      } else {
        const reqUrl = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
          ? `/pmv-api/playlists/${playlistId}`
          : `https://pmvhaven.com/api/playlists/${playlistId}`
        const res = await fetch(reqUrl, {
          signal: AbortSignal.timeout(10_000),
        })
        if (res.ok) data = await res.json().catch(() => null)
      }

      if (data?.data) {
        const playlistName = typeof data.data.name === 'string' ? data.data.name.trim().slice(0, 60) : undefined
        const vids = Array.isArray(data.data.videos) ? data.data.videos : []
        const items = vids
          .map((v: unknown) => {
            if (typeof v === 'string') {
              return /^[0-9a-f]{24}$/.test(v) ? { url: `https://pmvhaven.com/video/${v}`, playlistTitle: playlistName } : null
            }
            const id = String((v as any)?._id || (v as any)?.id || '')
            const rawTitle = typeof (v as any)?.title === 'string' ? (v as any).title : (typeof (v as any)?.name === 'string' ? (v as any).name : '')
            const title = rawTitle ? rawTitle.trim().slice(0, 60) : undefined
            return /^[0-9a-f]{24}$/.test(id) ? { url: `https://pmvhaven.com/video/${id}`, title, playlistTitle: playlistName } : null
          })
          .filter((it: any): it is { url: string; title?: string; playlistTitle?: string } => Boolean(it))
          .slice(0, 50)

        if (items.length > 0) {
          return {
            ok: true,
            isPlaylist: true,
            count: items.length,
            playlistTitle: playlistName,
            items,
          }
        }
      }
    } catch {
      /* ignore and return single item below */
    }
  }

  return { ok: true, isPlaylist: false, count: 1, items: [{ url }] }
}

export async function createParty(identity: IdentityLike, url: string, name: string): Promise<{ ok: boolean; partyId?: string; error?: string; truncated?: boolean; source?: { kind: string; provider?: string; reason?: string; sync: string } }> {
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
  if (!res.ok) return { ok: false, error: body?.error || 'Could not find a playable video at that link.', source: body?.source }
  joinParty(identity, body.party)
  return { ok: true, partyId: body.party?.id, truncated: Boolean(body?.truncated) }
}

/** Create a room seeded by a consent-shared local file (no URL pipeline). */
export async function createPartyFromLocal(
  identity: IdentityLike,
  entry: { objectId: string; name: string; hash: string; size: number },
  roomName: string,
): Promise<{ ok: boolean; partyId?: string; error?: string }> {
  let res: Response
  try {
    res = await orbitFetch('/api/watchparty', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ localEntry: entry, name: roomName }),
    }, identity)
  } catch {
    return { ok: false, error: 'Could not reach the server.' }
  }
  const body = await res.json().catch(() => ({})) as any
  if (!res.ok) return { ok: false, error: body?.error || 'Could not start the party.' }
  joinParty(identity, body.party)
  return { ok: true, partyId: body.party?.id }
}

/** Resolve + queue/change a room's video over HTTP (the server runs the
 * media pipeline, then relays the queue frame). */
export async function loadPartyVideo(identity: IdentityLike, partyId: string, url: string, name: string, queueOnly = false): Promise<{ ok: boolean; error?: string; added?: number; failed?: string[]; failedDetails?: Array<{ url: string; kind: string; provider?: string; reason?: string; sync: string }>; truncated?: boolean }> {
  try {
    const res = await orbitFetch(`/api/watchparty/${partyId}/video`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, name, queueOnly, cmdId: newCmdId() }),
    }, identity)
    const body = await res.json().catch(() => ({})) as any
    if (!res.ok) return { ok: false, error: body?.error || 'Could not find a playable video at that link.', failedDetails: body?.failedDetails }
    return { ok: true, added: (body.added || []).length, failed: body.failed || [], failedDetails: body.failedDetails || [], truncated: Boolean(body?.truncated) }
  } catch {
    return { ok: false, error: 'Could not reach the server.' }
  }
}

export async function loadPartyVideos(
  identity: IdentityLike, partyId: string, urls: string[], queueOnly = false,
): Promise<{ ok: boolean; added: number; failed: string[]; failedDetails?: Array<{ url: string; kind: string; provider?: string; reason?: string; sync: string }>; truncated?: boolean; error?: string }> {
  try {
    const items = urls.map((url) => ({ url, cmdId: newCmdId() }))
    const res = await orbitFetch(`/api/watchparty/${partyId}/video`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, queueOnly }),
    }, identity)
    const body = await res.json().catch(() => ({})) as any
    if (!res.ok) return { ok: false, added: 0, failed: Array.isArray(body?.failed) ? body.failed.map(String) : [], failedDetails: body?.failedDetails, error: body?.error || 'Could not load these videos.' }
    return { ok: true, added: (body.added || []).length, failed: body.failed || [], failedDetails: body.failedDetails || [], truncated: Boolean(body?.truncated) }
  } catch {
    return { ok: false, added: 0, failed: [], error: 'Could not reach the server.' }
  }
}

export async function joinPartyById(identity: IdentityLike, partyId: string, invite?: string): Promise<boolean> {
  try {
    if (invite) {
      // Private-room invite redeem happens before the snapshot read, so an ID
      // alone never discloses private state. The token lives only in memory.
      const redeem = await orbitFetch(`/api/watchparty/${encodeURIComponent(partyId)}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invite }),
      }, identity)
      if (!redeem.ok) return false
    }
    const res = await orbitFetch(`/api/watchparty/${encodeURIComponent(partyId)}`, {}, identity)
    if (!res.ok) return false
    const snap = await res.json() as any
    joinParty(identity, { id: snap.id, name: snap.name || 'Watch party', url: snap.url || '' }, invite)
    return true
  } catch {
    return false
  }
}

export function joinParty(identity: IdentityLike, party: PartyInfo, invite?: string): void {
  ensureSubscribed(identity)
  watchPartyStore.set({ kickedNotice: '' })
  upsertParty(party)
  watchPartyStore.set({ open: true })
  rememberRoom(party.id, party.name, party.url)
  sendOrbitWebSocket({ type: 'watch.join', party: party.id, name: myDisplayName || identity.orbitId, ...(invite ? { invite } : {}) })
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
  sendOrbitWebSocket({ type, cmdId: newCmdId(), ...payload })
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
export function setPartySettings(partyId: string, patch: { name?: string; isPrivate?: boolean; lockVideo?: boolean; sharedControl?: boolean; requireApproval?: boolean }): void {
  sendRoomFrame('watch.settings', { party: partyId, ...patch })
}

/** UI mirror of the server transport gate: host, or members when shared. */
export function canControlParty(party: Pick<PartyRuntime, 'host' | 'sharedControl' | 'lockVideo' | 'members'>, userId: string): boolean {
  if (party.host && party.host === userId) return true
  return party.sharedControl && !party.lockVideo && party.members.some((m) => m.id === userId)
}
export function queueOp(partyId: string, op: 'remove' | 'play' | 'next' | 'prev' | 'approve' | 'flag' | 'unflag', id = ''): void {
  sendRoomFrame('watch.queue', { party: partyId, op, id })
}
export function moveQueueEntry(partyId: string, id: string, before: string): void {
  sendRoomFrame('watch.queue', { party: partyId, op: 'move', id, before })
}
/** Host closes the room for everyone (server answers watch.gone to all). */
export function disbandParty(partyId: string): void {
  sendRoomFrame('watch.disband', { party: partyId })
}

/**
 * Leave the room (the X button). Deliberately does NOT delete it: the server
 * keeps an emptied room, and the id stays in the remembered list so this device
 * can re-enter — including a PRIVATE room, which the public listing omits.
 */
export function leaveParty(partyId: string): void {
  sendOrbitWebSocket({ type: 'watch.leave', party: partyId })
  state.parties = state.parties.filter((p) => p.id !== partyId)
  watchPartyStore.set({})
  maybeUnsubscribe()
}

/** Send a party transport command. The server re-stamps and relays it. */
export function controlPlayback(partyId: string, action: 'play' | 'pause', position: number): void {
  if (!sendOrbitWebSocket({ type: 'watch', party: partyId, action, position: Math.max(0, position), cmdId: newCmdId() })) {
    logger.warn('[watch] control frame dropped (socket offline)')
    return
  }
  // Optimistic local frame. The server echoes the accepted frame back as
  // watch.sync, but a refused one (non-host, or the 200ms transport throttle
  // swallowing a second press inside one gesture) never arrives — so the button
  // used to snap back with no explanation. Applying it locally makes the control
  // feel instant; the authoritative echo (or a watch.nack) still wins.
  const party = state.parties.find((x) => x.id === partyId)
  if (!party || !party.frame) return
  party.frame = {
    ...party.frame,
    action,
    position: Math.max(0, position),
    updatedAt: serverNow(),
    rev: party.frameRev,
  }
  emit()
}

export function useWatchParty(): WatchPartyState {
  return useSyncExternalStore(watchPartyStore.subscribe, watchPartyStore.getSnapshot)
}
