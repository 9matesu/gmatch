"use client";

/**
 * Recovery statuses derived ONLY from evidence a caller supplies. Nothing in
 * this module touches the network, guesses, or stores anything: the status is
 * a reading of what the scan proved right now, so re-evaluation (per scan,
 * per peer-online wave) can legitimately flip a status in either direction —
 * a `missing` today is never a tombstone.
 *
 * Precedence (first match wins): corrupt > cached > retryable > downloadable
 * > missing.
 */

export type RecoveryStatus =
  | 'cached'       /** verified bytes on this device (read-back/hash proof) */
  | 'downloadable' /** no local bytes; a live fetch source exists to ask */
  | 'retryable'    /** a fetch attempt already failed (kept pending) */
  | 'missing'      /** no local bytes AND no evidence of any source */
  | 'corrupt'      /** bytes exist but failed content verification */

export interface RecoveryEntry {
  objectId: string
  /** sha256 the bytes must match; the campaign matches by hash only. */
  contentHash: string | null
  mime: string
  status: RecoveryStatus
  /** Human-honest explanation for statuses that are not `cached`. */
  reason?: string
  /** Byte size when bytes are in hand. */
  bytes?: number
}

/** Evidence shape a scan may have for one object, in derivation order. */
export interface RecoveryEvidence {
  /** A blob was found in a local store and hashed. */
  localBlob?: { size: number; sha256: string | null } | null
  /** Content-hash-KEYED vault row (the key IS the verified identity). */
  hashKeyedVaultRow?: boolean
  /** Pending-transfer bookkeeping for this id. */
  pending?: { attempts: number } | null
  /** A live fetch source is known to exist (registered/published). */
  hasSource?: boolean
  /** sha256 these bytes SHOULD carry. */
  expectedHash: string | null
}

export function deriveStatus(ev: RecoveryEvidence): { status: RecoveryStatus; reason?: string; bytes?: number } {
  if (ev.localBlob) {
    const { size, sha256 } = ev.localBlob
    if (ev.expectedHash && sha256 && ev.expectedHash.toLowerCase() !== sha256.toLowerCase()) {
      return { status: 'corrupt', reason: 'hash-mismatch', bytes: size }
    }
    // A hash-keyed vault row was hashed at pin time by the streaming vault;
    // a local blob is verified right here. Unverifiable bytes (no sha256 and
    // no verified key) are honestly kept out of 'cached'.
    if (sha256 === ev.expectedHash || ev.hashKeyedVaultRow) {
      return { status: 'cached', bytes: size }
    }
    return { status: 'retryable', reason: 'unverified-bytes', bytes: size }
  }
  if (ev.pending && ev.pending.attempts > 0) {
    return { status: 'retryable', reason: 'last-attempt-failed' }
  }
  if (ev.pending || ev.hasSource) {
    return { status: 'downloadable', reason: 'source-known' }
  }
  return { status: 'missing', reason: 'no-local-no-source' }
}
