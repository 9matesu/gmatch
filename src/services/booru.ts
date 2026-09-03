import type { BooruPost } from '../game/types'
import { isQueryBlocked } from '../game/tagFilter'

export interface BooruRequest {
  tags: string
  limit: number
}

export interface BooruResponse {
  posts: BooruPost[]
  source: string | null
  ok: boolean
  offline?: boolean
}

declare global {
  interface Window {
    goongrid?: {
      booruFetch?: (req: BooruRequest) => Promise<BooruResponse>
    }
  }
}

const TIMEOUT_MS = 10_000
const CACHE_SIZE = 40

// Session dedupe + recent-url cache (SPEC §6).
const seenIds = new Set<string>()
const recentUrls: string[] = []

function remember(posts: BooruPost[]): BooruPost[] {
  const fresh: BooruPost[] = []
  for (const p of posts) {
    if (seenIds.has(p.id)) continue
    seenIds.add(p.id)
    fresh.push(p)
    recentUrls.push(p.url)
    if (recentUrls.length > CACHE_SIZE) recentUrls.shift()
  }
  return fresh
}

/** Browser-mode fallback: direct fetch (likely CORS-blocked → offline). */
async function directFetch(req: BooruRequest): Promise<BooruResponse> {
  const url = `https://safebooru.org/index.php?page=dapi&s=post&q=index&tags=${encodeURIComponent(req.tags)}&limit=${req.limit}&json=1`
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = (await res.json()) as unknown
  const list = Array.isArray(data) ? data : []
  const posts: BooruPost[] = list
    .filter((p): p is Record<string, unknown> => typeof p === 'object' && p !== null)
    .map((p) => ({
      id: String(p.id ?? ''),
      url: String(p.file_url ?? ''),
      tags: typeof p.tags === 'string' ? (p.tags as string).split(' ') : [],
      rating: typeof p.rating === 'string' ? p.rating : undefined,
    }))
    .filter((p) => p.id && p.url)
  return { posts: remember(posts), source: 'safebooru-direct', ok: true }
}

/**
 * Shared booru client. Electron → IPC bridge (main process does the HTTP).
 * Browser/dev → direct fetch. Any failure → offline:true, never throws.
 */
export async function fetchPosts(req: BooruRequest): Promise<BooruResponse> {
  const offline: BooruResponse = { posts: [], source: null, ok: false, offline: true }
  if (!req.tags.trim() || isQueryBlocked(req.tags)) return offline
  try {
    if (typeof window !== 'undefined' && window.goongrid?.booruFetch) {
      const res = await window.goongrid.booruFetch(req)
      if (res.ok && res.posts.length > 0) {
        return { ...res, posts: remember(res.posts) }
      }
      return { ...offline }
    }
    return await directFetch(req)
  } catch {
    return { ...offline }
  }
}
