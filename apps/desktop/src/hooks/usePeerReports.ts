"use client";

import { useEffect, useState } from 'react'
import {
  OPERATION_LOG_CHANGED_EVENT,
  sharedSocialOperationLog,
  type LoggedOperation,
} from '../services/socialOperationLog'
import { projectReportsFor, type ProjectedReport } from '../services/socialInteractionProjection'
import { PEER_ONLINE_EVENT } from '../utils/p2pSwarm'

/**
 * The reports about MY content (peer lane).
 *
 * A report about a peer-replicated post is a signed operation: it travels
 * between the peers, and nobody is the "admin" of a mesh — the author of the
 * content is the one who can act on it. This hook surfaces those reports so
 * the notification centre can show them.
 */
export function usePeerReports(selfId?: string | null): ProjectedReport[] {
  const [reports, setReports] = useState<ProjectedReport[]>([])
  useEffect(() => {
    if (!selfId) {
      setReports([])
      return
    }
    let alive = true
    const refresh = () => {
      void sharedSocialOperationLog()
        .listAllOperations()
        .then((entries: LoggedOperation[]) => {
          if (alive) setReports(projectReportsFor(entries, selfId))
        })
        .catch(() => { /* IndexedDB unavailable: no peer reports */ })
    }
    refresh()
    window.addEventListener(OPERATION_LOG_CHANGED_EVENT, refresh)
    window.addEventListener(PEER_ONLINE_EVENT, refresh)
    return () => {
      alive = false
      window.removeEventListener(OPERATION_LOG_CHANGED_EVENT, refresh)
      window.removeEventListener(PEER_ONLINE_EVENT, refresh)
    }
  }, [selfId])
  return reports
}
