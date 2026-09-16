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
  parseRedgifsNiches,
  parseRedgifsToken,
  pickRedgifsNiche,
  redgifsAuthUrl,
  redgifsNicheGifsUrl,
  redgifsNicheSearchUrl,
  redgifsQueryTags,
  redgifsSearchUrl,
  type RedgifsNiche,
} from './redgifs'
import {
  IMHENTAI_ROOT,
  imhentaiGalleryUrl,
  imhentaiSearchUrl,
  parseImhentaiGalleryPages,
  parseImhentaiSearch,
  parseImhentaiSearchResults,
  toImhentaiPagePosts,
  toImhentaiPost,
} from './imhentai'
import {
  BABESOURCE_ROOT,
  babesourceSearchUrl,
  babesourceSlug,
  parseBabesourceGallery,
  parseBabesourceMaxPage,
  parseBabesourceSearch,
  parseBabesourceTags,
  toBabesourcePosts,
} from './babesource'

export interface BooruRequest {
  tags: string
  limit: number
  allowReal?: boolean
  allowHentai?: boolean
  page?: number
  probe?: boolean
}

export interface BooruResponse {
  posts: BooruPost[]
  source: string | null
  ok: boolean
  offline?: boolean
  /** True when sources answered but every post was already seen (not a network failure). */
  emptyFresh?: boolean
  /** True when posts came from the 10-minute feed cache, not the network. */
  cached?: boolean
}

// The preload bridge surface (window.gmatch) — including update types — is
// declared once, centrally, in src/types/gmatch-bridge.ts.

const TIMEOUT_MS = 3_500

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
    // Rebuild the reshow ledger from persisted order (ids/urls memoized in
    // lockstep, so index pairing holds; worst case a mismatched pair still
    // points at a real seen image).
    if (Array.isArray(d.ids) && Array.isArray(d.urls)) {
      const n = Math.min(d.ids.length, d.urls.length, SEEN_CAP)
      for (let i = 0; i < n; i++) {
        seenLedger.push({ id: String(d.ids[i]), url: String(d.urls[i]) })
      }
    }
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
  // Never extend an active cooldown: rapid manual retries must not
  // perpetually push the outage further out.
  if ((unhealthyUntil.get(id) ?? 0) > Date.now()) return
  unhealthyUntil.set(id, Date.now() + durationMs)
}

/** Manual retry: lift mirror cooldowns without wiping no-repeat memory. */
export function clearMirrorCooldowns(): void {
  unhealthyUntil.clear()
}

/** Test hook: reset mirror health + no-repeat memory. */
export function __resetFeedState(): void {
  unhealthyUntil.clear()
  seenIds.clear()
  seenUrls.clear()
  seenLedger.length = 0
  reshowCursor = 0
  emptyStreak = 0
  seenLoaded = false
  if (seenTimer) {
    clearTimeout(seenTimer)
    seenTimer = null
  }
  redgifsToken = null
  redgifsTokenExp = 0
  redgifsNicheCache.clear()
  lastMultiKey = ''
}

// Insertion-ordered ledger of everything memoized, backing least-recent
// reshow when the pool is truly exhausted (non-stop feed, last resort).
// Entries carry the retrieval query so recall prefers same-tag history;
// pre-tag entries (persisted) recall as untagged.
const seenLedger: Array<{ id: string; url: string; tag?: string }> = []
// Consecutive all-seen rounds (reset by any fresh hit). Reshow kicks in
// only after the pool proves exhausted twice in a row, not on first contact.
let emptyStreak = 0
const RESHOW_AFTER_EMPTY = 2
const RESHOW_BATCH = 10

