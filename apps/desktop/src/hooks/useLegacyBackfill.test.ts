// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useLegacyBackfill } from './useLegacyBackfill'
import { generateIdentity, type OrbitIdentity } from '@orbit/crypto'
import * as legacyService from '../services/legacyBackfill'

describe('useLegacyBackfill', () => {
  const identity = generateIdentity() as OrbitIdentity

  function stubLocalStorage() {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() { return store.size },
    } as Storage)
  }

  beforeEach(() => {
    stubLocalStorage()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('triggers backfill automatically and notifies on completion', async () => {
    vi.spyOn(legacyService, 'isLegacyBackfillCompleted').mockReturnValue(false)
    const runSpy = vi.spyOn(legacyService, 'runLegacyBackfill').mockImplementation(async (_id, onProgress) => {
      onProgress?.({
        phase: 'downloading',
        total: 5,
        current: 3,
        migratedCount: 3,
        message: 'Preserving...',
      })
      onProgress?.({
        phase: 'completed',
        total: 5,
        current: 5,
        migratedCount: 5,
        message: 'Done',
      })
      return { migratedCount: 5 }
    })

    const toasts: string[] = []
    let completed = false

    const { result } = renderHook(() =>
      useLegacyBackfill(
        identity,
        (msg) => toasts.push(msg),
        () => { completed = true },
      )
    )

    await act(async () => {
      await result.current.triggerSync(true)
    })

    expect(runSpy).toHaveBeenCalled()
    expect(toasts.some((t) => t.includes('Preserved 5 legacy posts'))).toBe(true)
    expect(completed).toBe(true)
    expect(result.current.progress.phase).toBe('completed')
    expect(result.current.isSyncing).toBe(false)
  })
})
