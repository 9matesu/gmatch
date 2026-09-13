// Idle feed booru client (SPEC §6): runs in the Electron main via IPC. The
// social feed's parallel client is apps/api/src/routes/booru.ts (server-side
// proxy) — different trust domains, intentionally not merged.
import type { BooruPost } from '../game/types'
import { isQueryBlocked, isUserExcluded } from '../game/tagFilter'
import { blockedPair, getCoRules, isFeedIntent } from '../game/tagCooccur'
import { allowOnly } from './postFilter'
import {
  REDGIFS_API,
  parseRedgifs,
  parseRedgifsToken,
  redgifsAuthUrl,
  redgifsSearchUrl,
} from './redgifs'
import {
  IMHENTAI_ROOT,
  imhentaiGalleryUrl,
  imhentaiSearchUrl,
  parseImhentaiCover,
  parseImhentaiSearch,
  parseImhentaiSearchResults,
  toImhentaiPost,
} from './imhentai'

export interface BooruRequest {
  tags: string
  limit: number
  allowReal?: boolean
  allowHentai?: boolean
}

export interface BooruResponse {
  posts: BooruPost[]
  source: string | null
  ok: boolean
  offline?: boolean
  /** True when posts came from the 10-minute feed cache, not the network. */
  cached?: boolean
}

// The preload bridge surface (window.gmatch) — including update types — is
// declared once, centrally, in src/types/gmatch-bridge.ts.

const TIMEOUT_MS = 10_000

// No-repeat memory: ids + file URLs seen this session AND in past sessions
// (localStorage), capped so it can't grow forever. Same file under a
// different mirror id still counts as seen via its URL.
const SEEN_KEY = 'gmatch.seen.v1'
// ponytail: never repeat images across gameplay; large budget prevents recycling
const SEEN_CAP = 50_000
const seenIds = new Set<string>()
const seenUrls = new Set<string>()
let seenLoaded = false

export function markSeen(id?: string, url?: string): void {
  loadSeen()
  if (id) seenIds.add(String(id))
  if (url) seenUrls.add(String(url))
  persistSeen()
}

export function isSeen(id?: string, url?: string): boolean {
  loadSeen()
  if (id && seenIds.has(String(id))) return true
  if (url && seenUrls.has(String(url))) return true
  return false
}

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

let seenTimer: ReturnType<typeof setTimeout> | null = null
// ponytail: burst of drops writes once; a crash inside the window loses at
// most one batch of seen marks (one duplicate image after a hard kill).
function persistSeen(): void {
  if (seenTimer) return
  seenTimer = setTimeout(() => {
    seenTimer = null
    writeSeen()
  }, 5_000)
}

function writeSeen(): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(SEEN_KEY, JSON.stringify({ ids: [...seenIds], urls: [...seenUrls] }))
  } catch {
    /* storage unavailable — memory still works for this session */
  }
}

/** Flush the pending seen-set immediately (page hide / app close). */
export function flushSeen(): void {
  if (!seenTimer) return
  clearTimeout(seenTimer)
  seenTimer = null
  writeSeen()
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSeen()
  })
}

// Unhealthy-mirror cooldown: a mirror that errors or answers HTTP-error
// sits out briefly so the feed fails over fast instead of hanging on it.
const COOLDOWN_HARD_MS = 60_000
const unhealthyUntil = new Map<string, number>()

function isHealthy(id: string): boolean {
  return (unhealthyUntil.get(id) ?? 0) <= Date.now()
}

function markUnhealthy(id: string, durationMs = COOLDOWN_HARD_MS): void {
  unhealthyUntil.set(id, Date.now() + durationMs)
}

