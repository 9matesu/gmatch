import { useState, useEffect, useCallback } from 'react'
import type { User, Relationship, LikeDecision, OrbitObject } from '@orbit/shared'
import { orbitFetch } from '../utils/api'
import { dedupeQueue, dismissFromQueue, isConfirmedDecision, mergeLocalDecisions, pruneDecisionMap, recordDecision } from '../utils/game'
import { logger } from '../utils/logger';

const DECISION_STORAGE_KEY = 'goonmatch-decisions'
const DECISION_MAP_CAP = 200

interface OrbitIdentity {
  orbitId: string
  publicKeyHex: string
  privateKeyHex: string
  encryptionPubHex?: string
}

export interface DecisionItem extends OrbitObject {
  owner_name?: string
  tags?: string[]
}

export function useGame({
  identity,
}: {
  users: User[]
  identity: OrbitIdentity | null
}) {
  const [relationships, setRelationships] = useState<Relationship[]>([])
  const [stats, setStats] = useState<{
    likes_given: number
    likes_received: number
    matches_total: number
    score: number
  }>({
    likes_given: 0,
    likes_received: 0,
    matches_total: 0,
    score: 0,
  })
  const [loading, setLoading] = useState(false)
  const [spinTarget, setSpinTarget] = useState<User | null>(null)
  const [respondTarget, setRespondTarget] = useState<string | null>(null)
  const [pendingDecisions, setPendingDecisions] = useState<DecisionItem[]>([])
  const [isDeciding, setIsDeciding] = useState(false)

  // Load decisionMap from localStorage (capped so it cannot grow unbounded, F-U8)
  const [decisionMap, setDecisionMap] = useState<Record<string, LikeDecision>>(() => {
    if (typeof window === 'undefined') return {}
    try {
      const stored = localStorage.getItem(DECISION_STORAGE_KEY)
      return stored ? pruneDecisionMap(JSON.parse(stored), DECISION_MAP_CAP) : {}
    } catch {
      return {}
    }
  })

  // Cross-tab sync: another tab's confirmed decisions are merged into this
  // tab's map so both tabs agree on what was already decided. (F-C1)
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key !== DECISION_STORAGE_KEY || e.newValue === null) return
      try {
        const incoming: Record<string, LikeDecision> = JSON.parse(e.newValue)
        setDecisionMap(prev => mergeLocalDecisions(prev, incoming))
      } catch {}
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  // Save decisionMap to localStorage
  // (decisions are persisted in `decide` only when server-confirmed, see T-U2)

  // Fetch relationships and stats from server
  const fetchRelationships = useCallback(async () => {
    if (!identity) return
    setLoading(true)
    try {
      const res = await orbitFetch('/api/relationships', { method: 'GET' }, identity)
      if (res.ok) {
        const data = await res.json()
        setRelationships(data.relationships || [])
        if (data.stats) {
          setStats(data.stats)
        }
      }
    } catch (err) {
      logger.warn('[useGame] Failed to fetch relationships:', err)
    } finally {
      setLoading(false)
    }
  }, [identity])

  useEffect(() => {
    fetchRelationships()
    const handleRefresh = () => fetchRelationships()
    window.addEventListener('orbit-relationships-refresh', handleRefresh)
    return () => window.removeEventListener('orbit-relationships-refresh', handleRefresh)
  }, [fetchRelationships])

  // Enqueue an incoming item for decision popup
  const enqueueDecision = useCallback((item: DecisionItem) => {
    if (!item || !item.id) return
    setPendingDecisions(prev => dedupeQueue(prev, item))
  }, [])

  // Dismiss current decision item from queue without API call
  const dismissDecision = useCallback((objectId?: string) => {
    setPendingDecisions(prev => dismissFromQueue(prev, objectId))
  }, [])

  // Submit decision to API
  const decide = useCallback(
    async (objectId: string, decision: LikeDecision) => {
      if (!identity || isDeciding) return null
      setIsDeciding(true)

      let result: { decision?: string; matched?: boolean; matches?: number; unavailable?: boolean } | null = null
      try {
        // p2p-local cards have no server row — the API would only 404.
        // Treat as unavailable without making a doomed network request.
        if (typeof objectId === 'string' && objectId.startsWith('p2p-obj-')) {
          return { unavailable: true }
        }

        const res = await orbitFetch(
          `/api/likes/${objectId}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ decision }),
          },
          identity
        )

        if (!res.ok && (res.status === 404 || res.status === 403 || res.status === 400)) {
          // The server can't record this decision: object row is gone (deleted or p2p-local),
          // access denied, or it's our own image. Treat as unavailable, not an outage.
          return { unavailable: true }
        }

        if (res.ok) {
          result = await res.json()
          // Only persist locally when the server actually confirmed the decision (T-U2).
          // Offline/fallback echoes `decision: ''`, which is NOT a confirmation.
          if (isConfirmedDecision(result?.decision)) {
            setDecisionMap(prev => {
              const next = pruneDecisionMap(recordDecision(prev, objectId, decision, result), DECISION_MAP_CAP)
              try {
                localStorage.setItem(DECISION_STORAGE_KEY, JSON.stringify(next))
              } catch {}
              return next
            })
            fetchRelationships()
            dismissDecision(objectId)
          } else {
            // Fallback/mock or malformed response — treat as failure so the item can be retried
            result = null
          }
        }
      } catch (err) {
        logger.warn('[useGame] Decision submission failed:', err)
        // Leave the item in the queue so it can be retried on the next popup pass
      } finally {
        setIsDeciding(false)
      }
      return result
    },
    [identity, isDeciding, fetchRelationships, dismissDecision]
  )

  // Target a user for response
  const respondTo = useCallback((ownerId: string) => {
    setRespondTarget(ownerId)
    window.dispatchEvent(new CustomEvent('orbit-respond-open', { detail: { ownerId } }))
  }, [])

  return {
    relationships,
    stats,
    loading,
    spinTarget,
    respondTarget,
    pendingDecisions,
    decisionMap,
    isDeciding,
    enqueueDecision,
    dismissDecision,
    decide,
    respondTo,
    refresh: fetchRelationships,
    setSpinTarget,
    setRespondTarget,
  }
}
