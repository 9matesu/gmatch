// Idle feed booru client (SPEC §6): runs in the Electron main via IPC. The
// social feed's parallel client is apps/api/src/routes/booru.ts (server-side
// proxy) — different trust domains, intentionally not merged.
import type { BooruPost } from '../game/types'
import { isQueryBlocked, isUserExcluded } from '../game/tagFilter'
import { blockedPair, getCoRules, isFeedIntent } from '../game/tagCooccur'
import { matchesQuery as matchMatchesQuery, parseQuery } from '../game/matchRule'
import { endRound, markStage, startRound } from './queryTiming'
import { allowOnly } from './postFilter'
import {
  REDGIFS_API,
  parseRedgifs,
  parseRedgifsNiches,
  parseRedgifsToken,
  pickRedgifsNiche,
  redgifsAuthUrl,
  redgifsNicheGifsUrl,
  redgifsNicheMatchesQuery,
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
  parseBabesourceCovers,
  parseBabesourceGallery,
  parseBabesourceMaxPage,
  parseBabesourceSearch,
  parseBabesourceTags,
  toBabesourceCoverPosts,
  toBabesourcePosts,
  type BabesourceImage,
} from './babesource'

export interface BooruRequest {
  tags: string
  limit: number
  allowReal?: boolean
  allowHentai?: boolean
  page?: number
  probe?: boolean
  fresh?: boolean
  /**
   * Validation-only fetch (tag probe, market discovery): posts are checked
   * but NEVER memoized into the seen-set, so probing a tag can't hide its
   * own pool from the feed or stuff the reshow ledger with unseen pictures.
   */
  silent?: boolean
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

/**
 * Budget for full HTML documents (list/search/gallery/post-view pages:
 * realbooru lists run ~56KB, babesource searches ~500KB, galleries ~300KB).
 * JSON APIs stay on the tight TIMEOUT_MS; scraping gets room to land.
 */
const HTML_TIMEOUT_MS = 8_000

/** View-page (gallery) expansion bounds: capped lanes, exact file URLs. */
export const VIEW_POST_CAP = 6
export const VIEW_POST_LANES = 3

/**
 * Hard budget for ONE feed round.
 *
 * Without this a round has no ceiling at all. `dapiPass` walks up to 10
 * mirrors x 3 query variants sequentially at TIMEOUT_MS each, the caller
 * re-runs it up to twice more on seen-exhaustion (the "deepen" loop), and
 * every HTML mirror then spends up to HTML_TIMEOUT_MS per post-view fetch
 * across VIEW_POST_LANES lanes. The product of those is a round that can run
 * for minutes with nothing on screen but "Loading" — which is exactly the
 * "clicker takes forever to show me a picture" report.
 *
 * This is a ROUND budget, not a per-request one: it caps the total time from
 * asking to having something to show. Per-request budgets still apply
 * (TIMEOUT_MS / HTML_TIMEOUT_MS) and are merged with it, so a single slow
 * mirror is cut short without abandoning the whole cascade.
 *
 * Generous enough that a cold cache plus one slow gallery page still lands
 * real posts; short enough that a player never thinks the app hung.
 */
export const ROUND_DEADLINE_MS = 8_000

/** Deadline token threaded through a round so nested fetches can be cut. */
export interface RoundBudget {
  signal: AbortSignal
  /** True once the budget is spent; cheap to check, safe to call anywhere. */
  expired: () => boolean
  /** Clear the deadline timer. Always call this when the round ends. */
  dispose: () => void
}

/**
 * Start a round budget. The returned signal aborts when the deadline passes,
 * and `expired()` lets hot loops bail without catching an AbortError.
 *
 * Timers are unref'd where supported so a pending budget never holds a test
 * runner (or a quitting renderer) open.
 */
export function startRoundBudget(ms: number = ROUND_DEADLINE_MS): RoundBudget {
  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(new DOMException('round deadline', 'TimeoutError')),
    ms,
  )
  // Node (vitest) and browsers both return a handle with unref; Electron's
  // main/renderer too. Guard anyway — a plain number has no unref.
  const unref = (timer as unknown as { unref?: () => void }).unref
  if (typeof unref === 'function') unref.call(timer)
  return {
    signal: controller.signal,
    expired: () => controller.signal.aborted,
    dispose: () => clearTimeout(timer),
  }
}

/** Clear a budget's timer, tolerating a budget-less call. */
function budgetDispose(budget: RoundBudget | undefined): void {
  budget?.dispose()
}


/**
 * Merge an outer round budget into a per-request timeout, so one signal
 * expresses "this request must not outlive the round".
 *
 * Returns an object rather than a bare AbortSignal because the caller often
 * needs to know whether the REQUEST or the ROUND was what failed — the two
 * have different consequences for mirror health (a sick mirror should be
 * cooled; a round that simply ran out of time should not).
 */
export function withRequestTimeout(
  timeoutMs: number,
  budget: RoundBudget | undefined,
): { signal: AbortSignal; timedOut: () => boolean } {
  if (!budget) {
    return { signal: AbortSignal.timeout(timeoutMs), timedOut: () => true }
  }
  const request = AbortSignal.timeout(timeoutMs)
  const signal = AbortSignal.any([budget.signal, request])
  return { signal, timedOut: () => request.aborted }
}

/** True when a fetch failed because the ROUND ran out of time (not the mirror). */
function isDeadlineAbort(err: unknown, budget: RoundBudget | undefined): boolean {
  return Boolean(budget?.expired())
}

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

/** Fresh game: forget every image ever seen (global never-repeat ledger) so a
 * reset start draws from the full pool again. Keeps mirror cooldowns intact. */