/** Test hook: reset mirror health + no-repeat memory. */
export function __resetFeedState(): void {
  unhealthyUntil.clear()
  seenIds.clear()
  seenUrls.clear()
  seenLoaded = false
  if (seenTimer) {
    clearTimeout(seenTimer)
    seenTimer = null
  }
  redgifsToken = null
  redgifsTokenExp = 0
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

// Co-occurrence rules blocked by the player's current feed intent (T4).
function feedTagsSafe(tags: string[]): Set<string> {
  // A tag ON the post that is also feed intent means "I want this": stand down.
  return new Set(tags.filter(isFeedIntent))
}

function matchesQuery(post: BooruPost, query?: string): boolean {
  // Untagged posts come from tag-targeted searches (redgifs/imhentai/paheal):
  // nothing to check against, trust the search.
  if (!query || post.tags.length === 0) return true
  // Caption hunts: covers/doujins often don't have booru tags — pass through
  if (/caption/i.test(query)) return true
  const rawTokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
  if (rawTokens.length === 0) return true
  const tokens = new Set<string>()
  for (const t of rawTokens) {
    tokens.add(t)
    tokens.add(t.replace(/[\s-]+/g, '_'))
    for (const sub of t.split('_')) {
      if (sub.length > 2) tokens.add(sub)
    }
  }
  const tags = post.tags.map((t) => t.toLowerCase().replace(/[\s-]+/g, '_'))
  return Array.from(tokens).some((tok) =>
    tags.some((t) => t === tok || t.includes(tok) || tok.includes(t)),
  )
}

/**
 * Feed quality gate: explicit-only, humans only, no AI/B&W/comic/furry slop
 * (user spec). Applied to every response path. Caption hunts (query carries
 * caption/goon_caption) keep text-overlay tags — mirrors electron/main.cjs.
 */
function sanitize(posts: BooruPost[], query?: string): BooruPost[] {
  const captions = typeof query === 'string' && /caption/i.test(query)
  // Player excludes win everywhere: drop posts carrying an excluded tag on
  // both the IPC and direct paths (SPEC §8).
  return allowOnly(posts, { captions })
    .filter((p) => !p.tags.some(isUserExcluded))
    .filter((p) => !blockedPair(p.tags, getCoRules(), feedTagsSafe(p.tags)))
    .filter((p) => matchesQuery(p, query))
}

export interface DirectSourceDef {
  id: string
  origin: string
  proxy: string
  type: 'dapi' | 'moebooru' | 'realhtml' | 'booruorg'
  category: 'real' | 'hentai'
  sub?: string
}

/** Mirrors reachable through the Vite dev proxy (same-origin → no CORS). */
export const DIRECT_SOURCES: readonly DirectSourceDef[] = [
  { id: 'tbib-direct', origin: 'https://tbib.org', proxy: '/booru/tbib', type: 'dapi', category: 'hentai' },
  { id: 'xbooru-direct', origin: 'https://xbooru.com', proxy: '/booru/xbooru', type: 'dapi', category: 'hentai' },
  { id: 'konachan-direct', origin: 'https://konachan.com', proxy: '/booru/kona', type: 'moebooru', category: 'hentai' },
  { id: 'yandere-direct', origin: 'https://yande.re', proxy: '/booru/yand', type: 'moebooru', category: 'hentai' },
  { id: 'realbooru-direct', origin: 'https://realbooru.com', proxy: '/booru/real', type: 'realhtml', category: 'real' },
  { id: 'hgoon-direct', origin: 'https://hgoon.booru.org', proxy: '/booru/hgoon', type: 'booruorg', sub: 'hgoon', category: 'hentai' },
  { id: 'qoh-direct', origin: 'https://qoh.booru.org', proxy: '/booru/qoh', type: 'booruorg', sub: 'qoh', category: 'hentai' },
  { id: 'celeb-direct', origin: 'https://celeb.booru.org', proxy: '/booru/celeb', type: 'booruorg', sub: 'celeb', category: 'real' },
  { id: 'footfetish-direct', origin: 'https://footfetishbooru.booru.org', proxy: '/booru/foot', type: 'booruorg', sub: 'footfetishbooru', category: 'real' },
  { id: 'blacked-direct', origin: 'https://blacked.booru.org', proxy: '/booru/blacked', type: 'booruorg', sub: 'blacked', category: 'real' },
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

function toMoePosts(data: unknown, _origin: string): BooruPost[] {
  const list = Array.isArray(data) ? data : []
  return list
    .filter((p): p is Record<string, unknown> => typeof p === 'object' && p !== null)
    .map((p) => ({
      id: String(p.id ?? ''),
      url: typeof p.file_url === 'string' ? p.file_url : '',
      tags: typeof p.tags === 'string' ? (p.tags as string).split(/\s+/).filter(Boolean) : [],
      rating: typeof p.rating === 'string' ? p.rating : 'e',
    }))
    .filter((p) => p.id && p.url)
}

function parseRealbooruHtml(html: string): BooruPost[] {
  const posts: BooruPost[] = []
  const imgRegex =
    /<img\s+[^>]*src="https:\/\/realbooru\.com\/thumbnails\/([^/]+)\/([^/]+)\/thumbnail_([^."]+)\.jpg"[^>]*title="([^"]*)"[^>]*alt="Image:\s*(\d+)"/gi
  let m: RegExpExecArray | null
  while ((m = imgRegex.exec(html)) !== null) {
    const [, dir1, dir2, hash, rawTitle, postId] = m
    const tags = rawTitle
      .split(/,\s*/)
      .map((t) => t.trim().replace(/\s+/g, '_'))
      .filter(Boolean)
    const isVideo = tags.includes('video') || tags.includes('mp4') || tags.includes('webm')
    const isGif = tags.includes('gif')
    const ext = isVideo ? 'mp4' : isGif ? 'gif' : 'jpg'
    const url = `https://realbooru.com/images/${dir1}/${dir2}/${hash}.${ext}`
    posts.push({ id: `rb-${postId}`, url, tags, rating: 'e' })
  }
  return posts
}

function parseBooruOrgHtml(html: string): BooruPost[] {
  const posts: BooruPost[] = []
  const imgRegex =
    /<img\s+[^>]*src="https:\/\/thumbs\.booru\.org\/([^/]+)\/thumbnails\/\/([^/]+)\/thumbnail_([^."]+)\.([^"]+)"[^>]*title="([^"]*)"/gi
  let m: RegExpExecArray | null
  while ((m = imgRegex.exec(html)) !== null) {
    const [, bSub, dir, hash, ext, rawTitle] = m
    const ratingMatch = /rating:([a-z]+)/i.exec(rawTitle)
    const rating = ratingMatch ? ratingMatch[1].toLowerCase() : 'e'
    const tagsPart = rawTitle
      .replace(/score:\d+/i, '')
      .replace(/rating:[a-z]+/i, '')
      .trim()
    const tags = tagsPart.split(/\s+/).filter(Boolean)
    const url = `https://img.booru.org/${bSub}//images/${dir}/${hash}.${ext}`
    const id = `${bSub}-${hash.slice(0, 10)}`
    if (rating === 'explicit' || rating === 'e' || rating === 'questionable') {
      posts.push({ id, url, tags, rating: 'e' })
    }
  }
  return posts
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
  const allowReal = req.allowReal !== false
  const allowHentai = req.allowHentai !== false
  const neg =
    '-ai_generated -ai-generated -furry -anthro -feral -scalie -monochrome -greyscale -sketch -comic -lowres -worst_quality -jpeg_artifacts -watermark -censored'
  // Random result page per call — the same tag yields fresh posts, not the
  // same top-10 on every fetch.
  const pid = Math.floor(Math.random() * 25)
  const filteredSources = DIRECT_SOURCES.filter((s) => {
    if (s.category === 'real' && !allowReal) return false
    if (s.category === 'hentai' && !allowHentai) return false
    return true
  })
  const pool = filteredSources.length > 0 ? filteredSources : DIRECT_SOURCES
  const healthy = pool.filter((s) => isHealthy(s.id))
  for (const src of healthy.length > 0 ? healthy : pool) {
    let reachable = true
    // booru.org subdomains are tagless and dedicated to niche themes;
    // querying once avoids hammering *.booru.org with redundant requests per round.
    const variants = src.type === 'booruorg' ? [req.tags] : queryVariants(req.tags)
    for (const variant of variants) {
      if (!reachable) break
      let url: string
      let kind: 'dapi' | 'moe' | 'html' = 'dapi'
      if (src.type === 'moebooru') {
        kind = 'moe'
        const page = 1 + Math.floor(Math.random() * 5)
        const tags = src.id === 'konachan-direct' ? `${variant} rating:explicit` : variant
        url = `${src.proxy}/post.json?tags=${encodeURIComponent(tags)}&limit=${req.limit}&page=${page}`
      } else if (src.type === 'realhtml') {
        kind = 'html'
        // Preserve multi-word tags with underscores (e.g. skylar_vox),
        // don't drop the rest of the query with split(/\s+/)[0].
        const tagParam = variant.trim().replace(/\s+/g, '_')
        // Random page like electron/main.cjs — page 0 alone dedupes to empty.
        const realPid = Math.floor(Math.random() * 5)
        url = `${src.proxy}/index.php?page=post&s=list&tags=${encodeURIComponent(tagParam)}&pid=${realPid}`
      } else if (src.type === 'booruorg') {
        // booru.org Cloudflare WAF challenges `tags=` queries with 403;
        // omitting `tags=` and paginating via random `pid` bypasses WAF (200 OK).
        // Each booru.org sub is already dedicated to its niche theme.
        kind = 'html'
        const booruPid = Math.floor(Math.random() * 10) * 20
        url = `${src.proxy}/index.php?page=post&s=list&pid=${booruPid}`
      } else {
        url = `${src.proxy}/index.php?page=dapi&s=post&q=index&tags=${encodeURIComponent(
          `${variant} rating:explicit ${neg}`,
        )}&limit=${req.limit}&json=1&pid=${pid}`
      }
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
        if (res.status === 429) {
          // 429 Too Many Requests: cool down for 5 minutes.
          // booru.org subdomains share an IP rate limit; cool down all of them.
          const duration = 300_000
          markUnhealthy(src.id, duration)
          if (src.type === 'booruorg') {
            for (const s of DIRECT_SOURCES) {
              if (s.type === 'booruorg') markUnhealthy(s.id, duration)
            }
          }
        } else {
          markUnhealthy(src.id)
        }
        reachable = false
        continue
      }
      let parsed: BooruPost[]
      if (kind === 'html') {
        let html: string
        try {
          html = await res.text()
        } catch {
          continue
        }
        parsed =
          src.type === 'realhtml'
            ? parseRealbooruHtml(html).slice(0, req.limit)
            : parseBooruOrgHtml(html).slice(0, req.limit)
      } else {
        let data: unknown
        try {
          data = await res.json()
        } catch {
          continue
        }
        parsed = kind === 'moe' ? toMoePosts(data, src.origin) : toPosts(data, src.origin)
      }
      let clean: BooruPost[] = []
      if (src.type === 'booruorg') {
        // Single tagless fetch; check all variants against the page's posts in memory
        for (const v of queryVariants(req.tags)) {
          clean = sanitize(parsed, v)
          if (clean.length > 0) break
        }
      } else {
        clean = sanitize(parsed, variant)
      }
      if (clean.length === 0) continue
      const fresh = remember(clean)
      if (fresh.length === 0) continue // all repeats — narrower pages may be new
      unhealthyUntil.delete(src.id)
      return { posts: fresh, source: src.id, ok: true }
    }
  }
  // Redgifs (real/hardcore mp4s+gifs), then EPORNER, then imhentai (gallery scrape),
  // before the paheal single-tag fallback.
  if (allowReal && isHealthy('redgifs-direct')) {
    const rg = await redgifsDirect(req.tags, req.limit)
    if (rg) {
      const fresh = remember(sanitize(rg, req.tags))
      if (fresh.length > 0) {
        unhealthyUntil.delete('redgifs-direct')
        return { posts: fresh, source: 'redgifs-direct', ok: true }
      }
    } else {
      markUnhealthy('redgifs-direct')
    }
  }
  if (allowReal && isHealthy('eporner-direct')) {
    try {
      const ep = await epornerDirect(req.tags, req.limit)
      if (ep.length > 0) {
        const fresh = remember(sanitize(ep, req.tags))
        if (fresh.length > 0) {
          unhealthyUntil.delete('eporner-direct')
          return { posts: fresh, source: 'eporner-direct', ok: true }
        }
      } else {
        markUnhealthy('eporner-direct')
      }
    } catch {
      markUnhealthy('eporner-direct')
    }
  }
  if (allowHentai && isHealthy('imh-direct')) {
    try {
      const scraped = await imhentaiDirect(req.tags, req.limit)
      if (scraped.length === 0) markUnhealthy('imh-direct')
      const fresh = remember(sanitize(scraped, req.tags))
      if (fresh.length > 0) {
        unhealthyUntil.delete('imh-direct')
        return { posts: fresh, source: 'imh-direct', ok: true }
      }
    } catch {
      markUnhealthy('imh-direct')
    }
  }
  // paheal only answers single tags — use the leading one.
  const single = req.tags.split(/\s+/).filter(Boolean)[0]
  if (allowHentai && single && isHealthy('paheal-direct')) {
    try {
      const url = `/booru/paheal/api/danbooru/find_posts?tags=${encodeURIComponent(single)}&limit=${req.limit}`
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
      if (!res.ok) {
        markUnhealthy('paheal-direct')
      } else {
        const clean = sanitize(parsePaheal(await res.text()), single)
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

/** Redgifs temp token, cached in memory (same flow as electron/main.cjs). */
let redgifsToken: string | null = null
let redgifsTokenExp = 0

function toProxy(url: string, origin: string, prefix: string): string {
  return url.startsWith(origin) ? prefix + url.slice(origin.length) : url
}

/**
 * Real/hardcore porn via the Vite dev proxy: temp token → gif search.
 * Null when unusable (caller moves to the next source). Never throws.
 */
export async function redgifsDirect(query: string, limit: number, retried = false): Promise<BooruPost[] | null> {
  try {
    if (!redgifsToken || Date.now() >= redgifsTokenExp) {
      redgifsToken = null
      const authRes = await fetch(toProxy(redgifsAuthUrl(), REDGIFS_API, '/rg-auth'), {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!authRes.ok) return null
      redgifsToken = parseRedgifsToken(await authRes.json())
      if (!redgifsToken) return null
      redgifsTokenExp = Date.now() + 20 * 3600 * 1000
    }
    const page = 1 + Math.floor(Math.random() * 20)
    const url = toProxy(redgifsSearchUrl(query, limit, page), REDGIFS_API, '/rg-auth')
    const res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Authorization: `Bearer ${redgifsToken}` },
    })
    if (res.status === 401 && !retried) {
      // ponytail: temp tokens die before our 20h guess; drop cached one, retry once fresh.
      redgifsToken = null
      redgifsTokenExp = 0
      return redgifsDirect(query, limit, true)
    }
    if (!res.ok) return null
    return parseRedgifs(await res.json())
  } catch {
    return null
  }
}

/** EPORNER API for real porn images / previews */
export async function epornerDirect(query: string, limit: number): Promise<BooruPost[]> {
  try {
    const page = 1 + Math.floor(Math.random() * 5)
    const q = encodeURIComponent(query.trim().replace(/\s+/g, '+'))
    const url = `/booru/eporner/api/v2/video/search/?query=${q}&per_page=${limit}&page=${page}&thumbsize=big&format=json`
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) return []
    const data = (await res.json()) as {
      videos?: Array<{
        id: string
        keywords?: string
        default_thumb?: { src?: string }
        thumbs?: Array<{ src?: string }>
      }>
    }
    const list = Array.isArray(data.videos) ? data.videos : []
    return list
      .map((v) => {
        const thumb = v.default_thumb?.src || v.thumbs?.[0]?.src || ''
        const tags = (v.keywords || '').split(',').map((t) => t.trim().replace(/\s+/g, '_')).filter(Boolean)
        return {
          id: `ep-${v.id}`,
          url: thumb,
          tags,
          rating: 'e',
          kind: 'image' as const,
        }
      })
      .filter((p) => p.id && p.url)
  } catch {
    return []
  }
}