/** Filter out anything shown before (this session or past ones), memoize the rest. */
function remember(posts: BooruPost[], tag?: string): BooruPost[] {
  loadSeen()
  const fresh: BooruPost[] = []
  for (const p of posts) {
    if (seenIds.has(p.id) || seenUrls.has(p.url)) continue
    seenIds.add(p.id)
    seenUrls.add(p.url)
    seenLedger.push({ id: p.id, url: p.url, tag })
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
  while (seenLedger.length > SEEN_CAP) seenLedger.splice(0, seenLedger.length - SEEN_CAP)
  if (fresh.length > 0) persistSeen()
  return fresh
}

/** Least-recently-seen posts for non-stop reshow (last resort only).
 *  Same-tag history is served first so a fresh tag isn't answered with
 *  another tag's leftovers; untagged (pre-tag) entries fill only when the
 *  preferred tag's history runs out. Returned posts carry no tags and
 *  `repeat: true`; they bypass remember (already memoized) and match any
 *  query as untagged. Rotates through the ledger so consecutive reshow
 *  rounds don't loop the same batch. */
let reshowCursor = 0
export function recallSeen(limit: number, preferTag?: string): BooruPost[] {
  loadSeen()
  if (seenLedger.length === 0) return []
  const n = Math.min(Math.max(1, limit), seenLedger.length)
  // Rotation-ordered ledger so reshow walks least-recent first.
  const ordered = seenLedger.map((_, i) => seenLedger[(reshowCursor + i) % seenLedger.length])
  const same = preferTag ? ordered.filter((s) => s.tag === preferTag) : []
  const rest = preferTag ? ordered.filter((s) => s.tag !== preferTag) : ordered
  const out: BooruPost[] = []
  for (const s of [...same, ...rest]) {
    if (out.length >= n) break
    out.push({ id: s.id, url: s.url, tags: [], rating: 'e', repeat: true as const })
  }
  reshowCursor = (reshowCursor + out.length) % seenLedger.length
  return out
}

/** remember() variant that tallies pre/post counts for empty-vs-offline discrimination. */
function rememberCounted(
  posts: BooruPost[],
  tally: { parsed: number; fresh: number },
  tag?: string,
): BooruPost[] {
  tally.parsed += posts.length
  const fresh = remember(posts, tag)
  tally.fresh += fresh.length
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

/**
 * Bounded-concurrency map: at most `n` lanes in flight, one lane per item.
 * Failures settle to undefined and are dropped — one dead gallery never
 * kills the round. ponytail: stdlib only, no p-limit dep.
 */
export async function mapLimit<T, R>(
  items: T[],
  n: number,
  fn: (item: T, i: number) => Promise<R | undefined>,
): Promise<R[]> {
  const out: Array<R | undefined> = new Array(items.length)
  let next = 0
  const lanes = Math.min(Math.max(1, n), Math.max(items.length, 1))
  const lane = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++
      try {
        out[i] = await fn(items[i], i)
      } catch {
        out[i] = undefined
      }
    }
  }
  await Promise.all(Array.from({ length: lanes }, lane))
  return out.filter((v): v is R => v !== undefined)
}

/**
 * Round-robin merge across galleries/sets: one post per list per turn, up
 * to `limit`. Every gallery contributes instead of the first filling the
 * batch. Pure — unit-tested.
 */
export function roundRobin(lists: BooruPost[][], limit: number): BooruPost[] {
  const out: BooruPost[] = []
  const queues = lists.map((l) => [...l])
  while (out.length < limit && queues.some((q) => q.length > 0)) {
    for (const q of queues) {
      if (out.length >= limit) break
      const p = q.shift()
      if (p) out.push(p)
    }
  }
  return out
}

/**
 * Recency-weighted interleave across tag batches: the priority (most
 * recent) tag takes every other slot (~50%), the rest rotate through the
 * remaining slots. No priority match → plain round-robin. Pure.
 */
