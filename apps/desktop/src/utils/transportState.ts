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
 * Honest note (do not "fix" this away): 'direct' does not distinguish a
 * LAN-local candidate from a hole-punched reflexive pair — WebRTC's
 * selected-candidate-pair is implementation-internal here. What the phase
 * DOES promise: the bytes are traveling peer-to-peer over DTLS, not through
 * the node. Whether a symmetric NAT on BOTH sides can ever produce that pair
 * depends on the network, and the relay remains the usable fallback for it.
 */

export type PeerTransportPhase =
  | 'idle'
  | 'connecting-direct'
  | 'direct'
  | 'relay'
  | 'failed'

export interface PeerTransportEntry {
  phase: PeerTransportPhase
  directAttempts: number
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
  snapshot(): ReadonlyMap<string, PeerTransportEntry>
  phaseFor(peerId: string): PeerTransportPhase
  /** A direct handshake starts; deadline-bounded. */
  startDirectAttempt(peerId: string): void
  /** The DataChannel opened: the direct path is validated and promoted. */
  markDirectValidated(peerId: string): void
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
  const deadline = options.directDeadlineMs ?? 12_000
  const baseRetry = options.baseRetryMs ?? 1_500
  const maxRetry = options.maxRetryMs ?? 30_000
  const peers = new Map<string, PeerTransportEntry>()
  /** One-shot retry latches: consumed by shouldRetryDirect. */
  const retryDue = new Set<string>()

  function entry(peerId: string): PeerTransportEntry {
    let found = peers.get(peerId)
    if (!found) {
      found = { phase: 'idle', directAttempts: 0, nextDirectRetryAt: 0, lastChangeAt: now() }
      peers.set(peerId, found)
    }
    return found
  }

  function setPhase(peerId: string, phase: PeerTransportPhase, failure?: string): PeerTransportEntry {
    const e = entry(peerId)
    if (e.phase !== phase) {
      e.phase = phase
      e.lastChangeAt = now()
    }
    e.lastFailure = failure
    return e
  }

  return {
    snapshot() { return peers },
    phaseFor(peerId) { return peers.get(peerId)?.phase ?? 'idle' },
    startDirectAttempt(peerId) {
      if (!peerId) return
      const e = setPhase(peerId, 'connecting-direct')
      e.directAttempts += 1
      e.nextDirectRetryAt = 0
    },
    markDirectValidated(peerId) {
      if (!peerId) return
      const e = setPhase(peerId, 'direct')
      e.directAttempts = 0
      e.nextDirectRetryAt = 0
      e.lastFailure = undefined
      retryDue.delete(peerId)
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
      retryDue.delete(peerId)
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
      retryDue.add(peerId)
      return true
    },
    forget(peerId) {
      peers.delete(peerId)
      retryDue.delete(peerId)
    },
    reset() {
      peers.clear()
      retryDue.clear()
    },
  }
}
