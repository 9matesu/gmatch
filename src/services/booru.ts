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

/**
 * Combo queries (4-5 tags) get truncated by the mirrors — full query first,
 * then top-2 tags, then the single leading tag. Mirrors electron/main.cjs.
 */
export function queryVariants(query: string): string[] {
  const parts = query.split(/\s+/).filter(Boolean)
  const variants = [query]
  if (parts.length > 2) variants.push(parts.slice(0, 2).join(' '))
  if (parts.length > 1) variants.push(parts[0])
  return [...new Set(variants)]
}

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
 * exist → fetch throws → caller reports offline. Tries tbib, then xbooru,
 * then paheal (single tag), each with the full→top2→single variant ladder.
 */
async function directFetch(req: BooruRequest): Promise<BooruResponse> {
  const neg =
    '-ai_generated -ai-generated -furry -anthro -feral -scalie -monochrome -greyscale -sketch -comic -lowres -worst_quality -jpeg_artifacts -watermark -censored'
  for (const src of DIRECT_SOURCES) {
    for (const variant of queryVariants(req.tags)) {
      const url = `${src.proxy}/index.php?page=dapi&s=post&q=index&tags=${encodeURIComponent(
        `${variant} rating:explicit ${neg}`,
      )}&limit=${req.limit}&json=1`
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
        if (!res.ok) continue
        // Combo queries can come back truncated — a parse failure just
        // means "try the next variant", never offline by itself.
        const clean = sanitize(toPosts(await res.json(), src.origin))
        if (clean.length > 0) return { posts: remember(clean), source: src.id, ok: true }
      } catch {
        continue
      }
    }
  }
  // paheal only answers single tags — use the leading one.
  const single = req.tags.split(/\s+/).filter(Boolean)[0]
  if (single) {
    try {
      const url = `/booru/paheal/api/danbooru/find_posts?tags=${encodeURIComponent(single)}&limit=${req.limit}`
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
      if (res.ok) {
        const clean = sanitize(parsePaheal(await res.text()))
        if (clean.length > 0)
          return { posts: remember(clean), source: 'paheal-direct', ok: true }
      }
    } catch {
      // fall through to offline
    }
  }
  throw new Error('no direct source returned usable posts')
}

/** Parse paheal's danbooru XML (`<tag id file_url width height tags …/>`). Regex-based (no DOM), same as electron/main.cjs. */
function parsePaheal(xml: string): BooruPost[] {
  const out: BooruPost[] = []
  const elRe = /<tag\b([^>]*)>/g
  const attr = (attrs: string, name: string): string => {
    const m = new RegExp(`${name}="([^"]*)"`, 'i').exec(attrs)
    return m ? m[1] : ''
  }
  let m: RegExpExecArray | null
  while ((m = elRe.exec(xml))) {
    const url = attr(m[1], 'file_url')
    const id = attr(m[1], 'id') || url
    if (!id || !url) continue
    out.push({
      id,
      url,
      tags: attr(m[1], 'tags') ? attr(m[1], 'tags').split(/\s+/).filter(Boolean) : [],
      rating: 'e',
    })
  }
  return out
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