export function interleaveBatches(
  batches: Array<{ tag: string; posts: BooruPost[] }>,
  priority?: string | null,
): BooruPost[] {
  const queues = new Map<string, BooruPost[]>()
  for (const b of batches) {
    if (b.posts.length === 0) continue
    queues.set(b.tag, [...(queues.get(b.tag) ?? []), ...b.posts])
  }
  const fav = (priority && queues.get(priority)) || []
  if (priority) queues.delete(priority)
  const rest = [...queues.values()]
  const out: BooruPost[] = []
  let turn = 0
  let ri = 0
  while (fav.length > 0 || rest.some((q) => q.length > 0)) {
    if (turn % 2 === 0 && fav.length > 0) {
      const p = fav.shift()
      if (p) out.push(p)
    } else {
      let took = false
      for (let k = 0; k < rest.length; k++) {
        const q = rest[(ri + k) % rest.length]
        if (q.length > 0) {
          const p = q.shift()
          if (p) out.push(p)
          ri = (ri + k + 1) % rest.length
          took = true
          break
        }
      }
      if (!took) {
        // Other tags dry: the favorite fills the rest (or we're done).
        const p = fav.shift()
        if (p) out.push(p)
        else break
      }
    }
    turn++
  }
  return out
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

export function parseRealbooruHtml(html: string): BooruPost[] {
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
    // realbooru stores stills as .jpeg on the full-image path (.jpg 404s;
    // verified live via HEAD). Thumbnails stay .jpg.
    const ext = isVideo ? 'mp4' : isGif ? 'gif' : 'jpeg'
    const url = `https://realbooru.com/images/${dir1}/${dir2}/${hash}.${ext}`
    const preview = `https://realbooru.com/thumbnails/${dir1}/${dir2}/thumbnail_${hash}.jpg`
    posts.push({ id: `rb-${postId}`, url, preview, tags, rating: 'e', kind: isVideo ? 'video' : 'image' })
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
 * shown twice (until pool exhaustion triggers deepen + reshow below).
 */
async function directFetch(req: BooruRequest): Promise<BooruResponse> {
  const allowReal = req.allowReal !== false
  const allowHentai = req.allowHentai !== false
  // Round tally: distinguishes "mirrors answered but everything was seen"
  // (emptyFresh — gentle path, no cooldown escalation) from true outages.
  const tally = { parsed: 0, fresh: 0 }
  const hit = await dapiPass(req, tally)
  if (hit) return hit
  return dapiFallbacks(req, tally, allowReal, allowHentai)
}

/**
 * One pass over the DAPI/moebooru/HTML mirrors with the full→top2→single
 * variant ladder. Page ids re-roll every pass, so a second (deep) pass
 * probes different pages. Returns a fresh hit or null.
 */
async function dapiPass(
  req: BooruRequest,
  tally: { parsed: number; fresh: number },
): Promise<BooruResponse | null> {
  const allowReal = req.allowReal !== false
  const allowHentai = req.allowHentai !== false
  const neg =
    '-ai_generated -ai-generated -furry -anthro -feral -scalie -monochrome -greyscale -sketch -comic -lowres -worst_quality -jpeg_artifacts -watermark -censored'
  const isProbe = req.probe || req.page === 0
  const pid = req.page !== undefined ? req.page : isProbe ? 0 : Math.floor(Math.random() * 1000)
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
      let pageNum = 1
      let realPidNum = 0
      if (src.type === 'moebooru') {
        kind = 'moe'
        pageNum = isProbe ? 1 : 1 + Math.floor(Math.random() * 50)
        const tags = src.id === 'konachan-direct' ? `${variant} rating:explicit` : variant
        url = `${src.proxy}/post.json?tags=${encodeURIComponent(tags)}&limit=${req.limit}&page=${pageNum}`
      } else if (src.type === 'realhtml') {
        kind = 'html'
        // Preserve multi-word tags with underscores (e.g. skylar_vox),
        // don't drop the rest of the query with split(/\s+/)[0].
        const tagParam = variant.trim().replace(/\s+/g, '_')
        realPidNum = isProbe ? 0 : Math.floor(Math.random() * 1000)
        url = `${src.proxy}/index.php?page=post&s=list&tags=${encodeURIComponent(tagParam)}&pid=${realPidNum}`
      } else if (src.type === 'booruorg') {
        // booru.org Cloudflare WAF challenges `tags=` queries with 403;
        // omitting `tags=` and paginating via random `pid` bypasses WAF (200 OK).
        // Each booru.org sub is already dedicated to its niche theme.
        // Probes jitter across the first pages too: all 5 subdomains hitting
        // pid=0 in lockstep trips the shared IP limiter (429 + 5min cooldown).
        kind = 'html'
        const booruPid = isProbe
          ? Math.floor(Math.random() * 3) * 20
          : Math.floor(Math.random() * 50) * 20
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
      const fresh = rememberCounted(clean, tally, req.tags)
      if (fresh.length === 0) continue // all repeats — narrower pages may be new
      unhealthyUntil.delete(src.id)
      return { posts: fresh, source: src.id, ok: true }
    }
  }
  return null
}

/**
 * Redgifs → Babesource → imhentai → paheal fallback chain, then non-stop
 * handling: one deep DAPI re-pass on seen-exhaustion, else an emptyFresh
 * verdict (gentle) or an offline throw (true outage).
 */
async function dapiFallbacks(
  req: BooruRequest,
  tally: { parsed: number; fresh: number },
  allowReal: boolean,
  allowHentai: boolean,
): Promise<BooruResponse> {
  // Redgifs (real/hardcore short mp4 loops + gifs), then Babesource (real
  // stills galleries), then imhentai (hentai gallery scrape), before the
  // paheal single-tag fallback. Long-form videos are dropped by postFilter
  // (duration metadata only) — short mp4 loops always stay.
  if (allowReal && isHealthy('redgifs-direct')) {
    const rg = await redgifsDirect(req.tags, req.limit)
    if (rg) {
      const fresh = rememberCounted(sanitize(rg, req.tags), tally, req.tags)
      if (fresh.length > 0) {
        unhealthyUntil.delete('redgifs-direct')
        return { posts: fresh, source: 'redgifs-direct', ok: true }
      }
    } else {
      markUnhealthy('redgifs-direct')
    }
  }
  if (allowReal && isHealthy('babesource-direct')) {
    try {
      const bs = await babesourceDirect(req.tags, req.limit)
      if (bs.length > 0) {
        const fresh = rememberCounted(sanitize(bs, req.tags), tally, req.tags)
        if (fresh.length > 0) {
          unhealthyUntil.delete('babesource-direct')
          return { posts: fresh, source: 'babesource-direct', ok: true }
        }
      }
      // Empty (rare query, single-page search, all repeats) is NOT a sick
      // mirror — only hard failures (thrown below) cool the source down.
    } catch {
      markUnhealthy('babesource-direct')
    }
  }
  if (allowHentai && isHealthy('imh-direct')) {
    try {
      const scraped = await imhentaiDirect(req.tags, req.limit)
      // Empty gallery results are NOT a sick mirror (Cloudflare may simply
      // have challenged this round) — only hard failures cool it down.
        const fresh = rememberCounted(sanitize(scraped, req.tags), tally, req.tags)
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
        const fresh = rememberCounted(clean, tally, single)
        if (fresh.length > 0) {
          unhealthyUntil.delete('paheal-direct')
          return { posts: fresh, source: 'paheal-direct', ok: true }
        }
      }
    } catch {
      markUnhealthy('paheal-direct')
    }
  }
  // Deepen (non-stop feed, phase 1): mirrors answered but everything was
  // already seen — one more DAPI pass with fresh random pages before
  // declaring the pool exhausted.
  if (tally.parsed > 0 && tally.fresh === 0) {
    const deep = await dapiPass(req, tally)
    if (deep) return deep
  }
  if (tally.parsed > 0 && tally.fresh === 0) {
    // Seen-exhausted, not broken: gentle path, no cooldown escalation.
    return { posts: [], source: null, ok: false, emptyFresh: true }
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
 * Real/hardcore porn via the Vite dev proxy: temp token → niche-targeted
 * gif fetch when the query matches a niche, else the generic trending feed
 * (upstream ignores search_text — every query returns the same global feed).
 * Null when unusable (caller moves to the next source). Never throws.
 */
export async function redgifsDirect(query: string, limit: number): Promise<BooruPost[] | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const token = await ensureRedgifsToken()
      if (!token) return null
      // 1. Niche-targeted attempt (query-aware). Niche posts are tagged
      // with the matched query tokens so matchesQuery actually matches.
      try {
        const niche = await redgifsNicheForQuery(query, token)
        if (niche) {
          const page = 1 + Math.floor(Math.random() * 5)
          const res = await fetchRedgifsAuthed(
            toProxy(redgifsNicheGifsUrl(niche.id, limit, page), REDGIFS_API, '/rg-auth'),
            token,
          )
          if (res.ok) {
            const posts = withRedgifsQueryTags(parseRedgifs(await res.json()), query)
            if (posts.length > 0) return posts
          }
        }
      } catch (e) {
        if (e instanceof RedgifsAuthExpired) continue
        /* niche lookup is best-effort — fall through to generic */
      }
      // 2. Generic trending fallback (query-blind upstream, untagged posts).
      const page = 1 + Math.floor(Math.random() * 5)
      const url = toProxy(redgifsSearchUrl(query, limit, page), REDGIFS_API, '/rg-auth')
      const res = await fetchRedgifsAuthed(url, token)
      if (!res.ok) return null
      return parseRedgifs(await res.json())
    } catch (e) {
      if (e instanceof RedgifsAuthExpired) continue
      return null
    }
  }
  return null
}

