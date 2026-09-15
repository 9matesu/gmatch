// Watch rooms: in-memory state + WS frame handling. Rooms are ephemeral by
// design (a cold node drops them; clients see 404 and say so honestly), so
// there is deliberately no migration here.
import { randomUUID } from 'node:crypto'

export interface PartyFrame {
  url: string
  action: 'play' | 'pause'
  position: number
  rate: number
  updatedAt: number
  /** Display name of the member who last moved the transport. */
  by?: string
}

export interface PartyMember {
  name: string
  muted: boolean
}

export interface QueueEntry {
  id: string
  name: string
  url: string
  relay?: { upstream: string; referer: string }
}

export interface ChatEntry {
  id: string
  from: string
  name: string
  text: string
  at: number
}

export interface Party {
  id: string
  name: string
  mediaUrl: string
  mediaName: string
  /** Relay mode: videos over the 50MB store cap stream through the hub. */
  relay?: { upstream: string; referer: string }
  hostId: string
  isPrivate: boolean
  lockVideo: boolean
  bans: Set<string>
  frame: PartyFrame
  members: Map<string, PartyMember>
  queue: QueueEntry[]
  current: string
  /** Session chat log (server-authoritative; joiners get the backlog). */
  chat: ChatEntry[]
  lastSeen: number
  /** ponytail: last chat msg ts per user; global bucket if flood persists. */
  lastChat: Map<string, number>
  lastControl: Map<string, number>
}

const parties = new Map<string, Party>()
const MAX_PARTIES = 50
// Overnight rooms: an open tab pings every 30s (touchRooms), so 4h only
// bounds abandoned rooms. 30 min GC'd a room during one long movie.
export const IDLE_MS = 4 * 60 * 60_000
// ponytail: fixed cap, per-room playlist size setting if someone hits 50.
export const MAX_QUEUE = 50
// media URL -> owning party id. Lets the objects route authorize reads for
// private party media without making it feed-public.
const partyMedia = new Map<string, string>()

export function createParty(
  name: string,
  mediaUrl: string,
  seedUrl: string,
  relay?: { upstream: string; referer: string },
  creatorId = '',
  forcedId = '',
): Party {
  gcTick()
  const party: Party = {
    id: forcedId || randomUUID().slice(0, 8),
    name: name.slice(0, 40) || 'Party',
    mediaUrl,
    mediaName: '',
    relay,
    hostId: creatorId,
    isPrivate: false,
    lockVideo: false,
    bans: new Set(),
    frame: { url: seedUrl, action: 'pause', position: 0, rate: 1, updatedAt: serverNow() },
    members: new Map(),
    queue: [],
    current: '',
    chat: [],
    lastSeen: Date.now(),
    lastChat: new Map(),
    lastControl: new Map(),
  }
  if (creatorId) party.members.set(creatorId, { name: '', muted: false })
  parties.set(party.id, party)
  if (mediaUrl) partyMedia.set(mediaUrl, party.id)
  return party
}

/** Set/replace a party's media URL after creation (relay needs the party id
 * first, so the route creates then binds). Keeps partyMedia consistent. */
export function setPartyMedia(party: Party, mediaUrl: string): void {
  if (party.mediaUrl) partyMedia.delete(party.mediaUrl)
  party.mediaUrl = mediaUrl
  party.frame.url = mediaUrl
  partyMedia.set(mediaUrl, party.id)
}

/** Media URL capability check for the objects route: party videos stay
 * private (never feed-public) but any holder of the URL may stream them.
 * The UUID path is the capability; party URLs only travel inside the room. */
export function isPartyMediaObject(mediaUrl: string): boolean {
  return partyMedia.has(mediaUrl)
}

export function getParty(id: string): Party | null {
  return parties.get(id) || null
}

/** Open public parties for the browse list. */
export function listParties(): Array<{ id: string; name: string; members: number; mediaName: string }> {
  return [...parties.values()]
    .filter((p) => !p.isPrivate)
    .map((p) => ({ id: p.id, name: p.name, members: p.members.size, mediaName: p.mediaName }))
}

export function partyRoom(id: string): string {
  return `watch:${id}`
}

function serverNow(): number {
  return Date.now() / 1000
}

function dropParty(party: Party): void {
  parties.delete(party.id)
  // Audit A8: every queued URL registered a capability, not just the
  // current one — clearing only mediaUrl left stale read grants forever.
  for (const entry of party.queue) partyMedia.delete(entry.url)
  if (party.mediaUrl) partyMedia.delete(party.mediaUrl)
}

