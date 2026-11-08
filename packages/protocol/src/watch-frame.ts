// The watch-party wire contract.
//
// Two directions, one file:
//   INBOUND  — the frame a client sends (WatchFrame + parseWatchFrame).
//   OUTBOUND — the payloads the room broadcasts (WatchPayload).
//
// Both are TYPED. The inbound frame is narrowed from untrusted JSON (a
// wrong-typed field is dropped, never coerced); the outbound payload is a
// closed union, so a handler cannot invent a shape the client does not know.
//
// The room STATE (Party, PartyMember, QueueEntry, ChatEntry) lives in
// watchparty.ts; the SHAPES that travel on the wire live here.

/** Narrow an untrusted value to a plain record (no arrays, no null). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function strField(src: Record<string, unknown>, key: string): string | undefined {
  const v = src[key]
  return typeof v === 'string' ? v : undefined
}

/**
 * The watch-party client frame.
 *
 * Every watch control frame is the same envelope: a party id, an optional
 * idempotency key and a handful of typed fields. The frames arrive as
 * untrusted JSON over the WebSocket, so they are NARROWED by
 * `parseWatchFrame` — never cast. A field of the wrong type is DROPPED, not
 * coerced, and unknown keys never reach a handler.
 */
export interface WatchFrame {
  type?: string
  party?: string
  /** Idempotency key: a repeated command returns the current state instead
   *  of applying twice. */
  cmdId?: string
  /** Display name (join) or the queue entry's title (add). */
  name?: string
  /** Private-room invite token (join only). */
  invite?: string
  /** Transport action: 'play' | 'pause'. */
  action?: string
  position?: number
  rate?: number
  /** Chat message body. */
  text?: string
  /** Chat message id (delete). */
  msgId?: string
  /** The member a host action applies to (kick/ban/mute/transfer host). */
  target?: string
  /** Mute on/off. */
  on?: boolean
  isPrivate?: boolean
  lockVideo?: boolean
  sharedControl?: boolean
  requireApproval?: boolean
  /** Queue operation: add | remove | move | play | next | prev | approve | flag | unflag. */
  op?: string
  /** Media URL (queue add). */
  url?: string
  /** Queue entry id, or the new entry's id. */
  id?: string
  /** SHA-256 of the shared bytes (queue add / readiness). */
  hash?: string
  /** Byte size of the shared media. */
  size?: number
  /** The id an entry is moved BEFORE (queue move). */
  before?: string
  /** Provider label for the queue entry. */
  provider?: string
  /** Poster still for the queue entry. */
  thumb?: string
  /** True for consent-shared local files. */
  local?: boolean
  /** Upstream relay descriptor for a stored media object. The referer is
   *  required: the upstream fetch sends it, so a descriptor without one is
   *  dropped rather than half-applied. */
  relay?: { upstream: string; referer: string }
}

/**
 * Narrow an untrusted JSON value into a WatchFrame.
 *
 * Returns null when the value is not a plain object. Every field is copied
 * only when it already has the right type — the frame never coerces a
 * string into a number or a number into a string, so a handler can trust
 * the types it reads.
 */
export function parseWatchFrame(raw: unknown): WatchFrame | null {
  if (!isRecord(raw)) return null
  const src = raw
  const frame: WatchFrame = {}

  const type = strField(src, 'type'); if (type !== undefined) frame.type = type
  const party = strField(src, 'party'); if (party !== undefined) frame.party = party
  const cmdId = strField(src, 'cmdId'); if (cmdId !== undefined) frame.cmdId = cmdId
  const name = strField(src, 'name'); if (name !== undefined) frame.name = name
  const invite = strField(src, 'invite'); if (invite !== undefined) frame.invite = invite
  const action = strField(src, 'action'); if (action !== undefined) frame.action = action
  const text = strField(src, 'text'); if (text !== undefined) frame.text = text
  const msgId = strField(src, 'msgId'); if (msgId !== undefined) frame.msgId = msgId
  const target = strField(src, 'target'); if (target !== undefined) frame.target = target
  const op = strField(src, 'op'); if (op !== undefined) frame.op = op
  const url = strField(src, 'url'); if (url !== undefined) frame.url = url
  const id = strField(src, 'id'); if (id !== undefined) frame.id = id
  const hash = strField(src, 'hash'); if (hash !== undefined) frame.hash = hash
  const before = strField(src, 'before'); if (before !== undefined) frame.before = before
  const provider = strField(src, 'provider'); if (provider !== undefined) frame.provider = provider
  const thumb = strField(src, 'thumb'); if (thumb !== undefined) frame.thumb = thumb

  const position = src.position
  if (typeof position === 'number' && Number.isFinite(position)) frame.position = position
  const rate = src.rate
  if (typeof rate === 'number' && Number.isFinite(rate)) frame.rate = rate
  const size = src.size
  if (typeof size === 'number' && Number.isFinite(size)) frame.size = size

  const on = src.on
  if (typeof on === 'boolean') frame.on = on
  const isPrivate = src.isPrivate
  if (typeof isPrivate === 'boolean') frame.isPrivate = isPrivate
  const lockVideo = src.lockVideo
  if (typeof lockVideo === 'boolean') frame.lockVideo = lockVideo
  const sharedControl = src.sharedControl
  if (typeof sharedControl === 'boolean') frame.sharedControl = sharedControl
  const requireApproval = src.requireApproval
  if (typeof requireApproval === 'boolean') frame.requireApproval = requireApproval
  const local = src.local
  if (typeof local === 'boolean') frame.local = local

  const relay = src.relay
  if (isRecord(relay)) {
    const upstream = strField(relay, 'upstream')
    const referer = strField(relay, 'referer')
    if (upstream !== undefined && referer !== undefined) frame.relay = { upstream, referer }
  }

  return frame
}