/** Thrown to restart the redgifs flow once with a fresh token. */
class RedgifsAuthExpired extends Error {}

/** Cached temp token (server exp is 24h; we refresh at 20h). Null when unusable. */
async function ensureRedgifsToken(): Promise<string | null> {
  try {
    if (redgifsToken && Date.now() < redgifsTokenExp) return redgifsToken
    redgifsToken = null
    const authRes = await fetch(toProxy(redgifsAuthUrl(), REDGIFS_API, '/rg-auth'), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!authRes.ok) return null
    redgifsToken = parseRedgifsToken(await authRes.json())
    if (!redgifsToken) return null
    redgifsTokenExp = Date.now() + 20 * 3600 * 1000
    return redgifsToken
  } catch {
    return null
  }
}

async function fetchRedgifsAuthed(url: string, token: string): Promise<Response> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 401) {
    // Temp token died before our 20h guess — drop it; caller retries once fresh.
    redgifsToken = null
    redgifsTokenExp = 0
    throw new RedgifsAuthExpired()
  }
  return res
}

// Niche id per query (null = generic fallback), cached 1h so the extra
// lookup costs one request per query per hour, not per round.
const redgifsNicheCache = new Map<string, { niche: RedgifsNiche | null; exp: number }>()
const REDGIFS_NICHE_CACHE_MS = 3600_000