export function clearSeenMemory(): void {
  seenIds.clear()
  seenUrls.clear()
  seenLedger.length = 0
  reshowCursor = 0
  emptyStreak = 0
  seenLoaded = true
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(SEEN_KEY)
  } catch { /* private mode */ }
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
  recentPages.clear()
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
export function recallSeen(limit: number, preferTag?: string, rand: () => number = Math.random): BooruPost[] {
  loadSeen()
  if (seenLedger.length === 0) return []
  const n = Math.min(Math.max(1, limit), seenLedger.length)
  // Rotation-ordered ledger so reshow walks least-recent first.
  const ordered = seenLedger.map((_, i) => seenLedger[(reshowCursor + i) % seenLedger.length])
  const same = preferTag ? ordered.filter((s) => s.tag === preferTag) : []
  const rest = preferTag ? ordered.filter((s) => s.tag !== preferTag) : ordered
  // Shuffle WITHIN each group (never across): the same-tag preference is
  // preserved, but consecutive reshow rounds can never come back
  // byte-identical — the "same 10 pictures in the same order" loop.
  const shuffle = <T>(arr: T[]): T[] => {
    const a = [...arr]
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      const t = a[i]
      a[i] = a[j]
      a[j] = t
    }
    return a
  }
  const out: BooruPost[] = []
  for (const s of [...shuffle(same), ...shuffle(rest)]) {
    if (out.length >= n) break
    out.push({ id: s.id, url: s.url, tags: [], rating: 'e', repeat: true as const })
  }
  reshowCursor = (reshowCursor + out.length) % seenLedger.length
  return out
}

/** remember() variant that tallies pre/post counts for empty-vs-offline discrimination.
 * Silent (probe/market) calls only count — they never memoize, so validation
 * fetches can't poison the no-repeat memory or the reshow ledger. */
function rememberCounted(
  posts: BooruPost[],
  tally: { parsed: number; fresh: number },
  tag?: string,
  silent = false,
): BooruPost[] {
  tally.parsed += posts.length
  const fresh = silent ? posts : remember(posts, tag)
  tally.fresh += fresh.length
  return fresh
}

// Page memory: recently-drawn pages per source+query, so rounds sample
// WITHOUT replacement instead of re-rolling seen windows (the "same
// pictures" machine for small pools). Session-only, capped; deterministic
// (probe/page-explicit) draws are never recorded.
const PAGE_MEMORY_DEPTH = 20
const recentPages = new Map<string, number[]>()
/** Test hook: clear page memory (also run by __resetFeedState). */
export function __resetPageMemoryForTests(): void {
  recentPages.clear()
}

function recordPage(key: string, page: number): void {
  recentPages.set(key, [...(recentPages.get(key) ?? []), page].slice(-PAGE_MEMORY_DEPTH))
}

/**
 * Draw a 0-based pid in [0, window) avoiding recently drawn ones (re-roll
 * up to 6 times, then accept a repeat — tiny pools can't avoid it).
 * Exported for tests.
 */
export function drawFreshPid(key: string, window: number, rand: () => number = Math.random): number {
  const w = Math.max(1, Math.floor(window) || 1)
  const seen = recentPages.get(key) ?? []
  let pid = Math.floor(rand() * w)
  for (let i = 0; i < 6 && seen.includes(pid); i++) {
    pid = Math.floor(rand() * w)
  }
  recordPage(key, pid)
  return pid
}

/**
 * Draw a 1-based page in [1, maxPage] with the same no-repeat rule.
 * Exported for tests.
 */
export function drawFreshPage(key: string, maxPage: number, rand: () => number = Math.random): number {
  return drawFreshPid(key, Math.max(1, Math.floor(maxPage) || 1), rand) + 1
}

// Co-occurrence rules blocked by the player's current feed intent (T4).
function feedTagsSafe(tags: string[]): Set<string> {
  // A tag ON the post that is also feed intent means "I want this": stand down.
  return new Set(tags.filter(isFeedIntent))
}

/**
 * Result validation for a query. Delegates to the shared rule (strict AND on
 * normalized tag equality — see src/game/matchRule.ts and its authoritative
 * CJS twin). This used to be a local `some()` + `includes()` + underscore
 * split, which let a 2-tag query return posts matching ONE tag and matched
 * `large_breasts` against a post tagged `large`.
 *
 * `trustUntagged` keeps the existing policy for providers that return no tags
 * at all (redgifs / imhentai / babesource / paheal): nothing to validate
 * against, so their own search stands. Tagged providers are always validated.
 */
