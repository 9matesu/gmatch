import type { OpenedEnvelope, Envelope } from '@orbit/protocol'
import { deliveryToken } from '@orbit/protocol'
import type { OrbitIdentity } from '@orbit/crypto'
import { logger } from './logger'
import { isEpoch, peerAddressToken } from './handleRotation'
import { TYPING_TTL_MS, shouldEmitTyping } from './dmTyping'
import { getSecureItem, setSecureItem } from './secure-storage'
import { peerNodeFor } from './peerNodes'

/**
 * Courier-backed DM layer (plan P3.2). Source of truth is LOCAL
 * (localStorage thread store); the courier only carries sealed envelopes —
 * there is no server inbox anymore. Delivery status per message:
 *   'sent'      -> envelope accepted by the courier (queued for the peer)
 *   'delivered' -> opened and acked by the recipient (`dm_ack`)
 *   'failed'    -> courier rejected the PUT (dead server / bad token)
 *
 * Read state is NOT the delivery ack. The recipient sends a separate
 * `dm_read` watermark only after it has actually shown the message in an open,
 * visible conversation, so the sender can distinguish "delivered" from "seen".
 *
 * Message events (all sealed 1:1 bodies, same envelope kind):
 *   dm        new message (optionally `r` = reply-to id, `a` = attachment id)
 *   dm_ack    received -> delivered receipt
 *   dm_read   read watermark (`upTo` = highest message ts the peer viewed)
 *   dm_edit   author corrected their text (`ts` = edit stamp, LWW merge key)
 *   dm_del    author deleted for everyone (tombstone; never resurrectable)
 *   dm_react  add/remove one emoji by one actor (set semantics)
 *   dm_typing transient, never persisted, expires with `TYPING_TTL_MS`
 *
 * Peer pubkey resolution: an incoming envelope's senderOrbitId is trusted
 * ONLY together with the pubkey that sealed it (open1to1 already verified the
 * Ed25519 signature over kind|id|to|body). We cache orbitId -> {pub, encPub}
 * on first contact (TOFU).
 */

export interface DmMessage {
  id: string
  peerId: string
  own: boolean
  text: string
  ts: number
  status: 'sending' | 'sent' | 'delivered' | 'failed'
  envelopeId?: string
  /** Private object id shared sealed-side; recipient pulls via Recipients. */
  attachmentId?: string
  /**
   * Sender's display name at send time, carried inside the sealed body.
   *
   * A DM thread can outlive any roster entry for the peer (they may be outside
   * the capped directory, or the thread may be read on a device that has never
   * seen them), which is why the reader used to render "Unknown User". Optional
   * so threads written by an older client still decode.
   */
  senderName?: string
  /** Id of the message this one replies to. */
  replyToId?: string
  /** Last author edit, ms. Also the deterministic merge key for `dm_edit`. */
  editedTs?: number
  /**
   * Deletion stamp. The row is KEPT (as an empty stub) rather than removed:
   * that is what stops a replay of the original envelope — the courier holds
   * unacked mail for days — from resurrecting deleted content.
   */
  deletedTs?: number
  /** emoji -> actor orbit ids. A set per emoji, so retries cannot double-count. */
  reactions?: Record<string, string[]>
  /** Own messages only: highest ts the peer has confirmed reading. */
  readTs?: number
}

const THREADS_KEY = 'orbit_mail_threads_v1'
const KEYS_KEY = 'orbit_mail_peerkeys_v1'
/** Hard stop on what one sealed body may carry; the composer applies it too. */
export const MAX_DM_TEXT = 4000
const MAX_REACTION_LEN = 16
/**
 * Per-thread backstop, NOT a retention policy. DM history is permanent; this
 * exists only because threads live in localStorage, which browsers cap at
 * roughly 5 MB for the whole origin. At 500 it was truncating real history in
 * an active conversation long before that ceiling was anywhere near, and the
 * oldest messages were the ones dropped — the same mistake as the group route's
 * `ORDER BY ... ASC LIMIT`.
 *
 * Raised to 2000, which is about 400 KB of JSON for a text-only thread. The
 * honest fix for an unbounded archive is IndexedDB, not a bigger number; this
 * is the interim bound, sized to stay well clear of the origin-wide ceiling
 * even with several large threads in one install.
 */