// ─── The shapes that travel OUT ───

/** The transport state of the room. */
export interface PartyFrame {
  url: string
  action: 'play' | 'pause'
  position: number
  rate: number
  updatedAt: number
  /**
   * Monotonic server revision. Clients apply only newer frames/snapshots.
   *
   * Absent on an UNVERSIONED frame — one from a peer that predates the
   * revision counter. The client applies those (there is nothing to compare)
   * instead of treating them as revision 0, which would read as stale.
   */
  rev?: number
  /** Display name of the member who last moved the transport. */
  by?: string
}

/** A member of the room, as the roster shows them. */
export interface PartyMember {
  name: string
  muted: boolean
}

/** A playlist entry. */
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
  /** Poster still for a shared local video: a register-only object URL the
   *  room resolves peer-to-peer (same swarm path as the media itself). */
  thumb?: string
  /** Provider label from source resolution (x, redgifs, pmvhaven, booru, page…). */
  provider?: string
  /**
   * Queue state. Absent/queued = playable now; proposed = a participant's
   * suggestion awaiting host approval; unavailable = flagged (broken source)
   * and skipped by next/prev. Never auto-plays while proposed.
   */
  status?: 'queued' | 'proposed' | 'unavailable'
}

/** A chat line. */
export interface ChatEntry {
  id: string
  from: string
  name: string
  text: string
  at: number
}

/** One member in a roster payload. */
export interface RosterMember {
  id: string
  name: string
  muted: boolean
}

/** The room membership. */
export interface WatchRoster {
  type: 'watch.roster'
  party: string
  host: string
  members: RosterMember[]
}

/** The full room snapshot a joiner receives. */
export interface WatchSnapshot extends WatchRoster {
  frame: PartyFrame
  chat: ChatEntry[]
  queue: QueueEntry[]
  current: string
  queueRev: number
  settingsRev: number
  ready: Record<string, string[]>
  sharedControl: boolean
  requireApproval: boolean
  lockVideo: boolean
  isPrivate: boolean
}

/** A transport update. */
export interface WatchSync {
  type: 'watch.sync'
  party: string
  frame: PartyFrame
}

/** A server notice in the room log. */
export interface WatchSystem {
  type: 'watch.system'
  party: string
  text: string
}

/** A chat line, as broadcast. */
export interface WatchChat {
  type: 'watch.chat'
  party: string
  msgId: string
  from: { id: string; name: string }
  text: string
  at: number
}

/** A chat line was removed. */
export interface WatchChatDel {
  type: 'watch.chat_del'
  party: string
  msgId: string
}

/**
 * Room settings.
 *
 * A patch carries only the fields it changes; a full snapshot carries them
 * all. `muted` rides the same frame (the host's mute map).
 */
export interface WatchSettings {
  type: 'watch.settings'
  party: string
  name?: string
  isPrivate?: boolean
  lockVideo?: boolean
  sharedControl?: boolean
  requireApproval?: boolean
  settingsRev?: number
  muted?: Record<string, boolean>
}

/** The playlist. */
export interface WatchQueue {
  type: 'watch.queue'
  party: string
  queue: QueueEntry[]
  current: string
  frame: PartyFrame
  queueRev: number
  ready: Record<string, string[]>
}