function gcTick(): void {
  const now = Date.now()
  for (const [id, p] of parties) {
    if (now - p.lastSeen > IDLE_MS) dropParty(p)
  }
  while (parties.size > MAX_PARTIES) {
    // Audit A6: evict the least-recently-SEEN room, not the first created.
    let victimId = ''
    let victimSeen = Infinity
    for (const [id, p] of parties) {
      if (p.lastSeen < victimSeen) { victimSeen = p.lastSeen; victimId = id }
    }
    const p = parties.get(victimId)
    if (p) dropParty(p)
    parties.delete(victimId)
  }
}

function rosterPayload(party: Party): any {
  return {
    type: 'watch.roster',
    party: party.id,
    host: party.hostId,
    members: [...party.members.entries()].map(([id, m]) => ({ id, name: m.name, muted: m.muted })),
  }
}

/** Full room snapshot for joiners (position + chat + queue recovery). */
function snapshotPayload(party: Party): any {
  return { ...rosterPayload(party), frame: party.frame, chat: party.chat, queue: party.queue, current: party.current }
}

function pushSystem(party: Party, text: string): any {
  return { type: 'watch.system', party: party.id, text }
}

/** Validate + apply one client control frame. Returns null to drop it. */
export function applyWatch(userId: string, msg: any): { room: string; payload: any } | null {
  if (!msg || typeof msg !== 'object') return null
  const party = parties.get(String(msg.party || ''))
  const member = party?.members.get(userId)
  if (!party || !member) return null
  if (msg.action !== 'play' && msg.action !== 'pause') return null
  const position = Number(msg.position)
  if (!Number.isFinite(position) || position < 0) return null
  // V1 lock: party speed is always 1x. A rate != 1 frame is a desync bug or
  // a modified client; drop it.
  if (msg.rate !== undefined && Number(msg.rate) !== 1) return null
  // Audit A3: 200 ms/member transport throttle. Humans seek/play far less
  // often; a bot hammering this frame used to amplify x-members broadcasts.
  const now = Date.now()
  if (now - (party.lastControl.get(userId) || 0) < 200) return null
  party.lastControl.set(userId, now)
  party.lastSeen = now
  party.frame = {
    url: party.mediaUrl,
    action: msg.action,
    position,
    rate: 1,
    updatedAt: serverNow(),
    by: member.name || userId.slice(0, 8),
  }
  return { room: partyRoom(party.id), payload: { type: 'watch.sync', party: party.id, frame: party.frame } }
}

/** Handle watch.join: add member, return the snapshot payload for the room. */
export function joinWatch(userId: string, displayName: string, msg: any): { room: string; payload: any } | null {
  const party = parties.get(String(msg?.party || ''))
  if (!party || party.bans.has(userId)) return null
  if (party.members.size >= 8 && !party.members.has(userId)) return null
  party.members.set(userId, { name: String(displayName || '').slice(0, 40), muted: party.members.get(userId)?.muted || false })
  party.lastSeen = Date.now()
  const room = partyRoom(party.id)
  const who = String(displayName || '').slice(0, 40) || userId.slice(0, 8)
  return { room, payload: [snapshotPayload(party), pushSystem(party, `${who} joined`)] }
}

/** Explicit watch.leave (tab close uses leaveAll via the socket close hook). */
export function leaveWatch(userId: string, msg: any): { room: string; payload: any } | null {
  const party = parties.get(String(msg?.party || ''))
  if (!party || !party.members.has(userId)) return null
  return removeMember(party, userId, false)
}

/** Socket-close path: remove the user from every watch room they joined. */
export function leaveAll(userId: string): Array<{ room: string; payload: any }> {
  const out: Array<{ room: string; payload: any }> = []
  if (!userId) return out
  for (const party of [...parties.values()]) {
    if (party.members.has(userId)) {
      const res = removeMember(party, userId, true)
      if (res) out.push(res)
    }
  }
  return out
}

function removeMember(party: Party, userId: string, forceClose: boolean): { room: string; payload: any } | null {
  const who = party.members.get(userId)?.name || userId.slice(0, 8)
  party.members.delete(userId)
  const room = partyRoom(party.id)
  if (party.members.size === 0) {
    dropParty(party)
    return { room, payload: [pushSystem(party, `${who} left`)] }
  }
  if (party.hostId === userId) {
    party.hostId = party.members.keys().next().value || ''
  }
  void forceClose
  const payloads: any[] = [pushSystem(party, `${who} left`), rosterPayload(party)]
  return { room, payload: payloads }
}

