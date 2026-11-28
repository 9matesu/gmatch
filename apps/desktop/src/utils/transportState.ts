"use client";

/**
 * Per-peer transport-selection state machine (roadmap P0: NAT fallback).
 *
 * The swarm deliberately fans every frame out over ALL wired pipes
 * (BroadcastChannel, the node's WS relay, direct WebRTC mesh). That layout
 * already gives the relay fallback: a peer whose direct path is dead still
 * receives and ships bytes through the node. What was missing is an EXPLICIT,
 * observable statement of which path is actually in use per peer, bounded
 * direct-attempt deadlines, and a retry policy that keeps the relay session
 * alive while direct keeps being attempted in the background.
 *
 * Phases (per peer):
 *
 *   idle             nothing attempted yet; frames reach it through the relay
 *                    and/or BroadcastChannel only.
 *   connecting-direct an offer/answer handshake is in flight; frames ride
 *                    the relay meanwhile. A deadline bounds the attempt.
 *   direct           the DataChannel OPENED — that is the validation: ICE
 *                    melted through and DTLS is up. Only now is the peer
 *                    considered direct. Promotions never interrupt transfers:
 *                    the relay pipe simply stops being needed.
 *   relay            the direct attempt failed (or its deadline expired);
 *                    the peer still talks through the node's relay. A direct
 *                    retry is scheduled with exponential backoff + jitter so
 *                    two peers that both keep retrying eventually collide on
 *                    a working moment.
 *   failed           direct failed AND the session has no relay pipe wired
 *                    (offline node). Recovery means re-marking the relay.
 *
 * Honest note: 'direct' means the DataChannel OPENED — bytes travel
 * peer-to-peer over DTLS, never through the node. The caller tags the
 * negotiated remote candidate as Radmin/global-IPv6 when its stats say so;
 * otherwise the generic label is "P2P direct" (LAN or STUN-reflexive). When
 * no direct pair forms (CGNAT/symmetric NAT), the phase stays `relay` and the
 * label says so. A CGNAT-only peer is never promoted without a real channel.
 */

export type PeerTransportPhase =
  | 'idle'
  | 'connecting-direct'
  | 'direct'
  | 'relay'
  | 'failed'

/**
 * The ONE human label for a validated transport phase. `idle` and
 * `connecting-direct` have no settled route yet, so they say nothing — the UI
 * never claims "P2P direct" for a dial that has not opened. A validated direct
 * channel tags its negotiated remote candidate: Radmin reads
 * "VPN direct (Radmin)", global IPv6 reads "P2P direct (IPv6)".
 */
export function transportLabel(phase: PeerTransportPhase, viaRadmin = false, viaIpv6 = false): string | null {
  switch (phase) {
    case 'direct': return viaRadmin ? 'VPN direct (Radmin)' : viaIpv6 ? 'P2P direct (IPv6)' : 'P2P direct'
    case 'relay': return 'relay via node (NAT)'
    case 'failed': return 'no route'
    default: return null
  }
}

export interface PeerTransportEntry {
  phase: PeerTransportPhase
  directAttempts: number
  /** The validated direct channel's remote candidate is a Radmin VPN address. */
  directViaRadmin: boolean
  /** The validated direct channel's remote candidate is global IPv6 (2000::/3). */
  directViaIpv6: boolean
  /** Epoch ms when the next direct retry is allowed (0 = not scheduled). */
  nextDirectRetryAt: number
  lastChangeAt: number
  /** Last failure reason (no secrets — ids and error messages only). */
  lastFailure?: string
}

export interface TransportRegistryOptions {
  now?: () => number
  /** Direct-attempt deadline before we declare it failed. */
  directDeadlineMs?: number
  /** Base backoff for direct retries. */
  baseRetryMs?: number
  /** Ceiling for the direct retry backoff. */
  maxRetryMs?: number
}

export interface TransportRegistry {
  /** Subscribe to phase changes — chrome reads this to stay live, never a copy. */
  subscribe(listener: () => void): () => void
  snapshot(): ReadonlyMap<string, PeerTransportEntry>
  phaseFor(peerId: string): PeerTransportPhase
  /** True only for a validated direct channel whose remote candidate is Radmin. */
  isDirectViaRadmin(peerId: string): boolean
  /** True only for a validated direct channel whose remote candidate is global IPv6. */
  isDirectViaIpv6(peerId: string): boolean
  /** A direct handshake starts; deadline-bounded. */
  startDirectAttempt(peerId: string): void
  /** The DataChannel opened: the direct path is validated and promoted. */
  markDirectValidated(peerId: string, viaRadmin?: boolean, viaIpv6?: boolean): void
  /**
   * The direct attempt failed or timed out. If the session still has a relay
   * pipe (`hasRelay`), the peer demotes to `relay` with a scheduled retry;
   * without one it parks in `failed`.
   */
  markDirectFailed(peerId: string, reason: string, hasRelay: boolean): void
  /** Deadline check: is the in-flight direct attempt overdue? */
  isDirectAttemptOverdue(peerId: string): boolean
  /** A working relay session is wired for this peer. */
  markRelayInUse(peerId: string): void
  /** Should the caller fire a direct retry now? Fires at most once. */
  shouldRetryDirect(peerId: string): boolean
  forget(peerId: string): void
  reset(): void
}

