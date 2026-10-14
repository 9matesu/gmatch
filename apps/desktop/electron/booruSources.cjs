// Provider query ladder for the idle feed, extracted from main.cjs so the
// cache-read path is testable without booting Electron. Pure orchestration:
// sources, httpGet and the feed memo are all injected.
//
// Relevance contract: a source may only answer a query it can genuinely match.
// If it cannot, it returns nothing and the round moves on. This module never
// substitutes one source's content for another's query.
//
// The round's concurrency primitive (firstAnswer) lives in
// ./booru-sources-core.cjs, shared with its tests; the renderer has the same
// primitive in src/services/booru/concurrency.ts and the two must behave
// identically — see BOORU-API.md §9 invariant 0d.
const { firstAnswer } = require('./booru-sources-core.cjs')

function queryVariants(query) {
  const parts = String(query).split(/\s+/).filter(Boolean)
  const variants = [query]
  if (parts.length > 2) variants.push(parts.slice(0, 2).join(' '))
  if (parts.length > 1) variants.push(parts[0])
  return [...new Set(variants)]
}

// Hard ceiling for ONE source walk, mirroring ROUND_DEADLINE_MS in
// src/services/booru.ts.
//
// The loop below is a nested sequential walk: every mirror x every query
// variant, each awaiting its own httpGet timeout, and a gallery scraper can
// fan out into a dozen more. With 14 sources and 3 variants that is a request
// sequence minutes long. The renderer stops waiting at the same deadline
// (see fetchPosts), so this is the matching stop-work side of that bargain:
// without it an abandoned round would keep hammering mirrors for the rest of
// its walk.
const ROUND_DEADLINE_MS = 8_000

// Concurrency for the source race. Races every source at once would be a burst
// of 14 simultaneous requests to hosts that rate-limit by IP — and one slow
// mirror would then consume a slot for the whole round. A small window keeps the
// per-round cost roughly what the sequential walk cost at its best (the first
// healthy source usually answers), while making the worst case ONE timeout
// instead of "source after source, each paying its own".
const RACE_WIDTH = 4

// Mirror health. The renderer has always had this (unhealthyUntil +
// COOLDOWN_HARD_MS in src/services/booru.ts); main did NOT, so a dead mirror
// was re-attempted every single round, holding a race lane and part of the
// budget for nothing. That is a large part of why rounds felt slow and flaky:
// the round paid for dead mirrors forever.
//
// A round deadline is NOT a mirror failure — running out of the shared budget
// must not cool a source (see isDeadlineReached).
const COOLDOWN_HARD_MS = 60_000
// booru.org subdomains share an IP rate limit, so one 429 condemns all of them.
const COOLDOWN_429_MS = 300_000

// Fast (single request) sources vs multi-fetch HTML scrapers. The scrapers
// exist to answer, not to compete: racing them beside tbib meant an 8s
// imhentai gallery crawl could occupy lanes and budget while a mirror that
// answers in 300ms was never started. Two phases keep the cheap answer cheap.
const FAST_PHASE = new Set(['dapi', 'moebooru', 'paheal', 'redgifs', 'realhtml', 'booruorg'])