/** Party chat: members only, 80 chars, 1 msg/2s per user. Text only. */
export function applyChat(userId: string, displayName: string, msg: any): { room: string; payload: any } | null {
  if (!msg || typeof msg !== 'object') return null
  const party = parties.get(String(msg.party || ''))
  const member = party?.members.get(userId)
  if (!party || !member || member.muted) return null
  const text = typeof msg.text === 'string' ? msg.text.trim().slice(0, 80) : ''
  if (!text) return null
  const now = Date.now()
  if (now - (party.lastChat.get(userId) || 0) < 2000) return null
  party.lastChat.set(userId, now)
  party.lastSeen = now
  const entry: ChatEntry = {
    id: randomUUID().slice(0, 8),
    from: userId,
    name: member.name || String(displayName || '').slice(0, 40),
    text,
    at: now,
  }
  party.chat.push(entry)
  if (party.chat.length > 80) party.chat.shift()
  return {
    room: partyRoom(party.id),
    payload: { type: 'watch.chat', party: party.id, msgId: entry.id, from: { id: userId, name: entry.name }, text, at: now },
  }
}

export function deleteChat(userId: string, msg: any): { room: string; payload: any } | null {
  const party = parties.get(String(msg?.party || ''))
  if (!party || !party.members.has(userId)) return null
  const idx = party.chat.findIndex((m) => m.id === String(msg?.msgId || ''))
  if (idx < 0) return null
  if (userId !== party.hostId && userId !== party.chat[idx].from) return null
  party.chat.splice(idx, 1)
  return { room: partyRoom(party.id), payload: { type: 'watch.chat_del', party: party.id, msgId: String(msg.msgId) } }
}

/** Send a direct frame to one user's live sockets (kick notice). Returns the
 * set of matched userIds for testability; ws-bus passes conns access. */
export function kickWatch(userId: string, msg: any): { room: string; payload: any; kicked?: string } | null {
  const party = parties.get(String(msg?.party || ''))
  if (!party || party.hostId !== userId) return null
  const target = String(msg?.target || '')
  if (!target || target === userId || !party.members.has(target)) return null
  const who = party.members.get(target)?.name || target.slice(0, 8)
  party.members.delete(target)
  const room = partyRoom(party.id)
  const payloads: any[] = [pushSystem(party, `${who} was removed`), rosterPayload(party)]
  if (party.members.size === 0) dropParty(party)
  return { room, payload: payloads, kicked: target }
}

export function banWatch(userId: string, msg: any): { room: string; payload: any; kicked?: string } | null {
  const party = parties.get(String(msg?.party || ''))
  if (!party || party.hostId !== userId) return null
  const target = String(msg?.target || '')
  if (!target || target === userId) return null
  party.bans.add(target)
  return kickWatch(userId, msg)
}

export function muteWatch(userId: string, msg: any): { room: string; payload: any } | null {
  const party = parties.get(String(msg?.party || ''))
  if (!party || party.hostId !== userId) return null
  const member = party.members.get(String(msg?.target || ''))
  if (!member) return null
  member.muted = Boolean(msg.on)
  const muted: Record<string, boolean> = { [String(msg.target)]: member.muted }
  return { room: partyRoom(party.id), payload: { type: 'watch.settings', party: party.id, muted } }
}

export function transferHost(userId: string, msg: any): { room: string; payload: any } | null {
  const party = parties.get(String(msg?.party || ''))
  if (!party || party.hostId !== userId) return null
  const target = String(msg?.target || '')
  if (!party.members.has(target)) return null
  party.hostId = target
  return { room: partyRoom(party.id), payload: rosterPayload(party) }
}

export function settingsWatch(userId: string, msg: any): { room: string; payload: any } | null {
  const party = parties.get(String(msg?.party || ''))
  if (!party || party.hostId !== userId) return null
  const payload: any = { type: 'watch.settings', party: party.id }
  if (typeof msg.name === 'string' && msg.name.trim()) {
    party.name = msg.name.trim().slice(0, 40)
    payload.name = party.name
  }
  if (typeof msg.isPrivate === 'boolean') {
    party.isPrivate = msg.isPrivate
    payload.isPrivate = party.isPrivate
  }
  if (typeof msg.lockVideo === 'boolean') {
    party.lockVideo = msg.lockVideo
    payload.lockVideo = party.lockVideo
  }
  if (payload.name === undefined && payload.isPrivate === undefined && payload.lockVideo === undefined) return null
  return { room: partyRoom(party.id), payload }
}

/** Queue ops (entries are already resolved media; resolution lives in the
 * route layer). 'add' never touches the playing frame; 'next' swaps it. */