async function redgifsNicheForQuery(query: string, token: string): Promise<RedgifsNiche | null> {
  const key = query.trim().toLowerCase()
  if (!key) return null
  const cached = redgifsNicheCache.get(key)
  if (cached && Date.now() < cached.exp) return cached.niche
  const candidates = [key, ...redgifsQueryTags(query).map((t) => t.replace(/_/g, ' '))]
  for (const q of [...new Set(candidates)]) {
    try {
      const res = await fetch(toProxy(redgifsNicheSearchUrl(q), REDGIFS_API, '/rg-auth'), {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) continue
      const niche = pickRedgifsNiche(query, parseRedgifsNiches(await res.json()))
      if (niche) {
        redgifsNicheCache.set(key, { niche, exp: Date.now() + REDGIFS_NICHE_CACHE_MS })
        return niche
      }
    } catch {
      /* next candidate, then generic fallback */
    }
  }
  redgifsNicheCache.set(key, { niche: null, exp: Date.now() + REDGIFS_NICHE_CACHE_MS })
  return null
}

/** Tag niche-sourced posts with the matched query tokens (niche items ship untagged). */
function withRedgifsQueryTags(posts: BooruPost[], query: string): BooruPost[] {
  const tags = redgifsQueryTags(query)
  if (tags.length === 0) return posts
  return posts.map((p) => ({
    ...p,
    tags: [...new Set([...(p.tags || []), ...tags])],
  }))
}

/** BABESOURCE gallery scraper for real porn stills (full-res, never thumbs).
 *  Page-1 first; higher pages only when pagination advertises them (single-
 *  page queries 404 on page2+, which is normal, not a sick mirror). Throws
 *  only on hard failures (5xx/network) so the caller cools down correctly. */
/** Galleries expanded per gallery-source round; lanes expanded in parallel. */
const GALLERY_CAP = 6
const GALLERY_LANES = 3
export async function babesourceDirect(query: string, limit: number): Promise<BooruPost[]> {
  const slug = babesourceSlug(query)
  if (!slug) return []
  const fetchSearchPage = async (page: number): Promise<string | null> => {
    const searchUrl = toProxy(
      babesourceSearchUrl(query, page),
      BABESOURCE_ROOT,
      '/booru/babe',
    )
    let searchRes: Response
    try {
      searchRes = await fetch(searchUrl, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    } catch {
      throw new Error('babesource search unreachable')
    }
    if (searchRes.status === 404) return null
    if (!searchRes.ok || typeof searchRes.text !== 'function') {
      throw new Error(`babesource search HTTP ${searchRes.status}`)
    }
    return searchRes.text()
  }
  const firstHtml = await fetchSearchPage(1)
  if (firstHtml === null) return []
  const seen = new Set<string>()
  const galleryUrls: string[] = []
  const collect = (html: string): void => {
    for (const u of parseBabesourceSearch(html, GALLERY_CAP)) {
      if (!seen.has(u)) {
        seen.add(u)
        galleryUrls.push(u)
      }
    }
  }
  collect(firstHtml)
  // Variety: extra random pages until the gallery set is full or pages run out.
  const maxPage = Math.min(parseBabesourceMaxPage(firstHtml), 5)
  if (maxPage > 1 && galleryUrls.length < GALLERY_CAP) {
    const page = 2 + Math.floor(Math.random() * (maxPage - 1))
    const extraHtml = await fetchSearchPage(page)
    if (extraHtml !== null) collect(extraHtml)
  }
  if (galleryUrls.length === 0) return []
  // Every gallery contributes: bounded lanes expand in parallel, then images
  // round-robin across galleries so one gallery can't fill the batch alone.
  const perGallery = Math.max(1, Math.ceil(limit / galleryUrls.length))
  const sets = await mapLimit(galleryUrls, GALLERY_LANES, async (gUrl) => {
    try {
      const gRes = await fetch(toProxy(gUrl, BABESOURCE_ROOT, '/booru/babe'), {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!gRes.ok || typeof gRes.text !== 'function') return undefined
      const gHtml = await gRes.text()
      const images = parseBabesourceGallery(gHtml, perGallery)
      if (images.length === 0) return undefined
      return toBabesourcePosts(gUrl, images, query, parseBabesourceTags(gHtml))
    } catch {
      return undefined /* one dead gallery never kills the round */
    }
  })
  return roundRobin(sets, limit)
}

/**
 * imhentai via the Vite dev proxy: search page → gallery IDs → covers plus
 * full-book expansion so one round returns several image sets, not one
 * cover. Never throws.
 */
async function imhentaiDirect(query: string, limit: number): Promise<BooruPost[]> {
  try {
    const searchRes = await fetch(toProxy(imhentaiSearchUrl(query), IMHENTAI_ROOT, '/booru/imh'), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!searchRes.ok || typeof searchRes.text !== 'function') return []
    const html = await searchRes.text()

    // 1. Gallery covers directly from the search HTML in one pass (avoids
    // secondary requests that trigger Cloudflare 403s). toImhentaiPost
    // rewrites thumb.jpg -> 1.jpg; drop posts where the rewrite failed.
    const directResults = parseImhentaiSearchResults(html, Math.max(limit, 3))
    const converted = directResults
      .slice(0, limit)
      .map((r) => toImhentaiPost(r.id, { url: r.coverUrl, width: 0, height: 0 }, query))
      .filter((p) => !/\/(?:thumb|thumbs)(?:[?#/.]|$)/i.test(p.url))
    const seenCoverIds = new Set(directResults.map((r) => r.id))

    // 2. Expand gallery books (whole book per page via the ext map) whenever
    // covers alone leave the batch short — bounded lanes, round-robin merge
    // so several galleries contribute instead of one.
    const want = limit - converted.length
    const ids = want > 0 ? parseImhentaiSearch(html, GALLERY_CAP).filter((id) => !seenCoverIds.has(id)) : []
    if (ids.length === 0) return converted
    const perGallery = Math.max(1, Math.ceil(want / ids.length))
    const sets = await mapLimit(ids, GALLERY_LANES, async (id) => {
      try {
        const gRes = await fetch(toProxy(imhentaiGalleryUrl(id), IMHENTAI_ROOT, '/booru/imh'), {
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })
        // Cloudflare trips on gallery bursts — back the source off entirely.
        if (gRes.status === 403) {
          markUnhealthy('imh-direct')
          return undefined
        }
        if (!gRes.ok || typeof gRes.text !== 'function') return undefined
        const pages = toImhentaiPagePosts(id, parseImhentaiGalleryPages(await gRes.text(), perGallery), query, perGallery)
        return pages.length > 0 ? pages : undefined
      } catch {
        return undefined /* one dead gallery never kills the round */
      }
    })
    // A 403 mid-round cools the source; still serve whatever lanes finished.
    return [...converted, ...roundRobin(sets, want)]
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
 * Browser/dev → direct fetch. True failures → offline:true, never throws.
 * Seen-exhaustion → emptyFresh (+ least-recent reshow after proving
 * exhausted twice in a row), so the feed stays non-stop.
 */
export async function fetchPosts(req: BooruRequest): Promise<BooruResponse> {
  const offline: BooruResponse = { posts: [], source: null, ok: false, offline: true }
  if (!req.tags.trim() || isQueryBlocked(req.tags)) return offline
  try {
    if (typeof window !== 'undefined' && window.gmatch?.booruFetch) {
      const res = await window.gmatch.booruFetch(req)
      if (res.ok) {
        const fetched = res.posts || []
        const fresh = remember(sanitize(fetched, req.tags), req.tags)
        if (fresh.length > 0) {
          emptyStreak = 0
          return { ...res, posts: fresh }
        }
        return emptyRound(fetched.length, req.limit, res, req.tags)
      }
      return { ...offline }
    }
    const res = await directFetch(req)
    if (res.ok && res.posts.length > 0) {
      emptyStreak = 0
      return res
    }
    if (res.emptyFresh) return emptyRound(1, req.limit, res, req.tags)
    return { ...offline }
  } catch {
    return { ...offline }
  }
}

/**
 * Seen-exhausted round handler. First contact returns a gentle emptyFresh
 * verdict (no backoff escalation); once the pool proves exhausted twice in
 * a row, reshow least-recently-seen posts with repeat:true (non-stop feed,
 * last resort). Skips/discards stay excluded — only passively-seen items
 * can reshow (enforced by the caller paths, which never feed discards
 * into remember()).
 */
function emptyRound(parsed: number, limit: number, res: BooruResponse, preferTag?: string): BooruResponse {
  if (parsed <= 0) return { posts: [], source: null, ok: false, offline: true }
  emptyStreak += 1
  if (emptyStreak >= RESHOW_AFTER_EMPTY) {
    const recalled = recallSeen(Math.min(Math.max(limit, 1), RESHOW_BATCH), preferTag)
    if (recalled.length > 0) {
      return { posts: recalled, source: 'reshow', ok: true }
    }
  }
  return { posts: [], source: res.source ?? null, ok: false, emptyFresh: true }
}

export interface BooruMultiRequest {
  tags: string[]
  limit: number
  priority?: string | null
  allowReal?: boolean
  allowHentai?: boolean
  page?: number
  probe?: boolean
}

// New tag set = new round: yesterday's exhaustion must not answer today's
// query with another tag's leftovers.
let lastMultiKey = ''

/**
 * One ROUND across every selected tag: concurrent fetchPosts per tag, then a
 * recency-weighted interleave (priority ~50%, rest rotating) so a tag switch
 * lands new-tag posts immediately while keeping the mix. Exhaustion
 * accounting runs ONCE for the combined round — per-call streak churn is
 * rolled back first. Never throws (offline verdict on total failure).
 */
export async function fetchPostsMulti(req: BooruMultiRequest): Promise<BooruResponse> {
  const tags = [...new Set(req.tags.map((t) => t.trim()).filter(Boolean))]
  if (tags.length === 0) return { posts: [], source: null, ok: false, offline: true }
  const key = [...tags].sort().join(' ')
  if (key !== lastMultiKey) {
    lastMultiKey = key
    emptyStreak = 0
  }
  const streakBefore = emptyStreak
  const settled = await Promise.all(
    tags.map((t) =>
      fetchPosts({
        tags: t,
        limit: Math.max(1, Math.ceil(req.limit / tags.length)),
        allowReal: req.allowReal,
        allowHentai: req.allowHentai,
        page: req.page,
        probe: req.probe,
      }),
    ),
  )
  // One verdict per round: roll back per-call streak churn first.
  emptyStreak = streakBefore
  const batches: Array<{ tag: string; posts: BooruPost[] }> = []
  const sources: string[] = []
  let answered = false
  for (let i = 0; i < settled.length; i++) {
    const r = settled[i]
    if (r.source && !sources.includes(r.source)) sources.push(r.source)
    if (r.ok || r.emptyFresh) answered = true
    // Reshow posts are last-resort singles; drop them when any tag hit live.
    const live = r.posts.filter((p) => !p.repeat)
    if (r.ok && live.length > 0) batches.push({ tag: tags[i], posts: live })
  }
  if (batches.length > 0) {
    emptyStreak = 0
    return {
      posts: interleaveBatches(batches, req.priority).slice(0, Math.max(req.limit, 1)),
      source: sources.join('+') || null,
      ok: true,
    }
  }
  if (answered) return emptyRound(1, req.limit, { posts: [], source: sources.join('+') || null, ok: false }, req.priority ?? undefined)
  return { posts: [], source: null, ok: false, offline: true }
}
