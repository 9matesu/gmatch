import { sessionDeliveryToken } from '@orbit/protocol'
import type { PeerKeys } from './mail-dm'

/**
 * Wave 2 (C2): rotating session handles, pure logic (no I/O — the caller
 * persists via secure-storage, same as the DM thread store).
 *
 * Each boot rotates `cur` (prev kept one cycle so mail addressed to
 * yesterday's token still drains). Peers learn the new epoch from the sealed
 * dm/dm_ack bodies they receive; until then, senders fall back to the static
 * home token. The courier therefore cannot link one session's box to the
 * next for the same key.
 */

export interface EpochState {
  cur: string
  prev: string
}

export function newEpoch(): string {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}

export function rotateEpoch(stored: EpochState | null): EpochState {
  if (!stored || !isEpoch(stored.cur)) return { cur: newEpoch(), prev: '' }
  return { cur: newEpoch(), prev: stored.cur }
}

export function isEpoch(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{32}$/i.test(v)
}

/** Every token this client should watch/pull this session. */
export function watchedTokens(homeToken: string, epoch: EpochState, pubKeyHex?: string): string[] {
  const tokens = [homeToken]
  if (pubKeyHex) {
    if (isEpoch(epoch.cur)) {
      try {
        tokens.push(sessionDeliveryToken(pubKeyHex, epoch.cur))
      } catch {
        tokens.push(epoch.cur)
      }
    } else if (epoch.cur) {
      tokens.push(epoch.cur)
    }
    if (isEpoch(epoch.prev)) {
      try {
        tokens.push(sessionDeliveryToken(pubKeyHex, epoch.prev))
      } catch {
        tokens.push(epoch.prev)
      }
    } else if (epoch.prev) {
      tokens.push(epoch.prev)
    }
  } else {
    if (epoch.cur) tokens.push(epoch.cur)
    if (epoch.prev) tokens.push(epoch.prev)
  }
  return tokens.filter(Boolean)
}

/** Where to address mail for a peer: their session token once we know the
 * epoch, else their home token. */
export function peerAddressToken(peer: PeerKeys & { epoch?: string }, homeTokenOf: (pub: string) => string): string {
  if (isEpoch(peer.epoch)) {
    try {
      return sessionDeliveryToken(peer.publicKeyHex, peer.epoch)
    } catch { /* fall through to home */ }
  }
  return homeTokenOf(peer.publicKeyHex)
}
