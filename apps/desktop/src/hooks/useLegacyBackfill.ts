import { useState, useEffect, useRef, useCallback } from 'react'
import type { OrbitIdentity } from '@orbit/crypto'
import {
  runLegacyBackfill,
  isLegacyBackfillCompleted,
  resetLegacyBackfillState,
  type LegacyBackfillProgress,
} from '../services/legacyBackfill'

type Toast = (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void

export interface UseLegacyBackfillReturn {
  progress: LegacyBackfillProgress
  isSyncing: boolean
  triggerSync: (force?: boolean) => Promise<void>
}

const INITIAL_PROGRESS: LegacyBackfillProgress = {
  phase: 'idle',
  total: 0,
  current: 0,
  migratedCount: 0,
  message: '',
}

export function useLegacyBackfill(
  identity: OrbitIdentity | null,
  toast?: Toast,
  onComplete?: () => void,
  fetchImpl?: typeof globalThis.fetch,
): UseLegacyBackfillReturn {
  const [progress, setProgress] = useState<LegacyBackfillProgress>(INITIAL_PROGRESS)
  const [isSyncing, setIsSyncing] = useState(false)
  const isRunningRef = useRef(false)

  const triggerSync = useCallback(
    async (force = false) => {
      if (!identity || isRunningRef.current) return
      if (!force && isLegacyBackfillCompleted()) return

      if (force) {
        resetLegacyBackfillState()
      }

      isRunningRef.current = true
      setIsSyncing(true)

      try {
        const result = await runLegacyBackfill(
          identity,
          (p) => setProgress(p),
          fetchImpl,
        )

        if (result.migratedCount > 0) {
          toast?.(`Preserved ${result.migratedCount} legacy posts and media files locally`, 'success')
          onComplete?.()
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        setProgress({
          phase: 'error',
          total: 0,
          current: 0,
          migratedCount: 0,
          message: `Legacy backfill error: ${msg}`,
        })
      } finally {
        isRunningRef.current = false
        setIsSyncing(false)
      }
    },
    [identity, toast, onComplete, fetchImpl],
  )

  useEffect(() => {
    if (!identity || isLegacyBackfillCompleted() || isRunningRef.current) return
    // Auto-run once identity is ready
    const timer = setTimeout(() => {
      void triggerSync(false)
    }, 1500)
    return () => clearTimeout(timer)
  }, [identity, triggerSync])

  return {
    progress,
    isSyncing,
    triggerSync,
  }
}