function createFetchBooru({ sources, httpGet, cache, blocked = () => false, deadlineMs = ROUND_DEADLINE_MS }) {
  let rrIndex = 0
  // sourceId -> timestamp until which it is skipped.
  const unhealthyUntil = new Map()

  const isCooling = (id) => {
    const until = unhealthyUntil.get(id)
    if (!until) return false
    if (Date.now() >= until) { unhealthyUntil.delete(id); return false }
    return true
  }
  const cool = (source, ms) => {
    const id = source && source.id
    if (!id) return
    unhealthyUntil.set(id, Date.now() + (ms || COOLDOWN_HARD_MS))
    if (source.kind === 'booruorg') {
      // Shared-IP rate limit: a 429 on one sub is a 429 on all of them.
      for (const s of sources) {
        if (s && s.kind === 'booruorg') unhealthyUntil.set(s.id, Date.now() + (ms || COOLDOWN_HARD_MS))
      }
    }
  }

  return async function fetchBooru({ tags, limit, allowReal, allowHentai, fresh, probe, page }) {
    const query = String(tags ?? '').trim()
    const n = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100)
    if (!query || blocked(query)) {
      return { posts: [], source: null, ok: false, error: 'blocked-or-empty query' }
    }
    // Probes (tag validation, page 0) need deterministic first pages, not a
    // random draw — mirrors the renderer's isProbe handling in dapiPass.
    const deterministic = probe === true || page === 0
    const fetchOpts = deterministic ? { deterministic: true } : undefined

    // READ the memo fetchBooru already writes if fresh isn't requested.
    // # ponytail: fresh=true bypasses 10-minute memo so idle loop gets new images
    const memo = !fresh ? cache?.getFeedCache?.(query) : null
    if (memo && memo.length > 0) {
      return { posts: memo, source: 'cache', ok: true, query, cached: true }
    }

    const useReal = allowReal !== false
    const useHentai = allowHentai !== false
    const filtered = sources.filter((s) => {
      if (s.category === 'real' && !useReal) return false
      if (s.category === 'hentai' && !useHentai) return false
      return true
    })
    // NO fallback to `sources` when the category filter empties the pool: the
    // player switched a category off and the toggle must actually hold. The
    // store already refuses to disable both at once, so an empty pool means
    // "nothing enabled here" — an honest empty round, not the disabled category.
    const pool = filtered
    if (pool.length === 0) {
      return { posts: [], source: null, ok: false, error: 'no enabled source for this category' }
    }
    const variants = queryVariants(query)
    const deadline = Date.now() + Math.max(0, deadlineMs || ROUND_DEADLINE_MS)

    const runPhase = async (candidates) => {
      const attempts = []
      for (const source of candidates) {
        for (const variant of variants) {
          // A thunk, not a started promise: firstAnswer decides whether this
          // attempt ever runs.
          attempts.push(async () => {
            // Out of time: stop starting new requests. In-flight ones are left
            // to finish (httpGet owns its own timeout) and their results
            // discarded.
            if (Date.now() >= deadline) return null
            try {
              const posts = source.fetch
                ? await source.fetch(variant, n, fetchOpts)
                : source.parse(await httpGet(source.url(variant, n)))
              // An empty answer is NOT a failure — this source simply has
              // nothing for this query. Do not cool it.
              return posts && posts.length > 0 ? { source, variant, posts } : null
            } catch (err) {
              // Distinguish "we ran out of budget" from "this mirror is unwell".
              // httpGet reports both as errors, and cooling a healthy mirror
              // because the round was slow is exactly the bug the renderer
              // already fixed.
              const msg = String((err && err.message) || err || '')
              if (/quality-gate timeout|aborted/i.test(msg)) {
                // Our own per-request budget, not the mirror's fault — but a
                // per-request timeout still means this host is slow enough to be
                // worth skipping for a while.
                cool(source, COOLDOWN_HARD_MS)
              } else if (/HTTP 429/.test(msg)) {
                cool(source, COOLDOWN_429_MS)
              } else {
                cool(source, COOLDOWN_HARD_MS)
              }
              return null
            }
          })
        }
      }
      if (attempts.length === 0) return { posts: null, meta: null }
      // firstAnswer stops STARTING attempts once one is accepted, which the old
      // stride loop could not: its losing lanes kept walking their remaining
      // attempts after the winner was already known, so a round that answered on
      // its first mirror could still spend the whole phase against the shared
      // booru.org rate limiter.
      const winner = await firstAnswer(attempts, RACE_WIDTH)
      return winner ? { posts: winner.posts, meta: winner } : { posts: null, meta: null }
    }

    const rotate = (arr) => arr.map((_, i) => arr[(rrIndex + i) % arr.length])

    // Phase 1: cheap single-request sources. Phase 2: the multi-fetch HTML
    // scrapers, and only if phase 1 found nothing AND budget remains.
    const live = pool.filter((s) => !isCooling(s.id))
    const fast = rotate(live.filter((s) => FAST_PHASE.has(s.kind)))
    const slow = rotate(live.filter((s) => !FAST_PHASE.has(s.kind)))

    let { posts: winner, meta } = await runPhase(fast)
    if (!winner && slow.length > 0 && Date.now() < deadline) {
      const second = await runPhase(slow)
      winner = second.posts
      meta = second.meta
    }

    if (winner && meta) {
      rrIndex = (pool.indexOf(meta.source) + 1) % pool.length
      // A success clears any cooldown — the mirror is demonstrably alive.
      unhealthyUntil.delete(meta.source.id)
      // Random round pages must NOT poison the tag slot: a memoized
      // random page would repeat for 10 minutes on probe/market reads.
      // Only deterministic (probe/page-0) results are memoized.
      if (!fresh) cache?.setFeedCache?.(meta.variant, winner)
      return { posts: winner, source: meta.source.id, ok: true, query: meta.variant }
    }

    // Nothing in time, or everything empty: a stale memo beats a bare failure.
    const stale = cache?.getFeedCache?.(query)
    if (stale && stale.length > 0) {
      return { posts: stale, source: 'cache', ok: true, query, cached: true, timedOut: true }
    }
    rrIndex = (rrIndex + 1) % pool.length
    return { posts: [], source: null, ok: false, timedOut: Date.now() >= deadline }
  }
}

module.exports = {
  createFetchBooru,
  queryVariants,
  ROUND_DEADLINE_MS,
  RACE_WIDTH,
  COOLDOWN_HARD_MS,
  COOLDOWN_429_MS,
  FAST_PHASE,
}
