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
  /** Monotonic server revision. Clients apply only newer frames/snapshots. */
  rev: number
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
  /** SHA-256 of the bytes, when the entry is a consent-shared local file. */
  hash?: string
  /** Byte size, when known (local files, stored objects). */
  size?: number
  /** True for consent-shared local files (bytes live on the swarm, not the server). */
  local?: boolean
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
  /** Monotonic revisions, stamped only by the server. */
  frameRev: number
  queueRev: number
  settingsRev: number
  /** Active private-room invite token. Session-scoped by design: it is never
   * persisted, logged, or returned in snapshots/listings. */
  inviteToken?: string
  /** Recently seen client command IDs, for idempotent retries. Session-scoped. */
  recentCmds: Map<string, number>
  /** Local-file readiness: entryId -> member ids that verified the bytes.
   * Session-scoped by design (a restart re-verifies); never persisted. */
  ready: Map<string, Set<string>>
  members: Map<string, PartyMember>
  queue: QueueEntry[]
  current: string
  /** Session chat log (server-authoritative; joiners get the backlog). */
  chat: ChatEntry[]
  lastSeen: number
  /** Creation time (ms). Eviction order: rooms die oldest-created-first, so a
   *  long-lived room you still use is never the first casualty. */
  createdAt: number
  /** Grace timestamp when the room emptied, giving peers 15m to reconnect */
  emptySince?: number
  /** When the host last dropped. The host seat is held open for
   *  HOST_SEAT_GRACE_MS so a reload/blip doesn't promote a viewer for good. */
  hostLeftAt?: number
  /** ponytail: last chat msg ts per user; global bucket if flood persists. */
  lastChat: Map<string, number>
  lastControl: Map<string, number>
}

const parties = new Map<string, Party>()
// Rooms are deliberately immortal (an emptied room is never deleted, so peers
// can re-enter any time), which makes this cap the ONLY reclaim path. Tighter
// than the old 50 so an abandoned node does not accumulate forever.
const MAX_PARTIES = 25
// Rooms are persistent by design: an emptied room is never deleted, so peers
// can re-enter any time. There is no idle-room sweeper; only the 25-room cap,
// empty-media lease, disband, and eviction reclaim resources.
/** How long a departed host's seat is reserved before it is promoted away.
 *  Long enough to cover a tab reload or a short network drop. */
export const HOST_SEAT_GRACE_MS = 3 * 60_000
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
  createdAt = 0,
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
    frame: { url: seedUrl, action: 'pause', position: 0, rate: 1, updatedAt: serverNow(), rev: 1 },
    frameRev: 1,
    queueRev: 0,
    settingsRev: 0,
    inviteToken: undefined,
    recentCmds: new Map(),
    ready: new Map(),
    members: new Map(),
    queue: [],
    current: '',
    chat: [],
    lastSeen: Date.now(),
    createdAt: createdAt || Date.now(),
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
export function listParties(): Array<{ id: string; name: string; members: number; mediaName: string; mediaUrl: string }> {
  return [...parties.values()]
    .filter((p) => !p.isPrivate)
    .map((p) => ({
      id: p.id,
      name: p.name,
      members: p.members.size,
      mediaName: p.mediaName,
      mediaUrl: p.queue.find((q) => q.id === p.current)?.url || p.mediaUrl || '',
    }))
}

export function partyRoom(id: string): string {
  return `watch:${id}`
}

function serverNow(): number {
  return Date.now() / 1000
}

/** Coerce anything frame-shaped into a valid PartyFrame (see restoreParties). */
function sanitizeFrame(raw: any, fallbackUrl: string): PartyFrame {
  const position = Number(raw?.position)
  const updatedAt = Number(raw?.updatedAt)
  const rate = Number(raw?.rate)
  const rev = Number(raw?.rev)
  return {
    url: typeof raw?.url === 'string' && raw.url ? raw.url : fallbackUrl,
    action: raw?.action === 'play' ? 'play' : 'pause',
    position: Number.isFinite(position) && position >= 0 ? position : 0,
    rate: Number.isFinite(rate) && rate === 1 ? 1 : 1,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : serverNow(),
    rev: Number.isFinite(rev) && rev >= 0 ? Math.floor(rev) : 1,
    by: typeof raw?.by === 'string' ? raw.by : undefined,
  }
}