export function matchesQuery(post: BooruPost, query?: string): boolean {
  if (!query) return true
  return matchMatchesQuery(post.tags, query, { trustUntagged: true })
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

// Source registry (shared/sources.json) — see services/booruSources.ts. Both
// runtimes read the same rows, so the renderer and main can no longer drift
// (allgirl.booru.org and rule34.booru.org were main-only for months).
import { DIRECT_SOURCES } from './booruSources'
export { ALL_SOURCES, refererFor, DIRECT_SOURCES, type DirectSourceDef } from './booruSources'

/**
 * Combo queries (4-5 tags) get truncated by the mirrors — full query first,
 * then top-2 tags, then the single leading tag. Mirrors electron/main.cjs.
 */
export function queryVariants(query: string): string[] {
  // Narrowing keeps every POSITIVE tag and every NEGATIVE term. Negatives
  // are safety, not preference: they carry the blocklist and slop exclusions,
  // so a narrower variant that quietly dropped `-solo` (or a whole run of
  // `-furry -ai_generated`) would re-admit exactly what the query excluded.
  const parts = query.split(/\s+/).filter(Boolean)
  const neg = parts.filter((p) => p.startsWith('-'))
  const pos = parts.filter((p) => !p.startsWith('-'))
  const tail = neg.length ? ` ${neg.join(' ')}` : ''
  const variants = [`${pos.join(' ')}${tail}`.trim()]
  if (pos.length > 2) variants.push(`${pos.slice(0, 2).join(' ')}${tail}`)
  if (pos.length > 1) variants.push(`${pos[0]}${tail}`)
  return [...new Set(variants.filter(Boolean))]
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
  return parseRealbooruEntries(html).map(stripAnyEntryPostId)
}

/** A list-parsed post plus its post-view id (null when the thumb has no
 * view link). The feed expands view pages for exact file URLs. */
export interface RealbooruEntry extends BooruPost {
  postId: string | null
}

function stripAnyEntryPostId(e: RealbooruEntry | BooruOrgEntry): BooruPost {
  const { postId: _ignored, ...post } = e
  void _ignored
  return post
}

function realbooruPostFromThumb(
  thumbSrc: string,
  rawTitle: string,
  postId: string | null,
): RealbooruEntry | null {
  const t = /realbooru\.com\/thumbnails\/([^/]+)\/([^/]+)\/thumbnail_([^."]+)\.jpg/i.exec(thumbSrc)
  if (!t) return null
  const [, dir1, dir2, hash] = t
  const tags = rawTitle
    .split(/,\s*/)
    .map((x) => x.trim().replace(/\s+/g, '_'))
    .filter(Boolean)
  const isVideo = tags.includes('video') || tags.includes('mp4') || tags.includes('webm')
  const isGif = tags.includes('gif')
  // realbooru stores stills as .jpeg on the full-image path (.jpg 404s;
  // verified live via HEAD). Thumbnails stay .jpg. Guessed — the view
  // page carries the authoritative URL (see parseRealbooruPost).
  const ext = isVideo ? 'mp4' : isGif ? 'gif' : 'jpeg'
  const url = `https://realbooru.com/images/${dir1}/${dir2}/${hash}.${ext}`
  const preview = `https://realbooru.com/thumbnails/${dir1}/${dir2}/thumbnail_${hash}.jpg`
  const altId = postId ?? ''
  return {
    id: `rb-${altId}`,
    url,
    preview,
    tags,
    rating: 'e',
    kind: isVideo ? 'video' : 'image',
    postId,
  }
}

/**
 * List entries with post-view ids. Primary pass: thumb anchors
 * (`<a href="...s=view&id=NNN"><img …>`) — the id feeds view-page
 * expansion. Second pass: lone thumbs (old shape) keep guessed-url
 * coverage. Never throws.
 */
export function parseRealbooruEntries(html: string): RealbooruEntry[] {
  const out: RealbooruEntry[] = []
  if (typeof html !== 'string') return out
  const seen = new Set<string>()
  const push = (e: RealbooruEntry | null): void => {
    if (!e || !e.id || e.id === 'rb-' || seen.has(e.id)) return
    seen.add(e.id)
    out.push(e)
  }
  let m: RegExpExecArray | null
  const anchorRe = /<a\b[^>]*href="[^"]*?page=post&(?:amp;)?s=view&(?:amp;)?id=(\d+)"[^>]*>\s*<img\b([^>]*)>/gi
  while ((m = anchorRe.exec(html)) !== null) {
    const attrs = m[2]
    const src = /src="([^"]+)"/i.exec(attrs)?.[1] ?? ''
    const title = /title="([^"]*)"/i.exec(attrs)?.[1] ?? ''
    push(realbooruPostFromThumb(src, title, m[1]))
  }
  const imgRe =
    /<img\s+[^>]*src="(https:\/\/realbooru\.com\/thumbnails\/([^/]+)\/([^/]+)\/thumbnail_([^."]+)\.jpg)"[^>]*title="([^"]*)"[^>]*alt="Image:\s*(\d+)"/gi
  while ((m = imgRe.exec(html)) !== null) {
    const [, src, , , , rawTitle, altId] = m
    push(realbooruPostFromThumb(src, rawTitle, altId))
  }
  return out
}

/** Kind from a file URL: mp4/webm/mov play, everything else shows. */
function kindForFileUrl(url: string): 'image' | 'video' {
  return /\.(mp4|webm|mov)(?:[?#]|$)/i.test(url) ? 'video' : 'image'
}

/**
 * Exact file URL from a realbooru post-view page (verified live):
 *  1. `<video><source src="….mp4">` (mp4 preferred) → video,
 *  2. `<img id="image" src="…">` (attribute order varies) → by extension,
 *  3. the `Original` download link → by extension.
 * Null when the page carries no file (challenge/removed). Never throws.
 */
export function parseRealbooruPost(html: unknown): { url: string; kind: 'image' | 'video' } | null {
  try {
    if (typeof html !== 'string') return null
    const video = /<video\b[^>]*>([\s\S]*?)<\/video>/i.exec(html)
    if (video) {
      const srcs = [...video[1].matchAll(/<source\b[^>]*\bsrc="([^"]+)"/gi)].map((s) => s[1])
      const mp4 = srcs.find((u) => /\.mp4(?:[?#]|$)/i.test(u))
      const any = mp4 ?? srcs.find((u) => /\.(mp4|webm|mov)(?:[?#]|$)/i.test(u))
      if (any) return { url: any, kind: 'video' }
    }
    const img = /<img\b(?=[^>]*\bid="image")[^>]*\bsrc="([^"]+)"/i.exec(html)
    if (img) {
      const url = img[1].startsWith('//') ? `https:${img[1]}` : img[1]
      return { url, kind: kindForFileUrl(url) }
    }
    const orig = /<a\b[^>]*\bhref="([^"]+)"[^>]*>\s*Original\s*<\/a>/i.exec(html)
    if (orig) {
      const url = orig[1].startsWith('//') ? `https:${orig[1]}` : orig[1]
      return { url, kind: kindForFileUrl(url) }
    }
    return null
  } catch {
    return null
  }
}

function booruOrgPostFromFields(
  bSub: string,
  dir: string,
  hash: string,
  ext: string,
  rawTitle: string,
): BooruPost | null {
  const ratingMatch = /rating:([a-z]+)/i.exec(rawTitle)
  const rating = ratingMatch ? ratingMatch[1].toLowerCase() : 'e'
  const tagsPart = rawTitle
    .replace(/score:\d+/i, '')
    .replace(/rating:[a-z]+/i, '')
    .trim()
  const tags = tagsPart.split(/\s+/).filter(Boolean)
  const url = `https://img.booru.org/${bSub}//images/${dir}/${hash}.${ext}`
  const preview = `https://thumbs.booru.org/${bSub}/thumbnails//${dir}/thumbnail_${hash}.${ext}`
  const id = `${bSub}-${hash.slice(0, 10)}`
  if (rating === 'explicit' || rating === 'e' || rating === 'questionable') {
    return { id, url, preview, tags, rating: 'e' }
  }
  return null
}

/** A list-parsed post plus its post-view id (null when the thumb has no
 * view link). The feed expands view pages for exact file URLs. */
export interface BooruOrgEntry extends BooruPost {
  postId: string | null
}

/**
 * Post-view expansion: swap guessed file URLs for exact ones from the
 * post-view page (`s=view&id=`). Bounded lanes (VIEW_POST_CAP/LANES);
 * per-post failures fall back to the guessed entry, so expansion can
 * never kill a round. List order preserved. Never throws. Exported for tests.
 */
export async function expandPostViews(
  entries: Array<RealbooruEntry | BooruOrgEntry>,
  viewBase: string,
  parseView: (html: string) => { url: string; kind: 'image' | 'video' } | null,
  budget?: RoundBudget,
): Promise<BooruPost[]> {
  const withId = entries.filter((e) => e.postId).slice(0, VIEW_POST_CAP)
  if (withId.length === 0) return entries.map(stripAnyEntryPostId)
  const expanded = await mapLimit(withId, VIEW_POST_LANES, async (entry) => {
    // Post-view pages are the slowest part of an HTML mirror (up to
    // VIEW_POST_CAP of them), so they inherit the round budget: a burst of
    // slow galleries must not push the round past its ceiling.
    if (budget?.expired()) return undefined
    try {
      const { signal } = withRequestTimeout(HTML_TIMEOUT_MS, budget)
      const res = await fetch(`${viewBase}/index.php?page=post&s=view&id=${entry.postId}`, { signal })
      if (!res.ok || typeof res.text !== 'function') return undefined
      const hit = parseView(await res.text())
      if (!hit) return undefined
      const { postId: _drop, ...post } = entry
      void _drop
      return { ...post, url: hit.url, kind: hit.kind }
    } catch {
      return undefined // guessed-url entry below keeps the round alive
    }
  })
  const byId = new Map(expanded.map((p) => [p.id, p]))
  return entries.map((e) => byId.get(e.id) ?? stripAnyEntryPostId(e))
}

/**
 * List entries with post-view ids. Primary pass: thumb anchors
 * (`<a id="pNNN" href="…s=view&id=NNN"><img …>`) — the id feeds view-page
 * expansion. Second pass: lone thumbs (old shape) keep guessed-url
 * coverage. Never throws.
 */
export function parseBooruOrgEntries(html: string): BooruOrgEntry[] {
  const out: BooruOrgEntry[] = []
  if (typeof html !== 'string') return out
  const seen = new Set<string>()
  const push = (e: (BooruPost | null), postId: string | null): void => {
    if (!e || seen.has(e.id)) return
    seen.add(e.id)
    out.push({ ...e, postId })
  }
  let m: RegExpExecArray | null
  const anchorRe =
    /<a\b[^>]*\bid="p(\d+)"[^>]*href="[^"]*?s=view&(?:amp;)?id=(\d+)"[^>]*>\s*<img\b([^>]*)>/gi
  while ((m = anchorRe.exec(html)) !== null) {
    const attrs = m[3]
    const fields =
      /src="https:\/\/thumbs\.booru\.org\/([^/]+)\/thumbnails\/\/([^/]+)\/thumbnail_([^."]+)\.([^"]+)"[^>]*title="([^"]*)"/i.exec(
        attrs,
      )
    if (!fields) continue
    push(booruOrgPostFromFields(fields[1], fields[2], fields[3], fields[4], fields[5]), m[2])
  }
  const imgRe =
    /<img\s+[^>]*src="https:\/\/thumbs\.booru\.org\/([^/]+)\/thumbnails\/\/([^/]+)\/thumbnail_([^."]+)\.([^"]+)"[^>]*title="([^"]*)"/gi
  while ((m = imgRe.exec(html)) !== null) {
    const [, bSub, dir, hash, ext, rawTitle] = m
    push(booruOrgPostFromFields(bSub, dir, hash, ext, rawTitle), null)
  }
  return out
}

