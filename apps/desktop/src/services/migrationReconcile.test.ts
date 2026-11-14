// @vitest-environment jsdom
// Stage D: a watermark cursor that only moves forward over deduped,
// bounded, timestamp-ordered slices. Stage E: one honest class per object
// where metadata migration is NEVER counted as media migration.
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * localStorage is stubbed (the repo convention — jsdom runs with an opaque
 * origin here, so there is no real one).
 */
function stubLocalStorage(): Map<string, string> {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  })
  return store
}

import {
  classifyStageE,
  nextReconcileBatch,
  saveWatermark,
  readWatermark,
  buildStageE,
  type ManifestTarget,
} from './migrationReconcile'
import type { RecoveryEntry } from './recoveryStatus'

beforeEach(() => {
  stubLocalStorage()
})

const t = (id: string, createdAt: number, contentHash: string | null = null): ManifestTarget =>
  ({ id, createdAt, contentHash })

describe('Stage D — watermark cursor', () => {
  it('starts at 0 and never rewinds', () => {
    stubLocalStorage()
    expect(readWatermark()).toBe(0)
    saveWatermark(1000)
    expect(readWatermark()).toBe(1000)
    saveWatermark(500)
    expect(readWatermark()).toBe(1000)
  })

  it('takes only targets newer than the cursor, oldest first, bounded', () => {
    const targets = [
      t('old', 100), t('new-b', 300), t('newer', 400), t('new-a', 200), t('same-time', 200),
    ]
    const { batch, newCursor } = nextReconcileBatch(targets, { cursor: 100, limit: 3 })
    expect(batch.map((x) => x.id)).toEqual(['new-a', 'same-time', 'new-b'])
    expect(newCursor).toBe(300)
  })

  it('dedupes by objectId — one repeated post is one row, its newest metadata', () => {
    const targets = [
      t('dup', 200, 'h-old'),
      t('dup', 260, 'h-new'),
      t('other', 250),
    ]
    const { batch } = nextReconcileBatch(targets, { cursor: 0, limit: 10 })
    expect(batch).toHaveLength(2)
    expect(batch.find((x) => x.id === 'dup')?.contentHash).toBe('h-new')
  })

  it('an empty batch leaves the cursor unchanged', () => {
    const { batch, newCursor } = nextReconcileBatch([t('a', 50)], { cursor: 100 })
    expect(batch).toHaveLength(0)
    expect(newCursor).toBe(100)
  })
})

describe('Stage E — one honest class per object', () => {
  const entry = (status: RecoveryEntry['status'], id = 'obj-1'): RecoveryEntry =>
    ({ objectId: id, contentHash: 'h'.repeat(64), mime: 'image/png', status })

  it('cached + at-target custody is recovered+replicated', () => {
    expect(classifyStageE(entry('cached'), () => 3)).toBe('recovered+replicated')
    expect(classifyStageE(entry('cached'), () => 4)).toBe('recovered+replicated')
  })

  it('cached but under the target stays honestly under-replicated', () => {
    // The seeder alone is one proven holder — 1 and 2 are both under 3.
    expect(classifyStageE(entry('cached'), () => 1)).toBe('recovered (under-replicated)')
    expect(classifyStageE(entry('cached'), () => 2)).toBe('recovered (under-replicated)')
  })

  it('any non-byte status is metadata only — even with receipts flying elsewhere', () => {
    expect(classifyStageE(entry('missing'), () => 5)).toBe('metadata only')
    expect(classifyStageE(entry('downloadable'), () => 2)).toBe('metadata only')
    expect(classifyStageE(entry('retryable'), () => 0)).toBe('metadata only')
  })

  it('corrupt stays corrupt regardless of custody', () => {
    expect(classifyStageE(entry('corrupt'), () => 9)).toBe('corrupt')
  })

  it('the report totals are the validation artifact itself', () => {
    const report = buildStageE(
      [entry('cached', 'a'), entry('cached', 'b'), entry('missing', 'c'), entry('corrupt', 'd'), entry('downloadable', 'e')],
      (id) => (id === 'a' ? 3 : 1),
    )
    expect(report.counts).toEqual({
      'recovered+replicated': 1,
      'recovered (under-replicated)': 1,
      'metadata only': 2,
      corrupt: 1,
    })
    expect(report.rows).toHaveLength(5)
    expect(report.rows.find((r) => r.objectId === 'c')).toMatchObject({ class: 'metadata only', status: 'missing' })
  })
})
