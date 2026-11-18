import { useCallback, useState } from 'react'
import type { OrbitObject } from '@orbit/shared'
import type { OrbitIdentity } from '@orbit/crypto'
import { orbitFetch } from '../utils/api'
import { logger } from '../utils/logger'

export type ToastFn = (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void

/**
 * Batch download of the current gallery slice: one request per object, a single
 * progress flag, and a closing summary. A domain hook so App only wires the UI.
 */
export function useBatchDownload(identity: OrbitIdentity | null, toast: ToastFn) {
  const [batchDownloading, setBatchDownloading] = useState(false)

  const downloadAll = useCallback(
    async (items: OrbitObject[]) => {
      if (!items.length || !identity) return
      setBatchDownloading(true)
      toast(`Starting download of ${items.length} cards…`, 'info')
      let count = 0
      for (const item of items) {
        try {
          const res = await orbitFetch(`/api/objects/${item.id}`, {}, identity)
          if (!res.ok) continue
          const url = URL.createObjectURL(await res.blob())
          const a = document.createElement('a')
          a.href = url
          a.download = `card_${item.id.substring(0, 8)}.jpg`
          a.click()
          URL.revokeObjectURL(url)
          count++
        } catch (err) {
          logger.warn('[useBatchDownload] GET /api/objects/:id failed', err)
        }
      }
      setBatchDownloading(false)
      toast(`Downloaded ${count} cards.`, 'success')
    },
    [identity, toast],
  )

  return { batchDownloading, downloadAll }
}