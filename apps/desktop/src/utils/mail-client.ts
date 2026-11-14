import type { OrbitIdentity } from '@orbit/crypto'
import { signMessage } from '@orbit/crypto'
import {
  seal1to1,
  open1to1,
  deliveryToken,
  sessionDeliveryToken,
  type Envelope,
  type EnvelopeKind,
  type OpenedEnvelope,
} from '@orbit/protocol'
import { watchedTokens, isEpoch, type EpochState } from './handleRotation'
import { wsUrlForBase } from './api'
import { isKnownSiteCourier } from './mail-mode'

/**
 * Blind-courier mail client (plan Phase 3.1).
 *
 * - Addressing: my inbox token = deliveryToken(my Ed25519 pubkey). Anyone who
 *   knows my pubkey can drop sealed mail; only my encPriv opens it.
 * - Send: PUT /api/mail/:token with a sealed Envelope (ECIES under the
 *   recipient's encPub — the courier never sees the message, the sender's
 *   orbitId, or the recipient's pubkey beyond the token).
 * - Receive: anonymous WS watch (no identity exchanged). A notice only says
 *   "mail for <token>"; the client GETs the box, decrypts each envelope it
 *   can open, and ACKs only what it consumed (drain requires our key).
 * - Offline-safe: watch reconnects with jittered backoff; pull is also
 *   callable on demand (app foreground). Un-acked mail stays on the courier
 *   until TTL — the blind-courier tradeoff documented in the plan.
 */

export interface MailSocket {
  send(data: string): void
  close(): void
  onopen: (() => void) | null
  onmessage: ((ev: { data: string }) => void) | null
  onclose: (() => void) | null
}

export interface MailClientDeps {
  /** API base without trailing slash, e.g. http://127.0.0.1:8790 */
  apiBase: string
  /** Additional mailbox bases where mail can legitimately land — typically
   *  the node this client is CONNECTED to when the primary is the rendezvous
   *  courier. A sender chooses the box: a peer who learned our node from a
   *  signed beacon drops the envelope into THAT node's mailbox; one who
   *  never learned a node uses the rendezvous. A receiver that drains only
   *  the primary silently loses mail a peer addressed to its node. */
  extraBases?: string[]
  identity: OrbitIdentity
  webSocketFactory?: (url: string) => MailSocket
  fetchImpl?: typeof fetch
  now?: () => number
  /** Side effect for each successfully opened envelope (dedup by id here).
   * Receives the wire envelope too — `env.fromEph` (the sender's X25519 pub)
   * is needed to seal replies/acks back without a prior contact entry. */
  onMail: (opened: OpenedEnvelope, env: Envelope) => void
  log?: (msg: string) => void
}

const BACKOFF_BASE_MS = 1000
const BACKOFF_MAX_MS = 60_000
/** Courier polling: the Cloudflare relay has no shared socket state, so the
 *  client asks for its box on a slow timer instead of holding a WS. */
const POLL_INTERVAL_MS = 20_000
/** Bounded receiver fan-out: at most this many mailbox bases are drained. */
const MAX_MAIL_BASES = 4

/** Ed25519 ack body proving box ownership: sig over `<token>|<ids>`. */
export function ackBody(identity: OrbitIdentity, token: string, ids: string[], epoch?: string): { ids: string[]; pubkey: string; sig: string; epoch?: string } {
  const msg = new TextEncoder().encode(`${token}|${ids.join(',')}`)
  const body: { ids: string[]; pubkey: string; sig: string; epoch?: string } = { ids, pubkey: identity.publicKeyHex, sig: hexOf(signMessage(msg, identity.privateKeyHex)) }
  // Session-token drains carry the epoch the token was derived with (C2);
  // the courier re-derives blake3(pubkey||epoch) to verify ownership.
  if (epoch) body.epoch = epoch
  return body
}

function hexOf(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

function randomId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return hexOf(bytes)
}