const MAX_PER_THREAD = 2000

export interface PeerKeys {
  publicKeyHex: string
  encryptionPubHex: string
  displayName?: string
  /** Peer's current session epoch, learned from sealed bodies (C2). */
  epoch?: string
}

/** Scope a base key to one identity: two accounts on one device must not
 * share threads/peer-key caches (or the courier rooms). */
export function scopedKey(base: string, orbitId: string): string {
  return `${base}:${orbitId.slice(0, 16)}`
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = getSecureItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    setSecureItem(key, JSON.stringify(value))
  } catch {
    /* quota: threads are capped; ignore */
  }
}

export class DmStore {
  private readonly threadsKey: string
  private readonly keysKey: string

  constructor(private readonly identity: OrbitIdentity) {
    this.threadsKey = scopedKey(THREADS_KEY, identity.orbitId)
    this.keysKey = scopedKey(KEYS_KEY, identity.orbitId)
  }

  /** Peer pubkey registry (contacts + every opened envelope feeds it). */
  rememberPeer(orbitId: string, keys: PeerKeys): void {
    const map = readJson<Record<string, PeerKeys>>(this.keysKey, {})
    map[orbitId] = keys
    writeJson(this.keysKey, map)
  }

  peerKeys(orbitId: string): PeerKeys | undefined {
    return readJson<Record<string, PeerKeys>>(this.keysKey, {})[orbitId]
  }

  threads(): Record<string, DmMessage[]> {
    return readJson(this.threadsKey, {})
  }

  thread(peerId: string): DmMessage[] {
    return this.threads()[peerId] || []
  }

  private save(thread: DmMessage[], peerId: string): void {
    const all = this.threads()
    // Stable ordering by ts: a late envelope (or a replayed edit) must not
    // leave the conversation out of order. Equal stamps keep arrival order.
    const ordered = [...thread].sort((a, b) => (a.ts || 0) - (b.ts || 0))
    all[peerId] = ordered.slice(-MAX_PER_THREAD)
    writeJson(this.threadsKey, all)
  }

  appendLocal(msg: DmMessage): void {
    const t = this.thread(msg.peerId)
    t.push(msg)
    this.save(t, msg.peerId)
  }

  setStatus(peerId: string, id: string, status: DmMessage['status']): void {
    const t = this.thread(peerId)
    const m = t.find((x) => x.id === id)
    if (m) {
      m.status = status
      this.save(t, peerId)
    }
  }

  /** Mutate one stored message and persist. Null when the id is unknown. */
  update(peerId: string, id: string, fn: (m: DmMessage) => void): DmMessage | null {
    const t = this.thread(peerId)
    const m = t.find((x) => x.id === id)
    if (!m) return null
    fn(m)
    this.save(t, peerId)
    return m
  }

  /**
   * Keep a placeholder for a deleted message (local or remote). Existing
   * content is dropped, the row survives, so `hasMessage` stays true and a
   * replayed original cannot bring the message back.
   */
  tombstone(peerId: string, id: string, ts: number, own = false): void {
    const t = this.thread(peerId)
    const existing = t.find((x) => x.id === id)
    if (existing) {
      if (existing.deletedTs) return
      existing.text = ''
      delete existing.attachmentId
      delete existing.reactions
      existing.deletedTs = Date.now()
    } else {
      t.push({
        id,
        peerId,
        own,
        text: '',
        ts: Number.isFinite(ts) && ts > 0 ? ts : Date.now(),
        status: 'delivered',
        deletedTs: Date.now(),
      })
    }
    this.save(t, peerId)
  }