export function createTransportRegistry(options: TransportRegistryOptions = {}): TransportRegistry {
  const now = options.now ?? (() => Date.now())
  // Must outlast the mesh dial's own 30s timeout (connectToPeerMesh): a
  // shorter deadline killed slow IPv6/Radmin handshakes that were still
  // gathering, so a viable direct path was declared relay before it opened.
  const deadline = options.directDeadlineMs ?? 30_000
  const baseRetry = options.baseRetryMs ?? 1_500
  const maxRetry = options.maxRetryMs ?? 30_000
  const peers = new Map<string, PeerTransportEntry>()
  const listeners = new Set<() => void>()

  function emit(): void {
    for (const listener of listeners) listener()
  }

  function entry(peerId: string): PeerTransportEntry {
    let found = peers.get(peerId)
    if (!found) {
      found = { phase: 'idle', directAttempts: 0, directViaRadmin: false, directViaIpv6: false, nextDirectRetryAt: 0, lastChangeAt: now() }
      peers.set(peerId, found)
    }
    return found
  }

  function setPhase(peerId: string, phase: PeerTransportPhase, failure?: string): PeerTransportEntry {
    const e = entry(peerId)
    const changed = e.phase !== phase
    if (changed) {
      e.phase = phase
      e.lastChangeAt = now()
    }
    e.lastFailure = failure
    if (changed) emit()
    return e
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    snapshot() { return peers },
    phaseFor(peerId) { return peers.get(peerId)?.phase ?? 'idle' },
    isDirectViaRadmin(peerId) {
      const e = peers.get(peerId)
      return e?.phase === 'direct' && e.directViaRadmin
    },
    isDirectViaIpv6(peerId) {
      const e = peers.get(peerId)
      return e?.phase === 'direct' && e.directViaIpv6
    },
    startDirectAttempt(peerId) {
      if (!peerId) return
      const e = setPhase(peerId, 'connecting-direct')
      e.directAttempts += 1
      e.nextDirectRetryAt = 0
    },
    markDirectValidated(peerId, viaRadmin = false, viaIpv6 = false) {
      if (!peerId) return
      const e = setPhase(peerId, 'direct')
      e.directAttempts = 0
      e.nextDirectRetryAt = 0
      e.directViaRadmin = viaRadmin
      e.directViaIpv6 = viaIpv6
      e.lastFailure = undefined
    },
    markDirectFailed(peerId, reason, hasRelay) {
      if (!peerId) return
      const e = entry(peerId)
      const attempts = Math.max(1, e.directAttempts)
      // Exponential backoff with full jitter of ±25%.
      const growth = Math.min(maxRetry, baseRetry * 2 ** Math.min(attempts - 1, 6))
      const jitter = 0.75 + 0.5 * Math.random()
      const nextAt = hasRelay ? now() + Math.round(growth * jitter) : 0
      e.nextDirectRetryAt = nextAt
      setPhase(peerId, hasRelay ? 'relay' : 'failed', reason)
    },
    isDirectAttemptOverdue(peerId) {
      const e = peers.get(peerId)
      if (!e || e.phase !== 'connecting-direct') return false
      return now() - e.lastChangeAt > deadline
    },
    markRelayInUse(peerId) {
      if (!peerId) return
      const e = peers.get(peerId)
      // Only demote when nothing better is known: promotion to direct always
      // wins over a relay sighting, and a scheduled retry is preserved.
      if (!e || e.phase === 'idle' || e.phase === 'failed') setPhase(peerId, 'relay')
    },
    shouldRetryDirect(peerId) {
      if (!peerId) return false
      const e = peers.get(peerId)
      if (!e) return false
      if (e.phase === 'direct' || e.phase === 'connecting-direct') return false
      if (!e.nextDirectRetryAt) return false
      if (now() < e.nextDirectRetryAt) return false
      // Consume: the caller owns re-starting the attempt.
      e.nextDirectRetryAt = 0
      return true
    },
    forget(peerId) {
      peers.delete(peerId)
    },
    reset() {
      peers.clear()
    },
  }
}

/**
 * The ONE registry the P2P hook and the header peer chip read. A component
 * never builds its own transport state: every phase transition the swarm makes
 * is the phase this instance reports.
 */
export const swarmTransportRegistry = createTransportRegistry()
