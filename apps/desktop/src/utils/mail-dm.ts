import type { OpenedEnvelope, Envelope } from '@orbit/protocol'
import { deliveryToken } from '@orbit/protocol'
import { getSecureItem, setSecureItem } from './secure-storage'
import type { MailClient } from './mail-client'
import type { OrbitIdentity } from '@orbit/crypto'
import { logger } from './logger'
import { isEpoch, peerAddressToken } from './handleRotation'

/**
 * Courier-backed DM layer (plan P3.2). Source of truth is LOCAL
 * (localStorage thread store); the courier only carries sealed envelopes —
 * there is no server inbox anymore. Delivery status per message:
 *   'sent'    -> envelope accepted by the courier (queued for the peer)
 *   'delivered' -> opened and acked by the recipient (best-effort: inferred
 *                  from read receipts exchanged INSIDE sealed dm_ack bodies)
 *   'failed'  -> courier rejected the PUT (dead server / bad token)
 *
 * Peer pubkey resolution: an incoming envelope's senderOrbitId is trusted
 * ONLY together with the pubkey that sealed it (open1to1 already verified the
 * Ed25519 signature over kind|id|to|body). We cache orbitId -> {pubkey,
 * encPub} from contact lists and from every opened envelope, so replies can
 * seal to a peer we have never met via the old server roster.
 */

export interface DmMessage {
  id: string
  peerId: string
  own: boolean
  text: string
  ts: number
  status: 'sending' | 'sent' | 'delivered' | 'failed'
  envelopeId?: string
}

const THREADS_KEY = 'orbit_mail_threads_v1'
const KEYS_KEY = 'orbit_mail_peerkeys_v1'
const MAX_PER_THREAD = 500

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
    all[peerId] = thread.slice(-MAX_PER_THREAD)
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

  hasMessage(peerId: string, id: string): boolean {
    return this.thread(peerId).some((m) => m.id === id)
  }
}

/** Body format for DM envelopes + receipts (all sealed end-to-end).
 * `e` piggybacks the sender's current session epoch (wave 2 C2) so replies
 * address the rotating token instead of the static home token. */
export function encodeDmBody(msg: DmMessage, epoch?: string): string {
  return JSON.stringify({ t: 'dm', id: msg.id, text: msg.text, ts: msg.ts, ...(epoch ? { e: epoch } : {}) })
}
export function encodeAckBody(refId: string, epoch?: string): string {
  return JSON.stringify({ t: 'dm_ack', id: refId, ...(epoch ? { e: epoch } : {}) })
}

export function decodeBody(json: string): { t: 'dm' | 'dm_ack'; id: string; text?: string; ts?: number; e?: string } | null {
  try {
    const parsed = JSON.parse(json)
    if ((parsed.t === 'dm' || parsed.t === 'dm_ack') && typeof parsed.id === 'string') return parsed
  } catch { /* foreign envelope kind (signal/announce) — not a DM */ }
  return null
}

export interface DmManagerDeps {
  mail: MailClient
  store: DmStore
  identity: OrbitIdentity
  onThreadChanged: (peerId: string) => void
  /** Fired once per NEW inbound dm after it was stored (UI notification). */
  onIncoming?: (msg: DmMessage) => void
}

export class DmManager {
  constructor(private readonly deps: DmManagerDeps) {}

  /** Outgoing DM: optimistic append -> seal+PUT to courier via MailClient. */
  async send(peerId: string, text: string): Promise<DmMessage> {
    const keys = this.deps.store.peerKeys(peerId)
    const msg: DmMessage = {
      id: `dm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      peerId,
      own: true,
      text,
      ts: Date.now(),
      status: 'sending',
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
      const env = await this.deps.mail.send(encodeDmBody(msg, this.deps.mail.epoch?.cur), 'mail', {
        publicKeyHex: keys.publicKeyHex,
        encryptionPubHex: keys.encryptionPubHex,
      }, { to: peerAddressToken(keys, deliveryToken) })
      msg.status = 'sent'
      msg.envelopeId = env.id
    } catch {
      msg.status = 'failed'
    }
    this.deps.store.setStatus(peerId, msg.id, msg.status)
    this.deps.onThreadChanged(peerId)
    return msg
  }

  /** Inbound hook wired to MailClient.onMail (opened envelopes only).
   * Returns true when the body was a DM/ack (consumed); room wires and
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
      // Learn the sender's rotating handle from the sealed body (C2); keep
      // the last known epoch when this body predates rotation.
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
    if (this.deps.store.hasMessage(peerId, body.id)) {
      // Already have it (our own echo) — skip; send the ack only for new.
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
    }
    this.deps.store.appendLocal(inbound)
    this.deps.onThreadChanged(peerId)
    this.deps.onIncoming?.(inbound)
    // Receipt rides the same sealed channel back to the sender's box.
    const peerKeys = this.deps.store.peerKeys(peerId)
    if (peerKeys?.encryptionPubHex) {
      void this.deps.mail
        .send(encodeAckBody(body.id, this.deps.mail.epoch?.cur), 'mail', {
          publicKeyHex: peerKeys.publicKeyHex,
          encryptionPubHex: peerKeys.encryptionPubHex,
        }, { to: peerAddressToken(peerKeys, deliveryToken) })
        .catch(() => { /* best-effort receipt */ })
    }
    return true
  }
}