/**
 * Exact file URL from a booru.org post-view page (verified live on
 * blacked: `<img … id="image" src="https://img.booru.org/…">`):
 *  1. `<img id="image" src="…">` (attribute order varies) → by extension,
 *  2. an original-file link (`//images/` href) → by extension.
 * Null when the page carries no file. Never throws.
 */
export function parseBooruOrgPost(html: unknown): { url: string; kind: 'image' | 'video' } | null {
  try {
    if (typeof html !== 'string') return null
    const img = /<img\b(?=[^>]*\bid="image")[^>]*\bsrc="([^"]+)"/i.exec(html)
    if (img) {
      const url = img[1].startsWith('//') ? `https:${img[1]}` : img[1]
      return { url, kind: kindForFileUrl(url) }
    }
    const orig = /<a\b[^>]*\bhref="([^"]*\/\/images\/[^"]+)"[^>]*>/i.exec(html)
    if (orig) {
      const url = orig[1].startsWith('//') ? `https:${orig[1]}` : orig[1]
      return { url, kind: kindForFileUrl(url) }
    }
    return null
  } catch {
    return null
  }
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
  // One budget for the WHOLE round, including the scraper fallback chain and
  // the deepen pass — not per stage. Otherwise a round that misses on every
  // DAPI mirror still gets the full budget again from redgifs, then again from
  // babesource, and the ceiling is meaningless.
  const budget = startRoundBudget()
  try {
    const hit = await dapiPass(req, tally, budget)
    if (hit) return hit
    return await dapiFallbacks(req, tally, allowReal, allowHentai, budget)
  } finally {
    budgetDispose(budget)
  }
}