function sanitizeRev(raw: any): number {
  const rev = Number(raw)
  return Number.isFinite(rev) && rev >= 0 ? Math.floor(rev) : 0
}

/** Coerce anything queue-entry-shaped into a valid QueueEntry, or null. */
function sanitizeQueueEntry(raw: any): QueueEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim().slice(0, 8) : ''
  const url = typeof raw.url === 'string' ? raw.url : ''
  if (!id || !url) return null
  const hash = typeof raw.hash === 'string' && /^[0-9a-f]{64}$/i.test(raw.hash.trim()) ? raw.hash.trim().toLowerCase() : undefined
  const size = Number(raw.size)
  const entry: QueueEntry = {
    id,
    name: (typeof raw.name === 'string' ? raw.name : '').slice(0, 60) || 'Untitled',
    url,
    relay: raw.relay && typeof raw.relay.upstream === 'string' ? raw.relay : undefined,
    hash,
    size: Number.isFinite(size) && size > 0 ? Math.floor(size) : undefined,
    local: raw.local === true ? true : undefined,
  }
  return entry
}

/** Bounded idempotency registry for repeated client commands. */
const CMD_TTL_MS = 60_000
const MAX_CMDS = 200
function pruneCmds(party: Party): void {
  const now = Date.now()
  for (const [id, at] of party.recentCmds) {
    if (now - at > CMD_TTL_MS) party.recentCmds.delete(id)
  }
  while (party.recentCmds.size > MAX_CMDS) {
    const oldest = party.recentCmds.keys().next()
    if (oldest.done) break
    party.recentCmds.delete(oldest.value)
  }
}
function normalizeCmdId(raw: any): string | null {
  const s = typeof raw === 'string' ? raw.trim() : ''
  if (!s || s.length > 64) return null
  return s
}
/** Returns true for a repeated command ID (already applied or in flight). */
function claimCmd(party: Party, cmdId: string | null): boolean {
  if (!cmdId) return false
  pruneCmds(party)
  if (party.recentCmds.has(cmdId)) return true
  party.recentCmds.set(cmdId, Date.now())
  pruneCmds(party)
  return false
}

function dropParty(party: Party): void {
  parties.delete(party.id)
  // Audit A8: every queued URL registered a capability, not just the
  // current one — clearing only mediaUrl left stale read grants forever.
  for (const entry of party.queue) partyMedia.delete(entry.url)
  if (party.mediaUrl) partyMedia.delete(party.mediaUrl)
}

