"use client";

import { projectReportsFor, type ProjectedReport } from '../services/socialInteractionProjection'
import { usePeerProjection } from './usePeerProjection'

/**
 * The reports about MY content (peer lane).
 *
 * A report about a peer-replicated post is a signed operation: it travels
 * between the peers, and nobody is the "admin" of a mesh — the author of the
 * content is the one who can act on it. This hook surfaces those reports so
 * the notification centre can show them.
 */
export function usePeerReports(selfId?: string | null): ProjectedReport[] {
  return usePeerProjection<ProjectedReport[]>(
    (entries) => (selfId ? projectReportsFor(entries, selfId) : []),
    selfId,
    [],
  )
}