/** Build the request URL for one (mirror, variant) pair. */
function variantUrl(
  src: { id: string; type: string; proxy: string; sub?: string },
  variant: string,
  req: BooruRequest,
  isProbe: boolean,
  pid: number,
  neg: string,
): { url: string; kind: 'dapi' | 'moe' | 'html'; pageNum: number } {
  if (src.type === 'moebooru') {
    const pageNum = isProbe ? 1 : drawFreshPage(`moe::${src.id}::${variant}`, 50)
    const tags = src.id === 'konachan-direct' ? `${variant} rating:explicit` : variant
    return { url: `${src.proxy}/post.json?tags=${encodeURIComponent(tags)}&limit=${req.limit}&page=${pageNum}`, kind: 'moe', pageNum }
  }
  if (src.type === 'realhtml') {
    // Realbooru `pid` is a result offset: any nonzero pid over-pages small
    // pools (live: skylar_vox base list carries 42 thumbs while pid=500
    // returns a blank page). Always fetch the base list; variety comes from
    // shuffling expanded view results + seen-memory.
    // Preserve multi-word tags with underscores (e.g. skylar_vox).
    const tagParam = variant.trim().replace(/\s+/g, '_')
    return { url: `${src.proxy}/index.php?page=post&s=list&tags=${encodeURIComponent(tagParam)}`, kind: 'html', pageNum: 1 }
  }
  if (src.type === 'booruorg') {
    // booru.org Cloudflare WAF challenges `tags=` queries with 403; omitting
    // `tags=` and paginating via random `pid` bypasses WAF (200 OK). Each
    // booru.org sub is already dedicated to its niche theme. Probes jitter
    // across the first pages too: all subdomains hitting pid=0 in lockstep
    // trips the shared IP limiter (429 + 5min cooldown).
    const booruPid = isProbe
      ? Math.floor(Math.random() * 3) * 20
      : drawFreshPid(`boorg::${src.sub}::${variant}`, 50) * 20
    return { url: `${src.proxy}/index.php?page=post&s=list&pid=${booruPid}`, kind: 'html', pageNum: 1 }
  }
  // Explicit page/probe pins the pid; rounds sample without replacement per
  // source+query so the same window is never re-rolled twice.
  const usePid = isProbe || req.page !== undefined ? pid : drawFreshPid(`dapi::${src.id}::${variant}`, 1000)
  return {
    url: `${src.proxy}/index.php?page=dapi&s=post&q=index&tags=${encodeURIComponent(
      `${variant} rating:explicit ${neg}`,
    )}&limit=${req.limit}&json=1&pid=${usePid}`,
    kind: 'dapi',
    pageNum: 1,
  }
}

/** Outcome of one variant attempt, including whether the mirror looked sick. */
interface VariantOutcome {
  posts: BooruPost[] | null
  /** The mirror itself failed (network error / non-2xx) — worth cooling. */
  sick: boolean
}

/**
 * Fetch one (mirror, variant) pair: request, parse, expand, sanitize.
 *
 * Health reporting is deliberate: a request killed by the ROUND deadline is
 * NOT a sick mirror. Cooling a healthy mirror because the player moved on
 * would shrink the pool until the feed looked broken.
 */
async function fetchVariant(
  src: { id: string; type: string; proxy: string; sub?: string; origin: string },
  variant: string,
  req: BooruRequest,
  budget: RoundBudget | undefined,
  isProbe: boolean,
  pid: number,
  neg: string,
): Promise<VariantOutcome> {
  const { url, kind } = variantUrl(src, variant, req, isProbe, pid, neg)
  const timeoutMs = kind === 'html' ? HTML_TIMEOUT_MS : TIMEOUT_MS
  const { signal, timedOut } = withRequestTimeout(timeoutMs, budget)

  let res: Response
  try {
    res = await fetch(url, { signal })
  } catch {
    // Aborted by the ROUND, not by this request: nobody's fault but the clock.
    if (isDeadlineAbort(undefined, budget)) return { posts: null, sick: false }
    markUnhealthy(src.id)
    return { posts: null, sick: true }
  }
  if (!res.ok) {
    if (timedOut()) return { posts: null, sick: false }
    // HTTP error = sick mirror: cool it down.
    if (res.status === 429) {
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
    return { posts: null, sick: true }
  }

  let parsed: BooruPost[]
  if (kind === 'html') {
    let html: string
    try {
      html = await res.text()
    } catch {
      return { posts: null, sick: false }
    }
    // Post-view expansion is the expensive part of an HTML mirror: up to
    // VIEW_POST_CAP extra requests across VIEW_POST_LANES lanes. It inherits
    // the round budget so a burst of slow galleries cannot blow the ceiling.
    parsed = (
      await expandPostViews(
        src.type === 'realhtml' ? parseRealbooruEntries(html) : parseBooruOrgEntries(html),
        src.proxy,
        src.type === 'realhtml' ? parseRealbooruPost : parseBooruOrgPost,
        budget,
      )
    ).slice(0, req.limit)
  } else {
    let data: unknown
    try {
      data = await res.json()
    } catch {
      return { posts: null, sick: false }
    }
    parsed = kind === 'moe' ? toMoePosts(data, src.origin) : toPosts(data, src.origin)
  }

  let clean: BooruPost[] = []
  if (src.type === 'booruorg') {
    // Single tagless fetch; check all variants against the page's posts in memory.
    for (const v of queryVariants(req.tags)) {
      clean = sanitize(parsed, v)
      if (clean.length > 0) break
    }
  } else {
    clean = sanitize(parsed, variant)
  }
  return { posts: clean, sick: false }
}

/**
 * One pass over the DAPI/moebooru/HTML mirrors with the full→top2→single
 * variant ladder. Page ids re-roll every pass, so a second (deep) pass
 * probes different pages. Returns a fresh hit or null.
 *
 * Mirrors are still tried in health order, but the ladder WITHIN a mirror is
 * raced rather than walked: the widest query usually wins, and when it does
 * not the narrower fallbacks were being awaited one after another for up to
 * 3x TIMEOUT_MS. Racing them cuts the per-mirror worst case to one timeout
 * and lets a narrow variant win early when the wide one is merely slow.
 */
async function dapiPass(
  req: BooruRequest,
  tally: { parsed: number; fresh: number },
  budget?: RoundBudget,
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
    if (budget?.expired()) return null
    // booru.org subdomains are tagless and dedicated to niche themes;
    // querying once avoids hammering *.booru.org with redundant requests.
    const variants = src.type === 'booruorg' ? [req.tags] : queryVariants(req.tags)

    // Race the ladder instead of walking it. Combo queries frequently return
    // nothing for the full tag set, and walking meant paying TIMEOUT_MS again
    // for each narrower fallback before the mirror could contribute at all.
    // Racing costs at most `variants.length` concurrent requests to ONE mirror
    // and cuts its worst case from N x TIMEOUT_MS to a single timeout.
    // fetchVariant records its own health verdict, so the race only has to pick
    // a winner: the first attempt that actually yields posts.
    const clean = await firstWithPosts(
      variants.map((variant) =>
        fetchVariant(src, variant, req, budget, isProbe, pid, neg)
          .then((r) => r.posts)
          .catch(() => null),
      ),
    )
    if (budget?.expired()) return null
    if (!clean || clean.length === 0) continue
    const fresh = rememberCounted(clean, tally, req.tags, req.silent)
    // All repeats: a later pass over a different page may still be new, so keep
    // going rather than treating this mirror as exhausted.
    if (fresh.length === 0) continue
    unhealthyUntil.delete(src.id)
    return { posts: fresh, source: src.id, ok: true }
  }
  return null
}