function gcTick(): void {
  while (parties.size > MAX_PARTIES) {
    // Evict the OLDEST-CREATED room, not the least-recently-seen one. The old
    // order meant a room created months ago that you open every evening was the
    // first casualty the moment a 26th room appeared — the room you actually
    // care about died to protect one nobody had touched since it was made.
    // `lastSeen` still breaks ties (all restored rooms share a boot timestamp).
    let victimId = ''
    let victimCreated = Infinity
    for (const [id, p] of parties) {
      const created = p.createdAt || 0
      if (created < victimCreated) { victimCreated = created; victimId = id }
    }
    if (!victimId) break
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
  return { ...rosterPayload(party), frame: party.frame, chat: party.chat, queue: party.queue, current: party.current, queueRev: party.queueRev, settingsRev: party.settingsRev, ready: readyPayload(party) }
}

function pushSystem(party: Party, text: string): any {
  return { type: 'watch.system', party: party.id, text }
}

/**
 * Promote a new host once the departed host's grace window has expired. Called
 * lazily (join + control attempts) rather than on a timer, so an idle room
 * costs nothing. No-op while the seat is still live.
 */
function reconcileHost(party: Party): void {
  if (party.hostLeftAt === undefined) return
  if (Date.now() - party.hostLeftAt < HOST_SEAT_GRACE_MS) return
  party.hostId = party.members.keys().next().value || ''
  party.hostLeftAt = undefined
}

/**
 * Does this user hold the room's transport controls?
 *
 * `removeMember` keeps `hostId` pointed at a departed host for
 * HOST_SEAT_GRACE_MS, so this equality also covers "host mid-reload": nobody
 * else can grab the controls while the tab is restarting, and the host regains
 * them the moment they rejoin inside the window.
 */
export function controlsParty(party: Party, userId: string): boolean {
  reconcileHost(party)
  return Boolean(party.hostId) && party.hostId === userId
}

/** Validate + apply one client control frame. Returns null to drop it. */
export function applyWatch(userId: string, msg: any): { room: string; payload: any } | null {
  if (!msg || typeof msg !== 'object') return null
  const party = parties.get(String(msg.party || ''))
  const member = party?.members.get(userId)
  if (!party || !member) return null
  // Transport is host-only. This used to gate on MEMBERSHIP alone, so any
  // viewer could play/pause/seek the room — and because the video canvas
  // broadcasts the local position on click, a viewer clicking their own player
  // dragged the whole room to their currentTime (often 0). Every other
  // privileged action here (kick/ban/mute/transfer/settings/disband) already
  // checks hostId; transport was the one that didn't.
  // A host mid-reload is still "inside the grace window" and keeps control, so
  // their pending frames are not refused while the socket is down.
  if (!controlsParty(party, userId)) return null
  if (msg.action !== 'play' && msg.action !== 'pause') return null
  const position = Number(msg.position)
  if (!Number.isFinite(position) || position < 0) return null
  // V1 lock: party speed is always 1x. A rate != 1 frame is a desync bug or
  // a modified client; drop it.
  if (msg.rate !== undefined && Number(msg.rate) !== 1) return null
  const cmdId = normalizeCmdId(msg.cmdId)
  if (cmdId && claimCmd(party, cmdId)) {
    // Idempotent retry: return the authoritative frame without moving it.
    return { room: partyRoom(party.id), payload: { type: 'watch.sync', party: party.id, frame: party.frame } }
  }
  // Audit A3: 200 ms/member transport throttle. Humans seek/play far less
  // often; a bot hammering this frame used to amplify x-members broadcasts.
  const now = Date.now()
  if (now - (party.lastControl.get(userId) || 0) < 200) return null
  party.lastControl.set(userId, now)
  party.lastSeen = now
  party.frameRev += 1
  party.frame = {
    url: party.mediaUrl,
    action: msg.action,
    position,
    rate: 1,
    updatedAt: serverNow(),
    rev: party.frameRev,
    by: member.name || userId.slice(0, 8),
  }
  return { room: partyRoom(party.id), payload: { type: 'watch.sync', party: party.id, frame: party.frame } }
}

/** Handle watch.join: add member, return the snapshot payload for the room. */
export function joinWatch(userId: string, displayName: string, msg: any): { room: string; payload: any; snapshot: any; broadcastPayload: any } | null {
  const party = parties.get(String(msg?.party || ''))
  if (!party || party.bans.has(userId)) return null
  // Private rooms require membership or a current invite token. The token is
  // compared only here and never logged, persisted, or broadcast.
  if (party.isPrivate && !party.members.has(userId)) {
    const invite = typeof msg?.invite === 'string' ? msg.invite : ''
    if (!party.inviteToken || invite !== party.inviteToken) return null
    party.members.set(userId, { name: String(displayName || '').slice(0, 40), muted: false })
  } else {
    // # ponytail: limitless watch party entry (removed artificial 8-peer ceiling)
    party.members.set(userId, { name: String(displayName || '').slice(0, 40), muted: party.members.get(userId)?.muted || false })
  }
  party.lastSeen = Date.now()
  party.emptySince = undefined
  // Back inside the grace window: the retained seat is live again, so stop
  // promoting it away later.
  if (party.hostId === userId) party.hostLeftAt = undefined
  else reconcileHost(party)
  const room = partyRoom(party.id)
  const who = String(displayName || '').slice(0, 40) || userId.slice(0, 8)
  const snap = snapshotPayload(party)
  const sys = pushSystem(party, `${who} joined`)
  const rost = rosterPayload(party)
  return {
    room,
    payload: [snap, sys],
    snapshot: snap,
    broadcastPayload: [sys, rost],
  }
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
  void forceClose
  const who = party.members.get(userId)?.name || userId.slice(0, 8)
  party.members.delete(userId)
  const room = partyRoom(party.id)
  if (party.members.size === 0) {
    // Rooms are persistent: do NOT delete when empty so peers can re-enter anytime.
    party.emptySince = Date.now()
    // The 30s snapshot is unconditional, so this flag does not schedule anything
    // (it only marks the state as worth persisting and keeps it from latching).
    // An earlier comment here claimed an immediate flush that never existed.
    markPartiesDirty()
    return { room, payload: [pushSystem(party, `${who} left`), rosterPayload(party)] }
  }
  party.emptySince = undefined
  if (party.hostId === userId) {
    // Don't hand the crown to a viewer the instant the host's socket drops.
    // A tab reload or a network blip trips the 8s disconnect grace, and the
    // old behaviour promoted somebody else for good — the real host came back
    // as an ordinary member, so their controls silently stopped working and
    // auto-advance (client-side, host-gated) never fired again. Hold the seat
    // open for HOST_SEAT_GRACE_MS; joinWatch/controlsParty reconcile it later.
    party.hostLeftAt = Date.now()
  }
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
  // Do NOT drop the room when a kick empties it. Leaving deliberately keeps the
  // room (removeMember), and "the room must persist" cannot depend on HOW the
  // last member left — a kick used to destroy the room, its queue and its chat
  // while an ordinary leave preserved all of it. Disband stays the explicit
  // "close the room" action.
  party.emptySince = Date.now()
  markPartiesDirty()
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

/** Host closes the room for everyone: drop it and tell each member socket
 * watch.gone (their client removes the room + shows the notice). */
export function disbandWatch(userId: string, msg: any): { room: string; partyId: string } | null {
  const party = parties.get(String(msg?.party || ''))
  if (!party || party.hostId !== userId) return null
  const room = partyRoom(party.id)
  const partyId = party.id
  dropParty(party)
  return { room, partyId }
}

/** Host mints one active private-room invite token. Replaces any previous token. */
export function mintInvite(userId: string, partyId: string): string | null {
  const party = parties.get(String(partyId || ''))
  if (!party || party.hostId !== userId) return null
  const token = randomUUID().replace(/-/g, '').slice(0, 32)
  party.inviteToken = token
  return token
}

/** Host revokes the active private-room invite token. */
export function revokeInvite(userId: string, partyId: string): boolean {
  const party = parties.get(String(partyId || ''))
  if (!party || party.hostId !== userId) return false
  party.inviteToken = undefined
  return true
}

/** Redeem a private-room invite over HTTP before reading the snapshot. */
export function redeemInvite(userId: string, partyId: string, invite: unknown): boolean {
  const party = parties.get(String(partyId || ''))
  if (!party || !party.isPrivate || party.bans.has(userId)) return false
  if (typeof invite !== 'string' || !party.inviteToken || invite !== party.inviteToken) return false
  if (!party.members.has(userId)) {
    party.members.set(userId, { name: '', muted: false })
    party.lastSeen = Date.now()
    party.emptySince = undefined
  }
  return true
}

export function settingsWatch(userId: string, msg: any): { room: string; payload: any } | null {
  const party = parties.get(String(msg?.party || ''))
  if (!party || party.hostId !== userId) return null
  const cmdId = normalizeCmdId(msg.cmdId)
  if (cmdId && claimCmd(party, cmdId)) {
    return { room: partyRoom(party.id), payload: currentSettingsPayload(party) }
  }
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
  party.settingsRev += 1
  payload.settingsRev = party.settingsRev
  return { room: partyRoom(party.id), payload }
}

function currentSettingsPayload(party: Party): any {
  return { type: 'watch.settings', party: party.id, name: party.name, isPrivate: party.isPrivate, lockVideo: party.lockVideo, settingsRev: party.settingsRev }
}

/** Queue ops (entries are already resolved media; resolution lives in the
 * route layer). 'add' never touches the playing frame; 'next' swaps it. */
export function queueOps(userId: string, msg: any): { room: string; payload: any } | null {
  const party = parties.get(String(msg?.party || ''))
  const member = party?.members.get(userId)
  if (!party || !member) return null
  if (party.lockVideo && party.hostId !== userId) return null
  const cmdId = normalizeCmdId(msg.cmdId)
  if (cmdId && claimCmd(party, cmdId)) {
    return { room: partyRoom(party.id), payload: currentQueuePayload(party) }
  }
  const op = String(msg.op || '')
  let mutated = true
  if (op === 'add') {
    const url = typeof msg.url === 'string' ? msg.url : ''
    if (!url) return null
    const entryId = (typeof msg.id === 'string' && msg.id.trim()) ? msg.id.trim().slice(0, 8) : randomUUID().slice(0, 8)
    const hash = typeof msg.hash === 'string' && /^[0-9a-f]{64}$/i.test(msg.hash.trim()) ? msg.hash.trim().toLowerCase() : undefined
    const size = Number(msg.size)
    const entry: QueueEntry = {
      id: entryId,
      name: (typeof msg.name === 'string' ? msg.name : '').slice(0, 60) || 'Untitled',
      url,
      relay: msg.relay && typeof msg.relay.upstream === 'string' ? msg.relay : undefined,
      hash,
      size: Number.isFinite(size) && size > 0 ? Math.floor(size) : undefined,
      local: msg.local === true ? true : undefined,
    }
    party.queue.push(entry)
    addPartyMedia(party, url)
    while (party.queue.length > MAX_QUEUE) {
      const dropIdx = party.queue.findIndex((q) => q.id !== party.current)
      party.queue.splice(dropIdx < 0 ? 0 : dropIdx, 1)
    }
  } else if (op === 'remove') {
    party.queue = party.queue.filter((q) => q.id !== String(msg.id || ''))
  } else if (op === 'move') {
    const from = party.queue.findIndex((q) => q.id === String(msg.id || ''))
    if (from < 0) return null
    const beforeRaw = String(msg.before || '')
    const entry = party.queue.splice(from, 1)[0]
    if (!beforeRaw) {
      party.queue.push(entry)
    } else {
      const to = party.queue.findIndex((q) => q.id === beforeRaw)
      if (to < 0) { party.queue.splice(from, 0, entry); return null }
      party.queue.splice(to, 0, entry)
    }
  } else if (op === 'play') {
    const entry = party.queue.find((q) => q.id === String(msg.id || ''))
    if (entry) applyQueueMedia(party, entry, member.name || userId.slice(0, 8), 'play')
    else mutated = false
  } else if (op === 'next') {
    if (party.queue.length === 0) mutated = false
    else stepQueue(party, userId, member.name, 1)
  } else if (op === 'prev') {
    if (party.queue.length === 0) mutated = false
    else stepQueue(party, userId, member.name, -1)
  } else {
    return null
  }
  party.lastSeen = Date.now()
  if (mutated) party.queueRev += 1
  return {
    room: partyRoom(party.id),
    payload: currentQueuePayload(party),
  }
}

function currentQueuePayload(party: Party): any {
  return {
    type: 'watch.queue',
    party: party.id,
    queue: party.queue,
    current: party.current,
    frame: party.frame,
    queueRev: party.queueRev,
    ready: readyPayload(party),
  }
}

/** Local-file readiness, as plain JSON: entryId -> member ids. */
function readyPayload(party: Party): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const [entryId, members] of party.ready) {
    if (members.size > 0) out[entryId] = [...members]
  }
  return out
}