/** Every payload the room can broadcast. */
export type WatchPayload =
  | WatchRoster
  | WatchSnapshot
  | WatchSync
  | WatchSystem
  | WatchChat
  | WatchChatDel
  | WatchSettings
  | WatchQueue

// ─── The client side of the same contract ───

/** A refused control frame: the server did not apply the client's command. */
export interface WatchNack {
  type: 'watch.nack'
  party: string
  action?: string
}

/** The client was removed from the room. */
export interface WatchKicked {
  type: 'watch.kicked'
  party: string
}

/** The room was closed for good. */
export interface WatchGone {
  type: 'watch.gone'
  party: string
}

/** The clock-offset probe's answer. */
export interface WatchPong {
  type: 'watch.pong'
  t0: number
  t1: number
}

/** Every frame the server sends on the watch socket. */
export type WatchServerFrame =
  | WatchPayload
  | WatchNack
  | WatchKicked
  | WatchGone
  | WatchPong

/**
 * Narrow one inbound server frame.
 *
 * The client used to take `msg: any` and coerce every field with
 * String(...)/Number(...), so a malformed frame silently became a room with
 * an empty name and a queue of blank entries. The frame is narrowed here
 * instead: a wrong-typed field is DROPPED, and the handler reads a shape it
 * can trust.
 *
 * Returns null for anything that is not a watch frame.
 */
export function parseWatchServerFrame(raw: unknown): WatchServerFrame | null {
  if (!isRecord(raw)) return null
  const type = raw.type
  if (type === 'watch.nack') {
    const nack: WatchNack = { type, party: str(raw.party) ?? '' }
    const action = str(raw.action); if (action !== undefined) nack.action = action
    return nack
  }
  if (type === 'watch.kicked') return { type, party: str(raw.party) ?? '' }
  if (type === 'watch.gone') return { type, party: str(raw.party) ?? '' }
  if (type === 'watch.pong') {
    return { type, t0: num(raw.t0) ?? 0, t1: num(raw.t1) ?? 0 }
  }
  return parseWatchPayload(raw)
}

/**
 * Narrow one inbound room payload.
 *
 * Returns null for anything that is not a room payload (the socket also
 * carries `watch.pong`, `watch.nack`, `watch.kicked` and `watch.gone`).
 */
