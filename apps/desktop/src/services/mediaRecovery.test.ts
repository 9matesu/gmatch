// The recovery campaign composes the existing byte stores and statuses are
// derived from what each run proves. Idempotency is the load-bearing rule:
// a re-run registers nothing twice, re-enqueues nothing, and never invents
// a status out of nothing at all.
import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  scanMediaRecovery,
  countByStatus,
  _resetRecoveryScanGuards,
  type MediaRecoveryDeps,
  type RecoveryTarget,
} from './mediaRecovery'

function sha(): string {
  const hex = '0123456789abcdef'
  let out = ''
  for (let i = 0; i < 64; i++) out += hex[(i * 7 + 3) % 16]
  return out
}

function noopDeps(): MediaRecoveryDeps & { store: Array<{ id: string; hash: string | null; attempts: number; addedAt: number }> } {
  // One shared pending bookkeeping across the fixture, like production
  // (enqueuePendingTransfer writes what listPendingTransfers reads).
  const store: Array<{ id: string; hash: string | null; attempts: number; addedAt: number }> = []
  return {
    store,
    blobAt: vi.fn(async () => null as Blob | null),
    hashOf: vi.fn(async () => sha()),
    vaultRow: vi.fn(async () => null as null),
    alias: vi.fn(),
    listPending: vi.fn(() => [...store]),
    enqueue: vi.fn((id: string, hash: string | null) => { store.push({ id, hash, attempts: 0, addedAt: Date.now() }) }),
    announceHeld: vi.fn(() => 0),
  }
}

beforeEach(() => {
  _resetRecoveryScanGuards()
})

describe('scanMediaRecovery — local match by hash', () => {
  it('a verified hash-keyed register hit is cached and aliased under the id', async () => {
    const d = noopDeps()
    const blob = new Blob(['held bytes'])
    ;(d.blobAt as ReturnType<typeof vi.fn>).mockImplementation(async (key: string) => (key === sha() ? blob : null))
    ;(d.hashOf as ReturnType<typeof vi.fn>).mockResolvedValue(sha())

    const run = await scanMediaRecovery([{ id: 'obj-1', contentHash: sha(), mime: 'image/png' }], { force: true, deps: d })

    expect(countByStatus(run.entries)).toMatchObject({ cached: 1 })
    expect(run.recovered).toBe(1)
    // Both identities now point at the same verified bytes.
    expect(d.alias).toHaveBeenCalledWith('obj-1', blob)
    expect(d.alias).toHaveBeenCalledWith(sha(), blob)
    // Recovering bytes for the HAVE wave: the existing announce path.
    expect(d.announceHeld).toHaveBeenCalledTimes(1)
  })

  it('bytes that fail the expected hash are corrupt — nothing is aliased, nothing announced', async () => {
    const d = noopDeps()
    const blob = new Blob(['tampered'])
    ;(d.blobAt as ReturnType<typeof vi.fn>).mockResolvedValue(blob)
    ;(d.hashOf as ReturnType<typeof vi.fn>).mockResolvedValue('a'.repeat(64))

    const run = await scanMediaRecovery([{ id: 'obj-2', contentHash: sha() }], { force: true, deps: d })

    expect(run.entries[0]).toMatchObject({ status: 'corrupt', reason: 'hash-mismatch' })
    expect(d.alias).not.toHaveBeenCalled()
    expect(d.announceHeld).not.toHaveBeenCalled()
  })

  it('a content-hash-keyed vault row is cached without a renderer-side fetch', async () => {
    const d = noopDeps()
    ;(d.vaultRow as ReturnType<typeof vi.fn>).mockResolvedValue({ state: 'local', local: 'vault://f/abc' })

    const run = await scanMediaRecovery([{ id: 'obj-3', contentHash: sha() }], { force: true, deps: d })

    expect(d.vaultRow).toHaveBeenCalledWith(sha())
    expect(run.entries[0]).toMatchObject({ status: 'cached' })
    expect(d.blobAt).toHaveBeenCalledWith(sha())
    expect(d.enqueue).not.toHaveBeenCalled()
  })
})

describe('scanMediaRecovery — misses compose the existing resume machinery', () => {
  it('a fresh miss is downloadable and enqueued once', async () => {
    const d = noopDeps()
    const run = await scanMediaRecovery([{ id: 'obj-4', contentHash: sha() }], { force: true, deps: d })
    expect(run.entries[0]).toMatchObject({ status: 'downloadable' })
    expect(d.enqueue).toHaveBeenCalledWith('obj-4', sha())
  })

  it('a miss already queued re-derives from attempts: failed → retryable, no second enqueue', async () => {
    const d = noopDeps()
    ;(d.listPending as ReturnType<typeof vi.fn>).mockReturnValue([{ id: 'obj-5', hash: sha(), attempts: 2, addedAt: 1 }])
    const run = await scanMediaRecovery([{ id: 'obj-5', contentHash: sha() }], { force: true, deps: d })
    expect(run.entries[0]).toMatchObject({ status: 'retryable' })
    expect(d.enqueue).not.toHaveBeenCalled()
  })

  it('a re-run of the same targets is idempotent', async () => {
    const d = noopDeps()
    const targets: RecoveryTarget[] = [{ id: 'obj-6', contentHash: sha() }]
    const first = await scanMediaRecovery(targets, { force: true, deps: d })
    const second = await scanMediaRecovery(targets, { force: true, deps: d })
    expect(second.entries[0].status).toBe(first.entries[0].status)
    expect(d.enqueue).toHaveBeenCalledTimes(1) // idempotent enqueue, no duplicates
  })
})

describe('scanMediaRecovery — bounds', () => {
  it('is throttled between runs unless forced', async () => {
    const d = noopDeps()
    const targets = (n: number): RecoveryTarget[] => Array.from({ length: n }, (_, i) => ({ id: `obj-t${i}`, contentHash: null }))
    const first = await scanMediaRecovery(targets(3), { deps: d })
    expect(first.skipped).toBeUndefined()
    const second = await scanMediaRecovery(targets(3), { deps: d })
    expect(second.skipped).toBe('throttled')
    expect(second.entries).toHaveLength(0)
  })

  it('caps each run at the batch bound', async () => {
    const d = noopDeps()
    const targets = Array.from({ length: 30 }, (_, i) => ({ id: `obj-b${i}`, contentHash: null }))
    const run = await scanMediaRecovery(targets, { force: true, deps: d })
    expect(run.entries).toHaveLength(8)
  })

  it('refuses descriptors and blatantly invalid ids', async () => {
    const d = noopDeps()
    const run = await scanMediaRecovery(
      [{ id: 'magnet:?xt=urn:btih:abc', contentHash: null }, { id: '', contentHash: null }],
      { force: true, deps: d },
    )
    expect(run.entries).toHaveLength(0)
    expect(d.blobAt).not.toHaveBeenCalled()
  })

  it('an empty target list short-circuits without touching a store', async () => {
    const d = noopDeps()
    const run = await scanMediaRecovery([], { force: true, deps: d })
    expect(run.entries).toHaveLength(0)
    expect(d.blobAt).not.toHaveBeenCalled()
    // The empty run also must not consume the throttle window.
    const next = await scanMediaRecovery([{ id: 'obj-after', contentHash: null }], { deps: d })
    expect(next.skipped).toBeUndefined()
  })
})