/**
 * A member verified a queue entry's bytes locally (hash-checked on their own
 * machine). Idempotent: repeated signals change nothing. Returns the queue
 * payload so the room sees readiness converge.
 */
export function watchReady(userId: string, msg: any): { room: string; payload: any } | null {
  const party = parties.get(String(msg?.party || ''))
  if (!party || !party.members.has(userId)) return null
  const entry = party.queue.find((q) => q.id === String(msg?.id || ''))
  if (!entry) return null
  const hash = typeof msg?.hash === 'string' ? msg.hash.trim().toLowerCase() : ''
  // When the entry carries a hash, the signal must name it: readiness for a
  // different file must not count toward this entry.
  if (entry.hash && hash !== entry.hash) return null
  let set = party.ready.get(entry.id)
  if (!set) {
    set = new Set()
    party.ready.set(entry.id, set)
  }
  set.add(userId)
  return { room: partyRoom(party.id), payload: currentQueuePayload(party) }
}

function applyQueueMedia(party: Party, entry: QueueEntry, by: string, action: 'play' | 'pause' = 'pause'): void {
  party.current = entry.id
  party.mediaName = entry.name
  party.relay = entry.relay
  setPartyMedia(party, entry.url)
  party.frameRev += 1
  party.frame = { url: entry.url, action, position: 0, rate: 1, updatedAt: serverNow(), rev: party.frameRev, by }
}