export function queueOps(userId: string, msg: any): { room: string; payload: any } | null {
  const party = parties.get(String(msg?.party || ''))
  const member = party?.members.get(userId)
  if (!party || !member) return null
  if (party.lockVideo && party.hostId !== userId) return null
  const op = String(msg.op || '')
  if (op === 'add') {
    const url = typeof msg.url === 'string' ? msg.url : ''
    if (!url) return null
    party.queue.push({
      id: randomUUID().slice(0, 8),
      name: (typeof msg.name === 'string' ? msg.name : '').slice(0, 60) || 'Untitled',
      url,
      relay: msg.relay && typeof msg.relay.upstream === 'string' ? msg.relay : undefined,
    })
    while (party.queue.length > MAX_QUEUE) {
      const dropIdx = party.queue.findIndex((q) => q.id !== party.current)
      party.queue.splice(dropIdx < 0 ? 0 : dropIdx, 1)
    }
  } else if (op === 'remove') {
    party.queue = party.queue.filter((q) => q.id !== String(msg.id || ''))
  } else if (op === 'play') {
    const entry = party.queue.find((q) => q.id === String(msg.id || ''))
    if (entry) applyQueueMedia(party, entry, member.name || userId.slice(0, 8), 'play')
  } else if (op === 'next') {
    const idx = party.queue.findIndex((q) => q.id === party.current)
    const entry = party.queue[(idx + 1) % Math.max(party.queue.length, 1)]
    // Continuous playlist: a PLAYING room advances into a playing frame
    // (video ended mid-run); a paused room advances paused.
    if (entry && party.queue.length > 0) {
      applyQueueMedia(party, entry, member.name || userId.slice(0, 8),
        party.frame.action === 'play' ? 'play' : 'pause')
    }
  } else {
    return null
  }
  party.lastSeen = Date.now()
  return {
    room: partyRoom(party.id),
    payload: {
      type: 'watch.queue',
      party: party.id,
      queue: party.queue,
      current: party.current,
      frame: party.frame,
    },
  }
}

function applyQueueMedia(party: Party, entry: QueueEntry, by: string, action: 'play' | 'pause' = 'pause'): void {
  party.current = entry.id
  party.mediaName = entry.name
  party.relay = entry.relay
  setPartyMedia(party, entry.url)
  party.frame = { url: entry.url, action, position: 0, rate: 1, updatedAt: serverNow(), by }
}

/** Persistence: rooms die with the process otherwise, so every deploy
 * 404s live rooms. Members/chat are NOT persisted: tabs lost their
 * sockets anyway; clients re-join by id (watch.join) and rebuild the
 * roster around the resurrected frame. Bans are session-scoped too. */
export function serializeParties(): string {
  return JSON.stringify([...parties.values()].map((p) => ({
    id: p.id, name: p.name, mediaUrl: p.mediaUrl, mediaName: p.mediaName,
    relay: p.relay, hostId: p.hostId, isPrivate: p.isPrivate, lockVideo: p.lockVideo,
    frame: p.frame, queue: p.queue, current: p.current,
  })))
}

export function restoreParties(json: string): number {
  let rows: unknown
  try { rows = JSON.parse(json) } catch { return 0 }
  if (!Array.isArray(rows)) return 0
  let n = 0
  for (const raw of rows) {
    const s = raw as any
    if (!s || typeof s.id !== 'string' || typeof s.mediaUrl !== 'string' || !s.frame) continue
    if (parties.has(s.id)) continue
    const p = createParty(String(s.name || 'Party'), s.mediaUrl, s.mediaUrl, s.relay, String(s.hostId || ''), s.id)
    if (p.hostId) p.members.delete(p.hostId) // roster re-forms via watch.join
    p.mediaName = String(s.mediaName || '')
    p.isPrivate = Boolean(s.isPrivate)
    p.lockVideo = Boolean(s.lockVideo)
    p.frame = s.frame
    if (Array.isArray(s.queue)) p.queue = s.queue
    if (typeof s.current === 'string') p.current = s.current
    n++
  }
  return n
}

export function watchPong(t0: unknown): { type: string; t0: number; t1: number } {
  return { type: 'watch.pong', t0: Number(t0) || 0, t1: serverNow() }
}

/** Keep-alive: an awake member's ping refreshes every room they belong to,
 * so an idle-but-watching room never hits IDLE_MS. */
export function touchRooms(userId: string): void {
  if (!userId) return
  for (const p of parties.values()) {
    if (p.members.has(userId)) p.lastSeen = Date.now()
  }
}

/** Test seam: wipe state between suites. */
export function __resetParties(): void {
  parties.clear()
  partyMedia.clear()
}
