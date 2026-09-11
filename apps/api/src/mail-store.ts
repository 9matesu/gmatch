import { verifySignature, hexToBytes } from '@orbit/crypto'
import { deliveryToken, sessionDeliveryToken } from '@orbit/protocol'

/**
 * Blind mail store — the courier's entire memory of a message.
 *
 * The courier NEVER reads envelope content: it validates SHAPE only (v2, hex
 * token, bounded opaque strings) and stores the sealed bytes verbatim.
 * Addresses are delivery tokens (blake3 of the recipient's Ed25519 pubkey) —
 * they name no person, and a connection is never required to declare who it
 * is, so the store cannot answer "who entered/left" either.
 *
 * Semantics (Session-swarm style): `list` is idempotent — mail stays until
 * the recipient ACKs it or TTL expires. `ack` deletes only when the caller
 * proves key ownership: token === blake3(pubkey) AND a valid Ed25519
 * signature over `token|ids`. Anyone can LIST a token (it is public), but
 * only the key-holder can drain it — guessing a token never deletes mail.
 *
 * Storage is deliberately in-memory (like the rest of the server's snapshot
 * model): mail that was never acked dies with a restart. That is the
 * trust-minimized default for an opaque relay — persisted ciphertext nobody
 * requested is exactly the liability the blind-courier law forbids.
 * Retention is TTL + caps, not durability.
 */

export interface MailEnvelope {
  v: 2
  kind: string
  /** delivery token (64-hex) — routing only. */
  to: string
  id: string
  sealed: string
  fromEph?: string
  /** unix ms after which the courier may drop this envelope. */
  exp?: number
}

export interface MailAck {
  token: string
  ids: string[]
  pubkey: string
  sig: string
  /** set when draining a rotating session token (wave 2 C2). */
  epoch?: string
}

export interface MailStoreOptions {
  defaultTtlMs?: number
  maxPerToken?: number
  maxTotal?: number
  /** max bytes of the opaque sealed field (base64 chars). */
  maxSealedLen?: number
}

interface Entry {
  env: MailEnvelope
  storedAt: number
}

export interface MailStore {
  put(env: MailEnvelope, now: number): boolean
  list(token: string, now: number): MailEnvelope[]
  ack(ack: MailAck): boolean
  sweep(now: number): number
  size(): number
}

const DEFAULTS = {
  defaultTtlMs: 7 * 24 * 3600_000, // 7 days
  maxPerToken: 256,
  maxTotal: 50_000,
  maxSealedLen: 64 * 1024,
} as const

export const TOKEN_RE = /^[0-9a-f]{64}$/
const PUBKEY_RE = /^[0-9a-f]{64}$/

export function createMailStore(opts: MailStoreOptions = {}): MailStore {
  const cfg = { ...DEFAULTS, ...opts }
  const byToken = new Map<string, Entry[]>()
  const ids = new Map<string, Entry>() // token:id -> entry (dedupe + O(1) drop)
  let total = 0

  function isWellFormed(env: MailEnvelope): boolean {
    return (
      env.v === 2 &&
      typeof env.kind === 'string' && env.kind.length > 0 && env.kind.length <= 16 &&
      typeof env.to === 'string' && TOKEN_RE.test(env.to) &&
      typeof env.id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(env.id) &&
      typeof env.sealed === 'string' &&
      env.sealed.length > 0 && env.sealed.length <= cfg.maxSealedLen &&
      (env.fromEph === undefined || /^[0-9a-f]{64}$/.test(env.fromEph)) &&
      (env.exp === undefined || (typeof env.exp === 'number' && env.exp > 0))
    )
  }

  function drop(entry: Entry): void {
    const list = byToken.get(entry.env.to)
    if (!list) return
    const i = list.indexOf(entry)
    if (i >= 0) list.splice(i, 1)
    if (list.length === 0) byToken.delete(entry.env.to)
    ids.delete(`${entry.env.to}:${entry.env.id}`)
    total--
  }

  function pickOldestEntry(): Entry | null {
    let oldest: Entry | null = null
    for (const list of byToken.values()) {
      const first = list[0]
      if (first && (!oldest || first.storedAt < oldest.storedAt)) oldest = first
    }
    return oldest
  }

  function put(env: MailEnvelope, now: number): boolean {
    if (!isWellFormed(env)) return false
    const key = `${env.to}:${env.id}`
    if (ids.has(key)) return true // retry-safe: same id = same envelope, keep first
    if (total >= cfg.maxTotal) {
      const oldest = pickOldestEntry()
      if (oldest) drop(oldest)
    }
    const list = byToken.get(env.to) || []
    if (list.length >= cfg.maxPerToken) {
      drop(list[0]) // per-token cap: keep newest
    }
    const entry: Entry = { env: { ...env }, storedAt: now }
    list.push(entry)
    byToken.set(env.to, list)
    ids.set(key, entry)
    total++
    return true
  }

  function list(token: string, now: number): MailEnvelope[] {
    const entries = byToken.get(token)
    if (!entries || entries.length === 0) return []
    const out: MailEnvelope[] = []
    for (const entry of [...entries]) {
      const exp = entry.env.exp ?? entry.storedAt + cfg.defaultTtlMs
      if (exp <= now) {
        drop(entry)
        continue
      }
      out.push(entry.env)
    }
    return out
  }

  function ack(a: MailAck): boolean {
    if (!TOKEN_RE.test(a.token) || !PUBKEY_RE.test(a.pubkey)) return false
    // Prove key ownership of the token: token must derive from this pubkey —
    // static home token, or a rotating session token when the ack carries the
    // epoch it was derived with (wave 2 C2). The sig below still covers the
    // exact token, so a stolen epoch cannot drain a box it never received.
    let derived = false
    try {
      derived = deliveryToken(a.pubkey) === a.token ||
        (typeof a.epoch === 'string' && /^[0-9a-f]{32}$/i.test(a.epoch) &&
          sessionDeliveryToken(a.pubkey, a.epoch) === a.token)
    } catch {
      derived = false
    }
    if (!derived) return false
    // ...and the ids list must be signed by that key (no token-guesser DoS).
    const msg = new TextEncoder().encode(`${a.token}|${a.ids.join(',')}`)
    let sig: Uint8Array
    try {
      sig = hexToBytes(a.sig)
    } catch {
      return false
    }
    if (!verifySignature(sig, msg, a.pubkey)) return false
    for (const id of a.ids) {
      const entry = ids.get(`${a.token}:${id}`)
      if (entry) drop(entry)
    }
    return true
  }

  function sweep(now: number): number {
    let dropped = 0
    for (const entries of [...byToken.values()]) {
      for (const entry of [...entries]) {
        const exp = entry.env.exp ?? entry.storedAt + cfg.defaultTtlMs
        if (exp <= now) {
          drop(entry)
          dropped++
        }
      }
    }
    return dropped
  }

  return { put, list, ack, sweep, size: () => total }
}

// ---- functional shims ----

export function putEnvelope(store: MailStore, env: MailEnvelope, now: number): boolean {
  return store.put(env, now)
}
export function listEnvelopes(store: MailStore, token: string, now: number): MailEnvelope[] {
  return store.list(token, now)
}
export function ackEnvelopes(store: MailStore, a: Omit<MailAck, 'token'> & { token?: string }): boolean {
  // token defaults to the derivation of the claimed pubkey (single-source).
  return store.ack({ token: a.token ?? deliveryToken(a.pubkey), ids: a.ids, pubkey: a.pubkey, sig: a.sig, epoch: a.epoch })
}
export function sweepMail(store: MailStore, now: number): number {
  return store.sweep(now)
}