/** Step the playing entry +/-1 (wraps: prev at the first entry lands on the
 * last). Continuous playlist: a PLAYING room moves into a playing frame
 * (video ended mid-run); a paused room moves paused. */
function stepQueue(party: Party, userId: string, name: string, dir: 1 | -1): void {
  if (party.queue.length === 0) return
  const idx = party.queue.findIndex((q) => q.id === party.current)
  const nextIdx = (idx + dir + party.queue.length) % party.queue.length
  const entry = idx < 0 ? party.queue[0] : party.queue[nextIdx]
  if (entry) applyQueueMedia(party, entry, name || userId.slice(0, 8),
    party.frame.action === 'play' ? 'play' : 'pause')
}

/** Persistence: rooms die with the process otherwise, so every deploy
 * 404s live rooms. Members/chat: the roster re-forms via watch.join (tabs
 * lost their sockets anyway); chat persists WITH the room so the backlog
 * lives for its whole lifespan. Bans stay session-scoped. */
export function serializeParties(): string {
  return JSON.stringify([...parties.values()].map((p) => ({
    id: p.id, name: p.name, mediaUrl: p.mediaUrl, mediaName: p.mediaName,
    relay: p.relay, hostId: p.hostId, isPrivate: p.isPrivate, lockVideo: p.lockVideo,
    frame: p.frame, queue: p.queue, current: p.current,
    frameRev: p.frameRev, queueRev: p.queueRev, settingsRev: p.settingsRev,
    // chat persists with the room (applyChat caps it at 80 entries)
    chat: p.chat,
    // Eviction order must survive a restart, or every restored room looks
    // brand new and the cap evicts arbitrary rooms.
    createdAt: p.createdAt,
  })))
}