export function parseWatchPayload(raw: unknown): WatchPayload | null {
  if (!isRecord(raw)) return null
  const type = raw.type
  if (typeof type !== 'string') return null

  if (type === 'watch.sync') {
    const frame = parsePartyFrame(raw.frame)
    if (!frame) return null
    return { type, party: str(raw.party) ?? '', frame }
  }

  if (type === 'watch.roster') {
    const members: RosterMember[] = Array.isArray(raw.members)
      ? raw.members.flatMap((m) => {
        if (!isRecord(m)) return []
        const id = str(m.id)
        if (!id) return []
        return [{ id, name: str(m.name) ?? '', muted: m.muted === true }]
      })
      : []
    const roster: WatchRoster = { type, party: str(raw.party) ?? '', host: str(raw.host) ?? '', members }
    // A join snapshot rides the roster frame: the extra fields are present
    // only on that variant, so it is widened here rather than guessed at in
    // the client.
    const frame = parsePartyFrame(raw.frame)
    const chat = Array.isArray(raw.chat)
      ? raw.chat.flatMap((c) => { const e = parseChatEntry(c); return e ? [e] : [] })
      : undefined
    const queue = Array.isArray(raw.queue)
      ? raw.queue.flatMap((q) => { const e = parseQueueEntry(q); return e ? [e] : [] })
      : undefined
    if (!frame && !chat && !queue) return roster
    const snapshot: WatchSnapshot = {
      ...roster,
      frame: frame ?? { url: '', action: 'pause', position: 0, rate: 1, updatedAt: 0, rev: 0 },
      chat: chat ?? [],
      queue: queue ?? [],
      current: str(raw.current) ?? '',
      queueRev: int(raw.queueRev) ?? 0,
      settingsRev: int(raw.settingsRev) ?? 0,
      ready: parseReady(raw.ready),
      sharedControl: raw.sharedControl === true,
      requireApproval: raw.requireApproval === true,
      lockVideo: raw.lockVideo === true,
      isPrivate: raw.isPrivate === true,
    }
    return snapshot
  }

  if (type === 'watch.system') {
    return { type, party: str(raw.party) ?? '', text: str(raw.text) ?? '' }
  }

  if (type === 'watch.chat') {
    const from = isRecord(raw.from) ? { id: str(raw.from.id) ?? '', name: str(raw.from.name) ?? '' } : { id: '', name: '' }
    return { type, party: str(raw.party) ?? '', msgId: str(raw.msgId) ?? '', from, text: str(raw.text) ?? '', at: num(raw.at) ?? 0 }
  }

  if (type === 'watch.chat_del') {
    return { type, party: str(raw.party) ?? '', msgId: str(raw.msgId) ?? '' }
  }

  if (type === 'watch.settings') {
    const payload: WatchSettings = { type, party: str(raw.party) ?? '' }
    const name = str(raw.name); if (name !== undefined) payload.name = name
    if (typeof raw.isPrivate === 'boolean') payload.isPrivate = raw.isPrivate
    if (typeof raw.lockVideo === 'boolean') payload.lockVideo = raw.lockVideo
    if (typeof raw.sharedControl === 'boolean') payload.sharedControl = raw.sharedControl
    if (typeof raw.requireApproval === 'boolean') payload.requireApproval = raw.requireApproval
    const settingsRev = int(raw.settingsRev); if (settingsRev !== undefined) payload.settingsRev = settingsRev
    if (isRecord(raw.muted)) {
      const muted: Record<string, boolean> = {}
      for (const [k, v] of Object.entries(raw.muted)) if (typeof v === 'boolean') muted[k] = v
      payload.muted = muted
    }
    return payload
  }

  if (type === 'watch.queue') {
    const frame = parsePartyFrame(raw.frame)
    return {
      type,
      party: str(raw.party) ?? '',
      queue: Array.isArray(raw.queue)
        ? raw.queue.flatMap((q) => { const e = parseQueueEntry(q); return e ? [e] : [] })
        : [],
      current: str(raw.current) ?? '',
      frame: frame ?? { url: '', action: 'pause', position: 0, rate: 1, updatedAt: 0, rev: 0 },
      queueRev: int(raw.queueRev) ?? 0,
      ready: parseReady(raw.ready),
    }
  }

  return null
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function int(v: unknown): number | undefined {
  const n = num(v)
  return n !== undefined && n >= 0 ? Math.floor(n) : undefined
}

function parseReady(v: unknown): Record<string, string[]> {
  if (!isRecord(v)) return {}
  const out: Record<string, string[]> = {}
  for (const [entryId, members] of Object.entries(v)) {
    if (!Array.isArray(members)) continue
    out[entryId] = members.filter((m): m is string => typeof m === 'string')
  }
  return out
}

function parsePartyFrame(v: unknown): PartyFrame | null {
  if (!isRecord(v)) return null
  const url = str(v.url)
  if (!url) return null
  const frame: PartyFrame = {
    url,
    action: v.action === 'play' ? 'play' : 'pause',
    position: num(v.position) ?? 0,
    rate: num(v.rate) ?? 1,
    updatedAt: num(v.updatedAt) ?? 0,
  }
  // An absent rev means UNVERSIONED (a peer that predates the counter), not
  // revision 0: the client applies unversioned frames, and revision 0 would
  // read as stale.
  const rev = int(v.rev)
  if (rev !== undefined) frame.rev = rev
  const by = str(v.by)
  if (by !== undefined) frame.by = by
  return frame
}

function parseChatEntry(v: unknown): ChatEntry | null {
  if (!isRecord(v)) return null
  const text = str(v.text)
  if (text === undefined) return null
  return {
    id: str(v.id) ?? '',
    from: str(v.from) ?? '',
    name: str(v.name) ?? '',
    text,
    at: num(v.at) ?? 0,
  }
}

function parseQueueEntry(v: unknown): QueueEntry | null {
  if (!isRecord(v)) return null
  const id = str(v.id)
  const url = str(v.url)
  if (!id || !url) return null
  const entry: QueueEntry = { id, name: str(v.name) ?? '', url }
  const hash = str(v.hash); if (hash !== undefined) entry.hash = hash
  const size = num(v.size); if (size !== undefined) entry.size = size
  if (v.local === true) entry.local = true
  const thumb = str(v.thumb); if (thumb !== undefined) entry.thumb = thumb
  const provider = str(v.provider); if (provider !== undefined) entry.provider = provider
  if (v.status === 'proposed' || v.status === 'unavailable') entry.status = v.status
  if (isRecord(v.relay)) {
    const upstream = str(v.relay.upstream)
    const referer = str(v.relay.referer)
    if (upstream !== undefined && referer !== undefined) entry.relay = { upstream, referer }
  }
  return entry
}
