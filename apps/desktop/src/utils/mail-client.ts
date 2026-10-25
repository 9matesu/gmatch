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
  private ws: MailSocket | null = null
  private reconnectAttempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private closed = false
  private started = false
  private pulling: Promise<OpenedEnvelope[]> | null = null
  private pullQueued = false
  private pollTimer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly deps: MailClientDeps) {
    this.token = deliveryToken(deps.identity.publicKeyHex)
  }

  /** All delivery tokens watched and pulled this session (home + cur + prev session tokens). */
  watchedTokens(): string[] {
    return watchedTokens(this.token, this.epoch, this.deps.identity.publicKeyHex)
  }

  /** Open the anonymous watch channel. Idempotent. */
  start(): void {
    if (this.started || this.closed) return
    this.started = true
    // The Cloudflare courier is stateless across isolates: no socket can be
    // notified from the isolate that stored the envelope. Poll its boxes
    // instead (a few hundred bytes per tick, no identity attached).
    if (this.courierOnly()) {
      void this.pull()
      this.startPolling()
      return
    }
    this.connect()
  }

  stop(): void {
    this.closed = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.stopPolling()
    try {
      this.ws?.close()
    } catch { /* already dead */ }
    this.ws = null
  }

  private courierOnly(): boolean {
    return isKnownSiteCourier(this.deps.apiBase)
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

  private wsUrl(): string {
    // Shared with the swarm socket (utils/api.ts): a relative base rides the
    // page's own origin (dev proxy) instead of producing an invalid `ws:///…`.
    return wsUrlForBase(this.deps.apiBase, '/api/mail/ws')
  }

  private connect(): void {
    if (this.closed) return
    let sock: MailSocket
    try {
      sock = this.socketFactory()(this.wsUrl())
    } catch (e) {
      this.log(`[mail] socket create failed: ${(e as Error).message}`)
      this.scheduleReconnect()
      return
    }
    this.ws = sock
    sock.onopen = () => {
      this.reconnectAttempt = 0
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
      this.ws = null
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    if (this.closed) return
    const delay = Math.min(BACKOFF_BASE_MS * 2 ** this.reconnectAttempt, BACKOFF_MAX_MS)
      * (0.5 + Math.random() * 0.5) // jitter: anti-correlation on the courier
    this.reconnectAttempt++
    this.reconnectTimer = setTimeout(() => this.connect(), delay)
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
    const base = this.deps.apiBase.replace(/\/+$/, '')
    const opened: OpenedEnvelope[] = []
    const myPub = this.deps.identity.publicKeyHex
    const curToken = isEpoch(this.epoch.cur) ? sessionDeliveryToken(myPub, this.epoch.cur) : ''
    const prevToken = isEpoch(this.epoch.prev) ? sessionDeliveryToken(myPub, this.epoch.prev) : ''

    // Wave 2 (C2): drain home + current + previous session boxes each pull.
    for (const token of this.watchedTokens()) {
      const res = await this.fetcher()(`${base}/api/mail/${token}`).catch(() => null)
      if (!res || !res.ok) {
        this.log(`[mail] pull failed (${res ? res.status : 'network'})`)
        continue
      }
      const { envelopes } = (await res.json()) as { envelopes?: Envelope[] }
      if (!Array.isArray(envelopes) || envelopes.length === 0) continue
      const consumed: string[] = []
      for (const env of envelopes) {
        try {
          const o = open1to1(env, this.deps.identity.encryptionPrivHex)
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
    }
    return opened
  }
}