/** Mark the snapshot as worth persisting. Consumed (and cleared) by the host
 *  process's 30s pass; the flush itself is unconditional, so this is a
 *  bookkeeping flag, not a scheduling one. */
let partiesDirty = false
export function markPartiesDirty(): void {
  partiesDirty = true
}
export function takePartiesDirty(): boolean {
  if (!partiesDirty) return false
  partiesDirty = false
  return true
}

/**
 * How long a room with nobody in it keeps its media blob leased.
 *
 * Rooms are immortal by design, and the media lease used to follow that
 * literally: `liveMediaObjectIds` walked every room regardless of membership,
 * so a room abandoned for weeks pinned its Objects rows forever and the blobs
 * were never reclaimed. The room itself stays (that is the product promise);
 * only the lease lapses, so a room that comes back after a day finds its video
 * purged instead of holding storage hostage forever.
 */
export const EMPTY_MEDIA_LEASE_MS = 6 * 60 * 60_000

/** Object ids of every media a LIVE room serves right now (current frame +
 *  queue). serve.ts re-extends their expires_at each flush: a room pinned
 *  alive by member pings must never serve a purged object ("No preview"). */
export function liveMediaObjectIds(): string[] {
  const out = new Set<string>()
  const now = Date.now()
  for (const p of parties.values()) {
    // Lapsed lease: room still exists, but it no longer owns the bytes.
    if (p.members.size === 0 && p.emptySince && now - p.emptySince > EMPTY_MEDIA_LEASE_MS) continue
    for (const u of [p.mediaUrl, ...p.queue.map((q) => q.url)]) {
      const m = /^\/api\/objects\/([0-9a-fA-F-]{36})$/.exec(u)
      if (m) out.add(m[1])
    }
  }
  return [...out]
}