/**
 * Resolve to the first attempt that yields a non-empty result, or null once
 * every attempt has settled with nothing.
 *
 * Deliberately does NOT return early on the first *settlement*: a variant that
 * answers "nothing here" must not beat a sibling that is about to answer with
 * posts, or racing would make a slow good answer lose to a fast empty one.
 */
export async function firstWithPosts(
  attempts: Array<Promise<BooruPost[] | null | undefined>>,
): Promise<BooruPost[] | null> {
  if (attempts.length === 0) return null
  if (attempts.length === 1) return (await attempts[0]) ?? null
  return new Promise<BooruPost[] | null>((resolve) => {
    let pending = attempts.length
    let settled = false
    for (const attempt of attempts) {
      attempt.then(
        (posts) => {
          if (settled) return
          if (posts && posts.length > 0) {
            settled = true
            resolve(posts)
            return
          }
          if (--pending === 0) {
            settled = true
            resolve(null)
          }
        },
        () => {
          // fetchVariant already recorded the health verdict; a rejection here
          // is just this variant being unusable.
          if (--pending === 0 && !settled) {
            settled = true
            resolve(null)
          }
        },
      )
    }
  })
}

/**
 * Redgifs → Babesource → imhentai → paheal fallback chain, then non-stop
 * handling: one deep DAPI re-pass on seen-exhaustion, else an emptyFresh
 * verdict (gentle) or an offline throw (true outage).
 *
 * The chain is a sequence of SCRAPERS — each of which fans out into its own
 * multi-request crawl — so it is the part of a round most able to run away.
 * Every stage checks the round budget before starting, and the fetches inside
 * inherit it.
 */
