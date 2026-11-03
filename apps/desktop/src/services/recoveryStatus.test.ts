// Recovery statuses are derived, never fabricated: each rule below is the
// honest reading of one evidence shape, and re-evaluation can flip any of
// them when the evidence changes (none of these is a tombstone).
import { describe, expect, it } from 'vitest'
import { deriveStatus, type RecoveryEvidence } from './recoveryStatus'

const EXPECTED = 'f'.repeat(64)

const base: RecoveryEvidence = { expectedHash: EXPECTED }

describe('deriveStatus — evidence precedence', () => {
  it('verified local bytes are cached', () => {
    expect(deriveStatus({ ...base, localBlob: { size: 10, sha256: EXPECTED } })).toEqual(
      { status: 'cached', bytes: 10 } as never,
    )
  })

  it('bytes that fail the expected hash are corrupt, not cached', () => {
    const v = deriveStatus({ ...base, localBlob: { size: 10, sha256: 'a'.repeat(64) } })
    expect(v.status).toBe('corrupt')
    expect(v.reason).toBe('hash-mismatch')
  })

  it('a hash-keyed store hit counts as verified even when the re-hash is unavailable', () => {
    const v = deriveStatus({ ...base, localBlob: { size: 5, sha256: null }, hashKeyedVaultRow: true })
    expect(v.status).toBe('cached')
  })

  it('bytes with no verification proof at all are retryable, never cached', () => {
    const v = deriveStatus({ ...base, localBlob: { size: 5, sha256: null }, hasSource: true })
    expect(v.status).toBe('retryable')
    expect(v.reason).toBe('unverified-bytes')
  })

  it('a failed previous attempt is retryable', () => {
    expect(deriveStatus({ ...base, pending: { attempts: 3 } })).toEqual(
      { status: 'retryable', reason: 'last-attempt-failed' } as never,
    )
  })

  it('a queued miss or a known source is downloadable, not missing', () => {
    expect(deriveStatus({ ...base, pending: { attempts: 0 } }).status).toBe('downloadable')
    expect(deriveStatus({ ...base, hasSource: true }).status).toBe('downloadable')
  })

  it('no evidence at all is honestly missing', () => {
    expect(deriveStatus({ ...base })).toEqual({ status: 'missing', reason: 'no-local-no-source' } as never)
  })
})