/**
 * imhentai via the Vite dev proxy: search page → gallery IDs → up to 3
 * covers (gallery-dl shape). Never throws.
 */
async function imhentaiDirect(query: string, limit: number): Promise<BooruPost[]> {
  try {
    const searchRes = await fetch(toProxy(imhentaiSearchUrl(query), IMHENTAI_ROOT, '/booru/imh'), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!searchRes.ok || typeof searchRes.text !== 'function') return []
    const html = await searchRes.text()

    // 1. First extract gallery covers directly from the search HTML in one pass.
    // The search page contains thumbnails; using them directly avoids secondary
    // /gallery/<id>/ requests that trigger Cloudflare 403 WAF challenges.
    const directResults = parseImhentaiSearchResults(html, Math.max(limit, 3))
    if (directResults.length > 0) {
      return directResults
        .slice(0, limit)
        .map((r) => toImhentaiPost(r.id, { url: r.coverUrl, width: 0, height: 0 }, query))
    }

    // 2. Fallback to individual gallery fetches only when direct thumbnails were absent.
    const ids = parseImhentaiSearch(html, 3)
    const posts: BooruPost[] = []
    for (const id of ids) {
      if (posts.length >= limit) break
      // Cloudflare trips on back-to-back gallery bursts — small gap per fetch.
      // ponytail: fixed 250ms sleep, backoff only if 403s persist.
      await new Promise((r) => setTimeout(r, 250))
      try {
        const gRes = await fetch(toProxy(imhentaiGalleryUrl(id), IMHENTAI_ROOT, '/booru/imh'), {
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })
        if (gRes.status === 403) {
          markUnhealthy('imh-direct')
          break
        }
        if (!gRes.ok || typeof gRes.text !== 'function') continue
        const cover = parseImhentaiCover(await gRes.text())
        if (!cover) continue
        posts.push(toImhentaiPost(id, cover, query))
      } catch {
        /* one dead gallery never kills the round */
      }
    }
    return posts
  } catch {
    return []
  }
}
/** Parse paheal's danbooru XML. Regex-based (no DOM), same as electron/main.cjs. */
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
    if (typeof window !== 'undefined' && window.gmatch?.booruFetch) {
      const res = await window.gmatch.booruFetch(req)
      if (res.ok) {
        const fresh = remember(sanitize(res.posts || [], req.tags))
        return { ...res, posts: fresh }
      }
      return { ...offline }
    }
    return await directFetch(req)
  } catch {
    return { ...offline }
  }
}
