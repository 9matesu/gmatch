import type { BooruPost } from '../game/types'
import { isQueryBlocked } from '../game/tagFilter'
import { allowOnly } from './postFilter'

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

/**
 * Feed quality gate: explicit-only, humans only, no AI/B&W/comic/furry slop
 * (user spec). Applied to every response path.
 */
function sanitize(posts: BooruPost[]): BooruPost[] {
  return allowOnly(posts)
}

/** Mirrors reachable through the Vite dev proxy (same-origin → no CORS). */
const DIRECT_SOURCES = [
  { id: 'tbib-direct', origin: 'https://tbib.org', proxy: '/booru/tbib' },
  { id: 'xbooru-direct', origin: 'https://xbooru.com', proxy: '/booru/xbooru' },
] as const

function toPosts(
  data: unknown,
  origin: string,
): BooruPost[] {
  const list = Array.isArray(data) ? data : []
  return list
    .filter((p): p is Record<string, unknown> => typeof p === 'object' && p !== null)
    .map((p) => {
      const dir = p.directory
      const img = p.image
      const fileUrl = typeof p.file_url === 'string' ? p.file_url : ''
      // tbib omits file_url — construct it like electron/main.cjs does.
      const url =
        fileUrl ||
        (typeof dir !== 'undefined' && typeof img === 'string'
          ? `${origin}/images/${dir}/${img}`
          : '')
      return {
        id: String(p.id ?? ''),
        url,
        tags: typeof p.tags === 'string' ? (p.tags as string).split(' ') : [],
        rating: typeof p.rating === 'string' ? p.rating : undefined,
      }
    })
    .filter((p) => p.id && p.url)
}

/**
 * Browser-mode fetch. Hits the booru DAPIs through the Vite dev proxy
 * (same-origin, so no CORS block). Outside `vite dev` the proxy doesn't
 * exist → fetch throws → caller reports offline. Tries tbib, then xbooru.
 */
async function directFetch(req: BooruRequest): Promise<BooruResponse> {
  const neg =
    '-ai_generated -ai-generated -furry -anthro -feral -scalie -monochrome -greyscale -sketch -comic -lowres -worst_quality -jpeg_artifacts -watermark -censored'
  const tags = `${req.tags} rating:explicit ${neg}`
  for (const src of DIRECT_SOURCES) {
    const url = `${src.proxy}/index.php?page=dapi&s=post&q=index&tags=${encodeURIComponent(
      tags,
    )}&limit=${req.limit}&json=1`
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) continue
    const clean = sanitize(toPosts(await res.json(), src.origin))
    if (clean.length > 0) return { posts: remember(clean), source: src.id, ok: true }
  }
  throw new Error('no direct source returned usable posts')
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
        const clean = sanitize(res.posts)
        if (clean.length > 0) return { ...res, posts: remember(clean) }
      }
      return { ...offline }
    }
    return await directFetch(req)
  } catch {
    return { ...offline }
  }
}
