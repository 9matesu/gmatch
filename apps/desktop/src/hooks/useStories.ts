import { useCallback, useRef, useState } from 'react'
import type { OrbitObject } from '@orbit/shared'
import type { OrbitIdentity } from '@orbit/crypto'
import { orbitFetch } from '../utils/api'
import { logger } from '../utils/logger'

const CACHE_KEY = 'orbit_cached_stories'
const CACHE_CAP = 200

/**
 * The node stamps stories with a 24h `expires_at`. The boot mirror is
 * stale-first, so an expired row must not outlive its TTL just because this
 * device cached it — drop it before it reaches the tray (the node does the
 * same filter on its own read).
 */
export function liveStories(list: OrbitObject[]): OrbitObject[] {
  const now = Date.now()
  return list.filter((s) => {
    if (!s.expires_at) return true
    const t = new Date(s.expires_at).getTime()
    return Number.isNaN(t) || t > now
  })
}

function readCache(): OrbitObject[] {
  try {
    const saved = localStorage.getItem(CACHE_KEY)
    return saved ? liveStories(JSON.parse(saved) as OrbitObject[]) : []
  } catch {
    return []
  }
}

/**
 * Stories: the tray's data. A domain hook so App composes it instead of owning
 * the state, the request generation guard and the stale-first cache mirror.
 */
export function useStories(identity: OrbitIdentity | null) {
  const [stories, setStories] = useState<OrbitObject[]>(readCache)
  const [storiesLoading, setStoriesLoading] = useState(() => {
    try {
      return !localStorage.getItem(CACHE_KEY)
    } catch {
      return true
    }
  })
  const requestRef = useRef(0)

  const loadStories = useCallback(() => {
    if (!identity) return Promise.resolve()
    const requestId = ++requestRef.current
    const requestIdentity = identity.orbitId
    setStoriesLoading(true)
    return orbitFetch('/api/objects/stories', {}, identity)
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text())
        return res.json()
      })
      .then((data: OrbitObject[]) => {
        // A slow earlier reply must never overwrite a newer one, and a reply for
        // another identity must never land in this session's tray.
        if (requestId !== requestRef.current || requestIdentity !== identity.orbitId) return
        const list = liveStories(Array.isArray(data) ? data : [])
        setStories(list)
        try {
          // Cap matches the server's own 200-row ceiling (routes/objects.ts).
          localStorage.setItem(CACHE_KEY, JSON.stringify(list.slice(0, CACHE_CAP)))
        } catch (err) {
          logger.warn('[useStories] cache write failed', err)
        }
      })
      .catch((err) => {
        logger.error(err)
      })
      .finally(() => setStoriesLoading(false))
  }, [identity])

  return { stories, setStories, storiesLoading, loadStories }
}