export class MailClient {
  readonly token: string
  /** Rotating session epochs (wave 2 C2): cur is this boot's, prev drains
   * one boot of overlap. Persisted by the caller via secure-storage. */
  epoch: EpochState = { cur: '', prev: '' }
  /** One watch socket per mailbox base (a full node can push; the page
   *  courier cannot). */
  private sockets = new Map<string, MailSocket>()
  private reconnectAttempts = new Map<string, number>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectBase: string | null = null
  private closed = false
  private started = false
  private pulling: Promise<OpenedEnvelope[]> | null = null
  private pullQueued = false
  private pollTimer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly deps: MailClientDeps) {
    this.token = deliveryToken(deps.identity.publicKeyHex)
  }

  /** [apiBase, ...extraBases] — distinct, normalized, bounded. */
  private bases(): string[] {
    const out: string[] = [this.deps.apiBase.replace(/\/+$/, '')]
    for (const extra of this.deps.extraBases ?? []) {
      const base = String(extra).replace(/\/+$/, '')
      if (!base || out.includes(base)) continue
      out.push(base)
      if (out.length >= MAX_MAIL_BASES) break
    }
    return out
  }

  /**
   * Add mailboxes to drain, after the client was built.
   *
   * The node this client is connected to can be learned late: a browser build
   * rides the dev proxy with a RELATIVE base, so the node's own box is not in
   * the list until the node answers for itself (`/api/servers/node`). Without
   * it, a peer that learned our node from the signed beacon drops envelopes
   * into a box nobody reads.
   */
  addBases(bases: string[]): void {
    const before = this.bases()
    const merged = [...(this.deps.extraBases ?? [])]
    for (const base of bases) {
      const clean = String(base || '').replace(/\/+$/, '')
      if (clean && !merged.includes(clean)) merged.push(clean)
    }
    this.deps.extraBases = merged
    // A base learned after start() still needs its watch socket.
    for (const base of this.bases()) {
      if (!before.includes(base)) this.connect(base)
    }
  }

  /** All delivery tokens watched and pulled this session (home + cur + prev session tokens). */
  watchedTokens(): string[] {
    return watchedTokens(this.token, this.epoch, this.deps.identity.publicKeyHex)
  }

  /** Open the anonymous watch channels (one per non-courier mailbox base).
   *  Idempotent. Bases that are known page couriers (stateless across
   *  isolates, no shared socket state) poll their boxes instead. */
  start(): void {
    if (this.started || this.closed) return
    this.started = true
    let anyPollBase = false
    for (const base of this.bases()) {
      if (isKnownSiteCourier(base)) {
        anyPollBase = true
        continue
      }
      this.connect(base)
    }
    if (anyPollBase) {
      void this.pull()
      this.startPolling()
    }
  }

  stop(): void {
    this.closed = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.stopPolling()
    for (const sock of this.sockets.values()) {
      try { sock.close() } catch { /* already dead */ }
    }
    this.sockets.clear()
  }

  private startPolling(): void {
    if (this.pollTimer || this.closed) return
    this.pollTimer = setInterval(() => void this.pull(), POLL_INTERVAL_MS)
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  private socketFactory(): (url: string) => MailSocket {
    if (this.deps.webSocketFactory) return this.deps.webSocketFactory
    if (typeof WebSocket === 'undefined') throw new Error('MailClient: no WebSocket available')
    return (url: string) => new WebSocket(url) as unknown as MailSocket
  }

  private fetcher(): typeof fetch {
    return this.deps.fetchImpl ?? globalThis.fetch.bind(globalThis)
  }

  private log(msg: string): void {
    this.deps.log?.(msg)
  }

  private wsUrl(base: string): string {
    // Shared with the swarm socket (utils/api.ts): a relative base rides the
    // page's own origin (dev proxy) instead of producing an invalid `ws:///…`.
    return wsUrlForBase(base, '/api/mail/ws')
  }

  private connect(base: string): void {
    if (this.closed || this.sockets.has(base)) return
    let sock: MailSocket
    try {
      sock = this.socketFactory()(this.wsUrl(base))
    } catch (e) {
      this.log(`[mail] socket create failed (${base}): ${(e as Error).message}`)
      this.scheduleReconnect(base)
      return
    }
    this.sockets.set(base, sock)
    sock.onopen = () => {
      this.reconnectAttempts.delete(base)
      sock.send(JSON.stringify({ type: 'watch', tokens: this.watchedTokens() }))
      // Anything that arrived while disconnected is fetched once on connect.
      void this.pull()
    }
    sock.onmessage = (ev) => {
      let frame: { type?: string; to?: string }
      try {
        frame = JSON.parse(String(ev.data))
      } catch {
        return
      }
      if (frame.type === 'mail' && this.watchedTokens().includes(frame.to || '')) void this.pull()
    }
    sock.onclose = () => {
      this.sockets.delete(base)
      this.scheduleReconnect(base)
    }
  }

  private scheduleReconnect(base: string): void {
    if (this.closed) return
    const attempt = this.reconnectAttempts.get(base) ?? 0
    const delay = Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_MAX_MS)
      * (0.5 + Math.random() * 0.5) // jitter: anti-correlation on the courier
    this.reconnectAttempts.set(base, attempt + 1)
    this.reconnectBase = base
    this.reconnectTimer = setTimeout(() => {
      if (this.reconnectBase === base) this.reconnectBase = null
      this.connect(base)
    }, delay)
  }

  /** Drop a sealed envelope into the recipient's box. Returns the envelope.
   *
   *  `opts.base` is the NODE the recipient is connected to: a peer on another
   *  node has its mailbox there, not on ours. The envelope is sealed either
   *  way — the node only ever moves ciphertext it cannot open. */
  async send(
    body: string,
    kind: EnvelopeKind,
    recipient: { publicKeyHex: string; encryptionPubHex: string },
    opts?: { id?: string; exp?: number; to?: string; base?: string },
  ): Promise<Envelope> {
    const id = this.deps.identity
    const env = seal1to1(body, kind, {
      privateKeyHex: id.privateKeyHex,
      publicKeyHex: id.publicKeyHex,
      encryptionPrivHex: id.encryptionPrivHex,
      encryptionPubHex: id.encryptionPubHex,
    }, recipient, { ...opts, id: opts?.id ?? randomId() })
    const target = (opts?.base || this.deps.apiBase).replace(/\/+$/, '')
    const res = await this.fetcher()(`${target}/api/mail/${env.to}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ env }),
    })
    if (!res.ok) throw new Error(`mail PUT failed (${res.status})`)
    this.log(`[mail] sealed ${kind} envelope delivered to courier (id ${env.id})`)
    return env
  }

  /** Fetch + open + ack our box.
   *
   * Concurrent calls share one drain, BUT a call that lands while a drain is
   * running queues one more pass instead of being absorbed by it. A notice
   * usually arrives just after the box was listed (the envelope is written
   * first, then pushed), so absorbing it dropped the message on the floor: it
   * sat on the courier until something else happened to pull, which is the
   * "sometimes a DM simply never arrives" report. */
  pull(): Promise<OpenedEnvelope[]> {
    if (this.pulling) {
      this.pullQueued = true
      return this.pulling
    }
    this.pulling = this.drain()
    return this.pulling
  }

  private async drain(): Promise<OpenedEnvelope[]> {
    const received: OpenedEnvelope[] = []
    try {
      do {
        this.pullQueued = false
        received.push(...(await this.doPull()))
      } while (this.pullQueued)
    } finally {
      this.pulling = null
    }
    return received
  }

  private async doPull(): Promise<OpenedEnvelope[]> {
    const opened: OpenedEnvelope[] = []
    const myPub = this.deps.identity.publicKeyHex
    const curToken = isEpoch(this.epoch.cur) ? sessionDeliveryToken(myPub, this.epoch.cur) : ''
    const prevToken = isEpoch(this.epoch.prev) ? sessionDeliveryToken(myPub, this.epoch.prev) : ''

    // Every mailbox base where mail can legitimately land (the rendezvous +
    // the node we are connected to), × each owned token (home + cur + prev).
    //
    // The boxes are pulled CONCURRENTLY. This used to be a nested serial
    // loop: with 4 bases × 3 tokens that is 12 GETs and up to 12 ACK POSTs,
    // one round-trip at a time — a burst of notices cost O(N × 24) serial
    // RTTs before the first message appeared. The per-token epoch mapping
    // and the "never ack what we cannot open" rule are preserved exactly;
    // only the waiting is parallel.
    // The same envelope can sit in two boxes (a sender who did not know which
    // node we were on sealed to both). Opening it twice would render the
    // message twice and ack it twice, so ids are claimed once per drain.
    const claimed = new Set<string>()
    const jobs: Array<Promise<void>> = []
    for (const base of this.bases()) {
      for (const token of this.watchedTokens()) {
        jobs.push((async () => {
          const res = await this.fetcher()(`${base}/api/mail/${token}`).catch(() => null)
          if (!res || !res.ok) {
            this.log(`[mail] pull failed (${base.replace(/^https?:\/\//, '')} ${res ? res.status : 'network'})`)
            return
          }
          const { envelopes } = (await res.json()) as { envelopes?: Envelope[] }
          if (!Array.isArray(envelopes) || envelopes.length === 0) return
          const consumed: string[] = []
          for (const env of envelopes) {

            if (!env.id || claimed.has(env.id)) continue
            try {
              const o = open1to1(env, this.deps.identity.encryptionPrivHex)
              claimed.add(env.id)
              opened.push(o)
              consumed.push(env.id)
              this.deps.onMail(o, env)
            } catch {
              // Not openable by us (token collision/corruption) — leave it; the
              // courier TTL collects it. Never ack what we cannot open.
            }
          }
          if (consumed.length > 0) {
            const epoch = token === curToken ? this.epoch.cur : (token === prevToken ? this.epoch.prev : undefined)
            await this.fetcher()(`${base}/api/mail/${token}/ack`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(ackBody(this.deps.identity, token, consumed, epoch)),
            }).catch(() => { /* mail stays until TTL; a later pull re-consumes */ })
          }
        })())
      }
    }
    await Promise.all(jobs)
    return opened
  }
}