async function dapiFallbacks(
  req: BooruRequest,
  tally: { parsed: number; fresh: number },
  allowReal: boolean,
  allowHentai: boolean,
  budget?: RoundBudget,
): Promise<BooruResponse> {
  // Redgifs (real/hardcore short mp4 loops + gifs), then Babesource (real
  // stills galleries), then imhentai (hentai gallery scrape), before the
  // paheal single-tag fallback. Long-form videos are dropped by postFilter
  // (duration metadata only) — short mp4 loops always stay.
  if (allowReal && isHealthy('redgifs-direct') && !budget?.expired()) {
    const rg = await redgifsDirect(req.tags, req.limit, budget)
    if (rg) {
      const fresh = rememberCounted(sanitize(rg, req.tags), tally, req.tags, req.silent)
      if (fresh.length > 0) {
        unhealthyUntil.delete('redgifs-direct')
        return { posts: fresh, source: 'redgifs-direct', ok: true }
      }
    } else {
      markUnhealthy('redgifs-direct')
    }
  }
  if (allowReal && isHealthy('babesource-direct') && !budget?.expired()) {
    try {
      const bs = await babesourceDirect(req.tags, req.limit, budget)
      if (bs.length > 0) {
        const fresh = rememberCounted(sanitize(bs, req.tags), tally, req.tags, req.silent)
        if (fresh.length > 0) {
          unhealthyUntil.delete('babesource-direct')
          return { posts: fresh, source: 'babesource-direct', ok: true }
        }
      }
      // Empty (rare query, single-page search, all repeats) is NOT a sick
      // mirror — only hard failures (thrown below) cool the source down.
    } catch {
      // A deadline abort is not a sick mirror: do not shrink the pool because
      // the player stopped waiting.
      if (!isDeadlineAbort(undefined, budget)) markUnhealthy('babesource-direct')
    }
  }
  if (allowHentai && isHealthy('imh-direct') && !budget?.expired()) {
    try {
      const scraped = await imhentaiDirect(req.tags, req.limit, budget)
      // Empty gallery results are NOT a sick mirror (Cloudflare may simply
      // have challenged this round) — only hard failures cool it down.
        const fresh = rememberCounted(sanitize(scraped, req.tags), tally, req.tags, req.silent)
      if (fresh.length > 0) {
        unhealthyUntil.delete('imh-direct')
        return { posts: fresh, source: 'imh-direct', ok: true }
      }
    } catch {
      if (!isDeadlineAbort(undefined, budget)) markUnhealthy('imh-direct')
    }
  }
  // paheal only answers single tags — use the leading one. Pages rotate
  // without replacement (unpainted page param = same newest posts forever).
  const single = req.tags.split(/\s+/).filter(Boolean)[0]
  if (allowHentai && single && isHealthy('paheal-direct') && !budget?.expired()) {
    try {
      const url = `/booru/paheal/api/danbooru/find_posts?tags=${encodeURIComponent(single)}&limit=${req.limit}&page=${drawFreshPage(`paheal::${single}`, 5)}`
      const { signal } = withRequestTimeout(TIMEOUT_MS, budget)
      const res = await fetch(url, { signal })
      if (!res.ok) {
        markUnhealthy('paheal-direct')
      } else {
        const clean = sanitize(parsePaheal(await res.text()), single)
        const fresh = rememberCounted(clean, tally, single, req.silent)
        if (fresh.length > 0) {
          unhealthyUntil.delete('paheal-direct')
          return { posts: fresh, source: 'paheal-direct', ok: true }
        }
      }
    } catch {
      if (!isDeadlineAbort(undefined, budget)) markUnhealthy('paheal-direct')
    }
  }
  // Deepen (non-stop feed): mirrors answered but everything was already seen,
  // so re-roll the page ids and try ONCE more. One pass, not two — a second
  // pass costs a whole extra sweep of every mirror and, for a pool that is
  // genuinely exhausted, produces nothing. The round budget gates this too, so
  // a slow round never deepens at all.
  // parsed === 0 means true outage: never deepen dead mirrors.
  if (tally.parsed > 0 && tally.fresh === 0 && !budget?.expired()) {
    const deep = await dapiPass(req, tally, budget)
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
export async function redgifsDirect(
  query: string,
  limit: number,
  budget?: RoundBudget,
): Promise<BooruPost[] | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    // A 401 retry is worth a second go; a spent round budget is not.
    if (budget?.expired()) return null
    try {
      const token = await ensureRedgifsToken()
      if (!token) return null
      // 1. Niche-targeted attempt (query-aware). Niche posts are tagged
      // with the matched query tokens so matchesQuery actually matches.
      try {
        const niche = await redgifsNicheForQuery(query, token, budget)
        if (niche) {
          const page = drawFreshPage(`rg::${query}`, 5)
          const res = await fetchRedgifsAuthed(
            toProxy(redgifsNicheGifsUrl(niche.id, limit, page), REDGIFS_API, '/rg-auth'),
            token,
            budget,
          )
          if (res.ok) {
            const posts = parseRedgifs(await res.json())
            // Stamp query tags ONLY on full-token niche↔query agreement (a
            // stale-cached fragment-elected niche must not launder foreign
            // posts through matchesQuery) — otherwise native tags face
            // sanitize alone.
            const tagged = redgifsNicheMatchesQuery(niche, query)
              ? withRedgifsQueryTags(posts, query)
              : posts
            if (tagged.length > 0) return tagged
          }
        }
      } catch (e) {
        if (e instanceof RedgifsAuthExpired) continue
        /* niche lookup is best-effort — fall through to generic */
      }
      // 2. Generic trending fallback (query-blind upstream, untagged posts).
      if (budget?.expired()) return null
      const page = drawFreshPage(`rg::${query}`, 5)
      const url = toProxy(redgifsSearchUrl(query, limit, page), REDGIFS_API, '/rg-auth')
      const res = await fetchRedgifsAuthed(url, token, budget)
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

async function fetchRedgifsAuthed(
  url: string,
  token: string,
  budget?: RoundBudget,
): Promise<Response> {
  const { signal } = withRequestTimeout(TIMEOUT_MS, budget)
  const res = await fetch(url, {
    signal,
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

/**
 * How many niche lookups a single uncached query may make.
 *
 * Candidates are the query itself plus every query token, each costing a
 * TIMEOUT_MS request, and that set is UNCAPPED — a five-word query meant six
 * sequential requests (~21s) just to decide which niche to browse, before a
 * single gif was fetched. The full query is tried first and matches the niche
 * most of the time; the tokens are only there to rescue a phrasing the niche
 * search did not recognise, so a couple is plenty. Results are cached for an
 * hour either way, so a cap costs one broader fallback, not correctness.
 */
const REDGIFS_NICHE_MAX_CANDIDATES = 3

async function redgifsNicheForQuery(
  query: string,
  token: string,
  budget?: RoundBudget,
): Promise<RedgifsNiche | null> {
  const key = query.trim().toLowerCase()
  if (!key) return null
  const cached = redgifsNicheCache.get(key)
  if (cached && Date.now() < cached.exp) return cached.niche
  const candidates = [...new Set([key, ...redgifsQueryTags(query).map((t) => t.replace(/_/g, ' '))])].slice(
    0,
    REDGIFS_NICHE_MAX_CANDIDATES,
  )
  for (const q of candidates) {
    if (budget?.expired()) break
    try {
      const { signal } = withRequestTimeout(TIMEOUT_MS, budget)
      const res = await fetch(toProxy(redgifsNicheSearchUrl(q), REDGIFS_API, '/rg-auth'), {
        signal,
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

/** Tag niche-sourced posts with the query they actually answered.
 *  Normalized query tokens verbatim — NOT redgifsQueryTags, which splits into
 *  niche-name words: stamping `skylar` on a result the query asked for as
 *  `skylar_vox` made strict AND validation discard the provider's own hits. */
function withRedgifsQueryTags(posts: BooruPost[], query: string): BooruPost[] {
  const tags = [...new Set(parseQuery(query).required)]
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
export async function babesourceDirect(
  query: string,
  limit: number,
  budget?: RoundBudget,
): Promise<BooruPost[]> {
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
      const { signal } = withRequestTimeout(HTML_TIMEOUT_MS, budget)
      searchRes = await fetch(searchUrl, { signal })
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
  const searchHtmls: string[] = [firstHtml]
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
  // Variety: extra random search pages until the gallery set is full or
  // pages run out. Up to two extra DISTINCT pages (page memory keeps rounds
  // off already-crawled pages) — page 1 alone re-serves the same galleries.
  // Skipped entirely once the round budget is gone: the cover fallback below
  // can still land real images from the page we already have.
  const maxPage = Math.min(parseBabesourceMaxPage(firstHtml), 5)
  if (maxPage > 1 && galleryUrls.length < GALLERY_CAP && !budget?.expired()) {
    const extra = new Set<number>()
    for (let i = 0; i < 6 && extra.size < 2; i++) {
      extra.add(Math.max(2, drawFreshPage(`babe::${slug}`, maxPage)))
    }
    const more = await mapLimit([...extra].sort((a, b) => a - b), GALLERY_LANES, fetchSearchPage)
    for (const html of more) {
      if (html !== null) {
        searchHtmls.push(html)
        collect(html)
      }
    }
  }
  if (galleryUrls.length === 0) return []
  // Every gallery contributes: bounded lanes expand in parallel, then images
  // round-robin across galleries so one gallery can't fill the batch alone.
  const perGallery = Math.max(1, Math.ceil(limit / galleryUrls.length))
  const sets = await mapLimit(galleryUrls, GALLERY_LANES, async (gUrl) => {
    if (budget?.expired()) return undefined
    try {
      const { signal } = withRequestTimeout(HTML_TIMEOUT_MS, budget)
      const gRes = await fetch(toProxy(gUrl, BABESOURCE_ROOT, '/booru/babe'), { signal })
      if (!gRes.ok || typeof gRes.text !== 'function') return undefined
      const gHtml = await gRes.text()
      const images = parseBabesourceGallery(gHtml, perGallery)
      if (images.length === 0) return undefined
      return toBabesourcePosts(gUrl, images, query, parseBabesourceTags(gHtml))
    } catch {
      return undefined /* one dead gallery never kills the round */
    }
  })
  const expanded = roundRobin(sets, limit)
  if (expanded.length > 0) return expanded
  // Gallery expansion died (slow/blocked gallery pages) but search HTML
  // arrived: fall back to search-page covers rewritten to exact fulls —
  // real image files, never thumbs-as-url.
  const seenCover = new Set<string>()
  const coverImages: BabesourceImage[] = []
  for (const html of searchHtmls) {
    for (const img of parseBabesourceCovers(html, limit)) {
      if (coverImages.length >= limit) break
      if (seenCover.has(img.url)) continue
      seenCover.add(img.url)
      coverImages.push(img)
    }
    if (coverImages.length >= limit) break
  }
  return toBabesourceCoverPosts(coverImages, query)
}

/**
 * imhentai via the Vite dev proxy: search page → gallery IDs → covers plus
 * full-book expansion so one round returns several image sets, not one
 * cover. Never throws.
 */
async function imhentaiDirect(
  query: string,
  limit: number,
  budget?: RoundBudget,
): Promise<BooruPost[]> {
  try {
    const { signal: searchSignal } = withRequestTimeout(HTML_TIMEOUT_MS, budget)
    const searchRes = await fetch(toProxy(imhentaiSearchUrl(query), IMHENTAI_ROOT, '/booru/imh'), {
      signal: searchSignal,
    })
    if (!searchRes.ok || typeof searchRes.text !== 'function') return []
    const html = await searchRes.text()

    // 1. Gallery entries from the search page. Enter EACH gallery: the
    // search cover is only a thumbnail — the real page extensions live in
    // the gallery's ext map (a book may ship .webp while a blind
    // thumb->1.jpg rewrite 404s). Covers stay as the fallback for galleries
    // whose page fetch fails (CF burst/403) so the round still lands posts.
    const results = parseImhentaiSearchResults(html, GALLERY_CAP)
    // Links without an inline cover (sparse markup): still enter them.
    const entries = results.length > 0
      ? results
      : parseImhentaiSearch(html, GALLERY_CAP).map((id) => ({ id, coverUrl: '' }))
    if (entries.length === 0) return []
    const perGallery = Math.max(1, Math.ceil(limit / Math.min(entries.length, GALLERY_LANES)))
    const sets = await mapLimit(entries, GALLERY_LANES, async ({ id }) => {
      if (budget?.expired()) return undefined
      try {
        const { signal } = withRequestTimeout(HTML_TIMEOUT_MS, budget)
        const gRes = await fetch(toProxy(imhentaiGalleryUrl(id), IMHENTAI_ROOT, '/booru/imh'), { signal })
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
    const expanded = roundRobin(sets, limit)
    if (expanded.length > 0) return expanded
    // Every entry failed: fall back to the search-page covers (thumb -> 1.x
    // rewrite; a wrong-extension cover is one broken image, not a dead feed).
    return results
      .slice(0, limit)
      .map((r) => toImhentaiPost(r.id, { url: r.coverUrl, width: 0, height: 0 }, query))
      .filter((p) => p.url && !/\/(?:thumb|thumbs)(?:[?#/.]|$)/i.test(p.url))
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
  // No renderer-side result cache, deliberately. Every call site opts out of
  // memoization on purpose: probes and the tag market pass silent/probe (a
  // validation read must never be cached) and the feed passes fresh:true so the
  // idle loop keeps drawing new pictures. Replaying a cached response would
  // also bypass the seen-ledger that stops the same image coming back.
  // Reuse lives where it already does: the main-process feed memo, which only
  // serves non-fresh reads.
  return fetchPostsUncached(req)
}

async function fetchPostsUncached(req: BooruRequest): Promise<BooruResponse> {
  const offline: BooruResponse = { posts: [], source: null, ok: false, offline: true }
  if (!req.tags.trim() || isQueryBlocked(req.tags)) return offline
  // Stage timing so the per-split cost of a round is measurable rather than
  // guessed. Read it with readQueryTimings()/timingSummary().
  const round = startRound(req.tags)
  try {
    if (typeof window !== 'undefined' && window.gmatch?.booruFetch) {
      // An IPC invoke cannot be cancelled once sent, so the round deadline is
      // applied HERE as a wait, not as an abort: if main has not answered by
      // the budget we stop waiting and report offline. Main applies the same
      // ceiling to its own source walk, so the abandoned round is already on
      // its way out rather than still burning the network.
      const budget = startRoundBudget()
      const t0 = Date.now()
      const res = await Promise.race([
        window.gmatch.booruFetch(req),
        budget.signal.aborted
          ? Promise.reject(new DOMException('round deadline', 'TimeoutError'))
          : new Promise<never>((_, reject) => {
              budget.signal.addEventListener('abort', () => reject(budget.signal.reason), { once: true })
            }),
      ]).catch(() => null)
      markStage(round, 'request', Date.now() - t0)
      budgetDispose(budget)
      if (!res) {
        endRound(round)
        return { ...offline }
      }
      if (res.ok) {
        const fetched = res.posts || []
        const f0 = Date.now()
        if (req.silent) {
          // Validation-only: checked, never memoized (see BooruRequest.silent).
          const clean = sanitize(fetched, req.tags)
          markStage(round, 'filter', Date.now() - f0)
          endRound(round)
          return clean.length > 0 ? { ...res, posts: clean } : { ...offline }
        }
        const fresh = remember(sanitize(fetched, req.tags), req.tags)
        markStage(round, 'filter', Date.now() - f0)
        endRound(round)
        if (fresh.length > 0) {
          emptyStreak = 0
          return { ...res, posts: fresh }
        }
        return emptyRound(fetched.length, req.limit, res, req.tags)
      }
      endRound(round)
      return { ...offline }
    }
    const t1 = Date.now()
    const res = await directFetch(req)
    markStage(round, 'request', Date.now() - t1)
    endRound(round)
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
  fresh?: boolean
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
        fresh: req.fresh,
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
