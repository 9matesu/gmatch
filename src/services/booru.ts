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

// No-repeat memory: ids + file URLs seen this session AND in past sessions
// (localStorage), capped so it can't grow forever. Same file under a
// different mirror id still counts as seen via its URL.
const SEEN_KEY = 'goongrid.seen.v1'
const SEEN_CAP = 500
const seenIds = new Set<string>()
const seenUrls = new Set<string>()
let seenLoaded = false

function loadSeen(): void {
  if (seenLoaded) return
  seenLoaded = true
  try {
    if (typeof localStorage === 'undefined') return
    const raw = localStorage.getItem(SEEN_KEY)
    if (!raw) return
    const d = JSON.parse(raw) as { ids?: unknown; urls?: unknown }
    if (Array.isArray(d.ids)) for (const id of d.ids) seenIds.add(String(id))
    if (Array.isArray(d.urls)) for (const u of d.urls) seenUrls.add(String(u))
  } catch {
    /* corrupt cache — start fresh */
  }
}

function persistSeen(): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(SEEN_KEY, JSON.stringify({ ids: [...seenIds], urls: [...seenUrls] }))
  } catch {
    /* storage unavailable — memory still works for this session */
  }
}

// Unhealthy-mirror cooldown: a mirror that errors or answers HTTP-error
// sits out briefly so the feed fails over fast instead of hanging on it.
const COOLDOWN_HARD_MS = 60_000
const unhealthyUntil = new Map<string, number>()

function isHealthy(id: string): boolean {
  return (unhealthyUntil.get(id) ?? 0) <= Date.now()
}

function markUnhealthy(id: string): void {
  unhealthyUntil.set(id, Date.now() + COOLDOWN_HARD_MS)
}

/** Test hook: reset mirror health + no-repeat memory. */
export function __resetFeedState(): void {
  unhealthyUntil.clear()
  seenIds.clear()
  seenUrls.clear()
  seenLoaded = false
}

/** Filter out anything shown before (this session or past ones), memoize the rest. */
function remember(posts: BooruPost[]): BooruPost[] {
  loadSeen()
  const fresh: BooruPost[] = []
  for (const p of posts) {
    if (seenIds.has(p.id) || seenUrls.has(p.url)) continue
    seenIds.add(p.id)
    seenUrls.add(p.url)
    fresh.push(p)
  }
  // Cap the persistent sets (insertion-ordered, so oldest drops first).
  while (seenIds.size > SEEN_CAP) {
    const oldest = seenIds.values().next().value as string
    seenIds.delete(oldest)
  }
  while (seenUrls.size > SEEN_CAP) {
    const oldest = seenUrls.values().next().value as string
    seenUrls.delete(oldest)
  }
  if (fresh.length > 0) persistSeen()
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
 * Unhealthy mirrors sit out a cooldown; all-seen batches are skipped, never
 * shown twice.
 */
async function directFetch(req: BooruRequest): Promise<BooruResponse> {
  const neg =
    '-ai_generated -ai-generated -furry -anthro -feral -scalie -monochrome -greyscale -sketch -comic -lowres -worst_quality -jpeg_artifacts -watermark -censored'
  // Random result page per call — the same tag yields fresh posts, not the
  // same top-10 on every fetch.
  const pid = Math.floor(Math.random() * 5)
  const healthy = DIRECT_SOURCES.filter((s) => isHealthy(s.id))
  for (const src of healthy.length > 0 ? healthy : DIRECT_SOURCES) {
    let reachable = true
    for (const variant of queryVariants(req.tags)) {
      if (!reachable) break
      const url = `${src.proxy}/index.php?page=dapi&s=post&q=index&tags=${encodeURIComponent(
        `${variant} rating:explicit ${neg}`,
      )}&limit=${req.limit}&json=1&pid=${pid}`
      let res: Response
      try {
        res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
      } catch {
        // Network down / proxy gone: cool the mirror, stop its variants.
        markUnhealthy(src.id)
        reachable = false
        continue
      }
      if (!res.ok) {
        // HTTP error = sick mirror: cool it down, move to the next one.
        markUnhealthy(src.id)
        reachable = false
        continue
      }
      // Combo queries can come back truncated — a parse failure just means
      // "try the next variant", never offline by itself.
      let data: unknown
      try {
        data = await res.json()
      } catch {
        continue
      }
      const clean = sanitize(toPosts(data, src.origin))
      if (clean.length === 0) continue
      const fresh = remember(clean)
      if (fresh.length === 0) continue // all repeats — narrower pages may be new
      unhealthyUntil.delete(src.id)
      return { posts: fresh, source: src.id, ok: true }
    }
  }
  // paheal only answers single tags — use the leading one.
  const single = req.tags.split(/\s+/).filter(Boolean)[0]
  if (single && isHealthy('paheal-direct')) {
    try {
      const url = `/booru/paheal/api/danbooru/find_posts?tags=${encodeURIComponent(single)}&limit=${req.limit}`
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
      if (!res.ok) {
        markUnhealthy('paheal-direct')
      } else {
        const clean = sanitize(parsePaheal(await res.text()))
        const fresh = remember(clean)
        if (fresh.length > 0) {
          unhealthyUntil.delete('paheal-direct')
          return { posts: fresh, source: 'paheal-direct', ok: true }
        }
      }
    } catch {
      markUnhealthy('paheal-direct')
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
        const fresh = remember(sanitize(res.posts))
        // All repeats → report offline so the caller rotates to the next tag.
        if (fresh.length > 0) return { ...res, posts: fresh }
      }
      return { ...offline }
    }
    return await directFetch(req)
  } catch {
    return { ...offline }
  }
}