  /** Record the peer's read watermark on our own messages. One write. */
  markReadUpTo(peerId: string, upTo: number): boolean {
    if (!Number.isFinite(upTo) || upTo <= 0) return false
    const t = this.thread(peerId)
    let changed = false
    for (const m of t) {
      if (!m.own || m.deletedTs) continue
      if (m.ts <= upTo && (m.readTs ?? 0) < upTo) {
        m.readTs = upTo
        changed = true
      }
    }
    if (changed) this.save(t, peerId)
    return changed
  }

  hasMessage(peerId: string, id: string): boolean {
    return this.thread(peerId).some((m) => m.id === id)
  }
}

/** Clamp outbound text to what one sealed body should carry. */
export function clampDmText(text: string): string {
  return typeof text === 'string' ? text.slice(0, MAX_DM_TEXT) : ''
}

function normaliseEmoji(emoji: unknown): string | null {
  if (typeof emoji !== 'string') return null
  const trimmed = emoji.trim()
  if (!trimmed || trimmed.length > MAX_REACTION_LEN) return null
  if (/[\n\r]/.test(trimmed)) return null
  return trimmed
}

/** Sealed body kinds. `dm`/`dm_ack` predate the rest; every field stays
 * optional so an older client can keep decoding what it understands. */
export type DmBody =
  | { t: 'dm'; id: string; text?: string; ts?: number; e?: string; a?: string; n?: string; r?: string }
  | { t: 'dm_ack'; id: string; e?: string }
  | { t: 'dm_read'; id: string; upTo: number; e?: string }
  | { t: 'dm_edit'; id: string; text: string; ts: number; e?: string }
  | { t: 'dm_del'; id: string; ts: number; e?: string }
  | { t: 'dm_react'; id: string; emoji: string; op: 'add' | 'remove'; ts: number; e?: string }
  | { t: 'dm_typing'; at: number; e?: string }

function epochField(epoch?: string): { e?: string } {
  return isEpoch(epoch) ? { e: epoch } : {}
}

/** Body format for DM envelopes + receipts (all sealed end-to-end).
 * `e` piggybacks the sender's current session epoch (wave 2 C2) so replies
 * address the rotating token instead of the static home token. `a` carries a
 * private attachment object id (uploaded with the peer as recipient).
 * `n` carries the sender's display name so the recipient never has to resolve
 * it from a roster that may not contain them. `r` references the replied-to
 * message id and survives persistence + reconnection. */