/** Register an extra media grant (queue restore) without touching current. */
export function addPartyMedia(party: Party, mediaUrl: string): void {
  if (mediaUrl) partyMedia.set(mediaUrl, party.id)
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
    const p = createParty(String(s.name || 'Party'), s.mediaUrl, s.mediaUrl, s.relay, String(s.hostId || ''), s.id, Number(s.createdAt) || 0)
    if (p.hostId) p.members.delete(p.hostId) // roster re-forms via watch.join
    p.mediaName = String(s.mediaName || '')
    p.isPrivate = Boolean(s.isPrivate)
    p.lockVideo = Boolean(s.lockVideo)
    // Sanitize, don't adopt wholesale. A stored frame with a missing/garbage
    // position or updatedAt used to be handed straight to every client, where
    // computeTargetPosition turned it into NaN and — because every comparison
    // against NaN is false — the whole reconciler for that slot stopped
    // seeking, pausing and advancing, with the scrubber frozen at 0:00.
    p.frame = sanitizeFrame(s.frame, s.mediaUrl)
    p.frameRev = sanitizeRev((s as any).frameRev ?? p.frame.rev)
    p.frame.rev = p.frameRev
    p.queueRev = sanitizeRev((s as any).queueRev)
    p.settingsRev = sanitizeRev((s as any).settingsRev)
    // Sanitize, don't adopt wholesale: queue entries ride the same persisted
    // file as the frame, and a corrupt entry used to 404 every client.
    if (Array.isArray(s.queue)) p.queue = s.queue.map(sanitizeQueueEntry).filter((q: QueueEntry | null): q is QueueEntry => Boolean(q))
    if (typeof s.current === 'string') p.current = s.current
    if (Array.isArray(s.chat)) p.chat = s.chat.filter((m: any) => m && typeof m.text === 'string').slice(-80)
    // dropParty clears queue-entry capabilities; restore must re-mint ALL
    // of them, not just the current media, or queued private objects 404.
    for (const entry of p.queue) addPartyMedia(p, entry.url)
    n++
  }
  return n
}

export function watchPong(t0: unknown): { type: string; t0: number; t1: number } {
  return { type: 'watch.pong', t0: Number(t0) || 0, t1: serverNow() }
}

/** Keep-alive: an awake member's ping refreshes every room they belong to. */
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