export function encodeDmBody(msg: DmMessage, epoch?: string): string {
  const name = msg.senderName?.trim()
  return JSON.stringify({
    t: 'dm',
    id: msg.id,
    text: clampDmText(msg.text ?? ''),
    ts: msg.ts,
    ...epochField(epoch),
    ...(msg.attachmentId ? { a: msg.attachmentId } : {}),
    // Only a real name travels; an empty one is omitted so the reader resolves
    // it from its roster rather than overriding a name the roster already has.
    ...(name ? { n: name } : {}),
    ...(msg.replyToId ? { r: msg.replyToId } : {}),
  })
}
export function encodeAckBody(refId: string, epoch?: string): string {
  return JSON.stringify({ t: 'dm_ack', id: refId, ...epochField(epoch) })
}
export function encodeReadBody(refId: string, upTo: number, epoch?: string): string {
  return JSON.stringify({ t: 'dm_read', id: refId, upTo, ...epochField(epoch) })
}
export function encodeEditBody(id: string, text: string, ts: number, epoch?: string): string {
  return JSON.stringify({ t: 'dm_edit', id, text: clampDmText(text), ts, ...epochField(epoch) })
}
export function encodeDeleteBody(id: string, ts: number, epoch?: string): string {
  return JSON.stringify({ t: 'dm_del', id, ts, ...epochField(epoch) })
}
export function encodeReactBody(
  id: string,
  emoji: string,
  op: 'add' | 'remove',
  ts: number,
  epoch?: string,
): string {
  return JSON.stringify({ t: 'dm_react', id, emoji, op, ts, ...epochField(epoch) })
}
export function encodeTypingBody(at: number, epoch?: string): string {
  return JSON.stringify({ t: 'dm_typing', at, ...epochField(epoch) })
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * Parse one sealed body. Unknown or malformed payloads return null so the
 * caller can route the envelope elsewhere (rooms, domination, signal) — a
 * future DM kind from a newer client is ignored, never mis-parsed.
 */
export function decodeBody(json: string): DmBody | null {
  let parsed: Record<string, unknown>
  try {
    const raw = JSON.parse(json)
    if (!raw || typeof raw !== 'object') return null
    parsed = raw as Record<string, unknown>
  } catch {
    return null
  }
  const t = parsed.t
  const e = typeof parsed.e === 'string' && isEpoch(parsed.e) ? parsed.e : undefined
  const base = e ? { e } : {}

  if (t === 'dm_typing') {
    const at = finite(parsed.at)
    if (at === null) return null
    return { t, at, ...base }
  }

  if (typeof parsed.id !== 'string' || !parsed.id) return null
  const id = parsed.id

  if (t === 'dm_ack') return { t, id, ...base }

  if (t === 'dm') {
    const body: Extract<DmBody, { t: 'dm' }> = { t, id, ...base }
    if (typeof parsed.text === 'string') body.text = parsed.text
    const ts = finite(parsed.ts)
    if (ts !== null) body.ts = ts
    if (typeof parsed.a === 'string' && parsed.a) body.a = parsed.a
    if (typeof parsed.n === 'string' && parsed.n) body.n = parsed.n
    if (typeof parsed.r === 'string' && parsed.r) body.r = parsed.r
    return body
  }

  if (t === 'dm_read') {
    const upTo = finite(parsed.upTo)
    if (upTo === null || upTo <= 0) return null
    return { t, id, upTo, ...base }
  }

  if (t === 'dm_edit') {
    const ts = finite(parsed.ts)
    if (ts === null || typeof parsed.text !== 'string') return null
    return { t, id, text: clampDmText(parsed.text), ts, ...base }
  }

  if (t === 'dm_del') {
    const ts = finite(parsed.ts)
    if (ts === null) return null
    return { t, id, ts, ...base }
  }

  if (t === 'dm_react') {
    const ts = finite(parsed.ts)
    const emoji = normaliseEmoji(parsed.emoji)
    const op = parsed.op === 'add' || parsed.op === 'remove' ? parsed.op : null
    if (ts === null || !emoji || !op) return null
    return { t, id, emoji, op, ts, ...base }
  }

  return null
}

export interface DmManagerDeps {
  mail: MailClientLike
  store: DmStore
  identity: OrbitIdentity
  onThreadChanged: (peerId: string) => void
  /** Fired once per NEW inbound dm after it was stored (UI notification). */
  onIncoming?: (msg: DmMessage) => void
  /** A peer is typing (transient; never stored). */
  onTyping?: (peerId: string, at: number) => void
}

/** The subset of MailClient the manager needs (keeps tests free of sockets). */
export interface MailClientLike {
  send(
    body: string,
    kind: 'mail',
    recipient: { publicKeyHex: string; encryptionPubHex: string },
    opts?: { id?: string; exp?: number; to?: string; base?: string },
  ): Promise<Envelope>
  readonly epoch?: { cur: string; prev: string }
}

export class DmManager {
  private readonly lastTypingAt = new Map<string, number>()
  private readonly readWatermarks = new Map<string, number>()

  constructor(private readonly deps: DmManagerDeps) {}

  private epochId(): string | undefined {
    return this.deps.mail.epoch?.cur
  }

  /** Seal + PUT to the peer's current address. Throws when keys are unknown. */
  private sendBody(peerId: string, body: string, exp?: number): Promise<Envelope> {
    const keys = this.deps.store.peerKeys(peerId)
    if (!keys?.publicKeyHex || !keys.encryptionPubHex) {
      return Promise.reject(new Error('peer keys unknown'))
    }
    // A peer on another node keeps its mailbox THERE: drop the sealed
    // envelope straight into that node's box (it cannot read it either).
    const peerBase = peerNodeFor(peerId)
    return this.deps.mail.send(
      body,
      'mail',
      { publicKeyHex: keys.publicKeyHex, encryptionPubHex: keys.encryptionPubHex },
      {
        to: peerAddressToken(keys, deliveryToken),
        ...(peerBase ? { base: peerBase } : {}),
        ...(exp ? { exp } : {}),
      },
    )
  }

  /** Outgoing DM: optimistic append -> seal+PUT to courier via MailClient.
   *  `senderName` is sealed into the body so the recipient renders the author
   *  by name without a roster lookup. */
  async send(
    peerId: string,
    text: string,
    attachmentId?: string,
    senderName?: string,
    opts?: { replyToId?: string },
  ): Promise<DmMessage> {
    const keys = this.deps.store.peerKeys(peerId)
    const msg: DmMessage = {
      id: `dm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      peerId,
      own: true,
      text: clampDmText(text),
      ts: Date.now(),
      status: 'sending',
      ...(attachmentId ? { attachmentId } : {}),
      ...(senderName?.trim() ? { senderName: senderName.trim() } : {}),
      ...(opts?.replyToId ? { replyToId: opts.replyToId } : {}),
    }
    this.deps.store.appendLocal(msg)
    this.deps.onThreadChanged(peerId)
    if (!keys) {
      msg.status = 'failed'
      this.deps.store.setStatus(peerId, msg.id, 'failed')
      this.deps.onThreadChanged(peerId)
      logger.warn('[dm] no pubkey known for peer — message held locally (will not deliver)')
      return msg
    }
    try {
      const env = await this.sendBody(peerId, encodeDmBody(msg, this.epochId()))
      msg.status = 'sent'
      msg.envelopeId = env.id
    } catch {
      msg.status = 'failed'
    }
    this.deps.store.setStatus(peerId, msg.id, msg.status)
    this.deps.onThreadChanged(peerId)
    return msg
  }

  /** Author-only edit. Reverts locally when the peer cannot be reached, so the
   *  UI never shows a correction the other side did not receive. */
  async edit(peerId: string, id: string, text: string): Promise<boolean> {
    const next = clampDmText(text).trim()
    if (!next) return false
    const current = this.deps.store.thread(peerId).find((m) => m.id === id)
    if (!current || !current.own || current.deletedTs) return false
    const previous = { text: current.text, editedTs: current.editedTs }
    const ts = Date.now()
    this.deps.store.update(peerId, id, (m) => {
      m.text = next
      m.editedTs = ts
    })
    this.deps.onThreadChanged(peerId)
    try {
      await this.sendBody(peerId, encodeEditBody(id, next, ts, this.epochId()))
      return true
    } catch {
      this.deps.store.update(peerId, id, (m) => {
        m.text = previous.text
        if (previous.editedTs) m.editedTs = previous.editedTs
        else delete m.editedTs
      })
      this.deps.onThreadChanged(peerId)
      return false
    }
  }

  /**
   * Delete. `forEveryone: false` is a local hide (the peer keeps their copy);
   * the default notifies the author's peer. Both paths leave a tombstone, so
   * the message can never reappear from a replayed envelope.
   *
   * Returns false when the remote half could not be sent — the local delete
   * still stands, and the caller must say so instead of claiming a global
   * deletion.
   */
  async remove(peerId: string, id: string, opts?: { forEveryone?: boolean }): Promise<boolean> {
    const msg = this.deps.store.thread(peerId).find((m) => m.id === id)
    if (!msg) return false
    const forEveryone = opts?.forEveryone !== false
    // Only the author may delete for the other side; anyone may delete from
    // their own device. Both leave a tombstone, so neither can resurrect.
    if (forEveryone && !msg.own) return false
    this.deps.store.tombstone(peerId, id, msg.ts, msg.own)
    this.deps.onThreadChanged(peerId)
    if (!forEveryone) return true
    try {
      await this.sendBody(peerId, encodeDeleteBody(id, Date.now(), this.epochId()))
      return true
    } catch {
      return false
    }
  }

  /** Add/remove one reaction as this identity. Reverts on a failed send. */
  async react(peerId: string, id: string, emoji: string, on: boolean): Promise<boolean> {
    const clean = normaliseEmoji(emoji)
    if (!clean) return false
    const msg = this.deps.store.thread(peerId).find((m) => m.id === id)
    if (!msg || msg.deletedTs) return false
    const me = this.deps.identity.orbitId
    const apply = (add: boolean) => {
      this.deps.store.update(peerId, id, (m) => {
        const set = new Set(m.reactions?.[clean] ?? [])
        if (add) set.add(me)
        else set.delete(me)
        const next = { ...(m.reactions ?? {}) }
        if (set.size) next[clean] = [...set]
        else delete next[clean]
        if (Object.keys(next).length) m.reactions = next
        else delete m.reactions
      })
      this.deps.onThreadChanged(peerId)
    }
    apply(on)
    try {
      await this.sendBody(peerId, encodeReactBody(id, clean, on ? 'add' : 'remove', Date.now(), this.epochId()))
      return true
    } catch {
      apply(!on)
      return false
    }
  }

  /** Throttled transient ping. Never stored, never awaited by the caller. */
  type(peerId: string): void {
    const now = Date.now()
    if (!shouldEmitTyping(this.lastTypingAt.get(peerId) ?? 0, now)) return
    this.lastTypingAt.set(peerId, now)
    void this.sendBody(peerId, encodeTypingBody(now, this.epochId()), now + TYPING_TTL_MS).catch(
      () => { /* typing is best-effort by definition */ },
    )
  }

  /**
   * Tell the peer which of THEIR messages we actually viewed. One sealed event
   * per watermark; a restart may re-send the same one and the receiver's merge
   * is idempotent, so no persistence beyond the thread is needed.
   */
  markRead(peerId: string, upTo: number): void {
    if (!Number.isFinite(upTo) || upTo <= 0) return
    // The watermark describes THEIR messages that we viewed, so the reference
    // is the peer's last message at or below `upTo` — not our own.
    const theirs = this.deps.store.thread(peerId).filter((m) => !m.own && !m.deletedTs)
    const last = theirs.filter((m) => m.ts <= upTo).slice(-1)[0]
    if (!last) return
    const previous = this.readWatermarks.get(peerId) ?? 0
    if (upTo <= previous) return
    this.readWatermarks.set(peerId, upTo)
    void this.sendBody(peerId, encodeReadBody(last.id, upTo, this.epochId())).catch(() => {})
  }

  private applyEdit(peerId: string, id: string, text: string, ts: number): void {
    const msg = this.deps.store.thread(peerId).find((m) => m.id === id)
    // Only the author can edit. Inbound events are authored by the peer, so a
    // row we wrote (`own`) must never change here.
    if (!msg || msg.own || msg.deletedTs) return
    const base = msg.editedTs ?? msg.ts
    if (ts < base) return // stale edit or a replay: loses deterministically
    if (ts === base && text === msg.text) return // idempotent
    this.deps.store.update(peerId, id, (m) => {
      m.text = text
      m.editedTs = ts
    })
    this.deps.onThreadChanged(peerId)
  }

  private applyRemoteDelete(peerId: string, id: string, ts: number): void {
    const msg = this.deps.store.thread(peerId).find((m) => m.id === id)
    if (msg?.own) return // a peer may not delete what we authored
    this.deps.store.tombstone(peerId, id, msg?.ts ?? ts)
    this.deps.onThreadChanged(peerId)
  }

  private applyRemoteReaction(
    peerId: string,
    id: string,
    emoji: string,
    op: 'add' | 'remove',
  ): void {
    const clean = normaliseEmoji(emoji)
    if (!clean) return
    const msg = this.deps.store.thread(peerId).find((m) => m.id === id)
    if (!msg || msg.deletedTs) return
    this.deps.store.update(peerId, id, (m) => {
      const set = new Set(m.reactions?.[clean] ?? [])
      if (op === 'add') set.add(peerId)
      else set.delete(peerId)
      const next = { ...(m.reactions ?? {}) }
      if (set.size) next[clean] = [...set]
      else delete next[clean]
      if (Object.keys(next).length) m.reactions = next
      else delete m.reactions
    })
    this.deps.onThreadChanged(peerId)
  }

  /** Inbound hook wired to MailClient.onMail (opened envelopes only).
   * Returns true when the body was a DM event (consumed); room wires and
   * foreign kinds return false so the caller can route on. */
  handleOpened(opened: OpenedEnvelope, env: Envelope): boolean {
    const body = decodeBody(opened.body)
    if (!body) return false
    const peerId = opened.senderOrbitId
    // Trust-on-first-use: cache the sealing peer's pubkey material. The
    // sender's X25519 enc pub rides the wire as env.fromEph (ECIES input),
    // so replies/acks can be sealed back without a prior contact entry.
    const prior = this.deps.store.peerKeys(peerId)
    this.deps.store.rememberPeer(peerId, {
      publicKeyHex: opened.senderPubHex,
      encryptionPubHex: env.fromEph || '',
      // Learn the sender's rotating handle from the sealed body (C2); keep the
      // last known epoch when this body predates rotation.
      epoch: isEpoch(body.e) ? body.e : prior?.epoch,
    })

    if (body.t === 'dm_ack') {
      const own = this.deps.store.thread(peerId).find((m) => m.id === body.id)
      if (own) {
        this.deps.store.setStatus(peerId, body.id, 'delivered')
        this.deps.onThreadChanged(peerId)
      }
      return true
    }

    if (body.t === 'dm_read') {
      if (this.deps.store.markReadUpTo(peerId, body.upTo)) this.deps.onThreadChanged(peerId)
      return true
    }

    if (body.t === 'dm_typing') {
      this.deps.onTyping?.(peerId, body.at)
      return true
    }

    if (body.t === 'dm_edit') {
      this.applyEdit(peerId, body.id, body.text, body.ts)
      return true
    }

    if (body.t === 'dm_del') {
      this.applyRemoteDelete(peerId, body.id, body.ts)
      return true
    }

    if (body.t === 'dm_react') {
      this.applyRemoteReaction(peerId, body.id, body.emoji, body.op)
      return true
    }

    // body.t === 'dm'
    if (this.deps.store.hasMessage(peerId, body.id)) {
      // Already have it (our own echo, or a tombstone) — skip; ack only new.
      return true
    }
    const inbound: DmMessage = {
      id: body.id,
      peerId,
      own: false,
      text: body.text || '',
      ts: body.ts || Date.now(),
      status: 'delivered',
      envelopeId: opened.id,
      ...(typeof body.a === 'string' && body.a ? { attachmentId: body.a } : {}),
      // Absent on messages from an older client — the renderer falls back to
      // its roster for those, which is the pre-fix behaviour.
      ...(typeof body.n === 'string' && body.n ? { senderName: body.n } : {}),
      ...(typeof body.r === 'string' && body.r ? { replyToId: body.r } : {}),
    }
    this.deps.store.appendLocal(inbound)
    this.deps.onThreadChanged(peerId)
    this.deps.onIncoming?.(inbound)
    // Receipt rides the same sealed channel back to the sender's box.
    void this.sendBody(peerId, encodeAckBody(body.id, this.epochId())).catch(
      () => { /* best-effort receipt */ },
    )
    return true
  }
}
