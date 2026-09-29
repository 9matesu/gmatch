// Provider query ladder for the idle feed, extracted from main.cjs so the
// cache-read path is testable without booting Electron. Pure orchestration:
// sources, httpGet and the feed memo are all injected.
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

function createFetchBooru({ sources, httpGet, cache, blocked = () => false, deadlineMs = ROUND_DEADLINE_MS }) {
  let rrIndex = 0
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
    const pool = filtered.length > 0 ? filtered : sources
    const variants = queryVariants(query)
    const ordered = pool.map((_, i) => pool[(rrIndex + i) % pool.length])
    const deadline = Date.now() + Math.max(0, deadlineMs || ROUND_DEADLINE_MS)
    for (const source of ordered) {
      for (const variant of variants) {
        // Out of time: stop starting new requests. In-flight ones are left to
        // finish (httpGet owns its own timeout) and their results discarded.
        if (Date.now() >= deadline) {
          const stale = cache?.getFeedCache?.(query)
          if (stale && stale.length > 0) {
            return { posts: stale, source: 'cache', ok: true, query, cached: true, timedOut: true }
          }
          return { posts: [], source: null, ok: false, query, timedOut: true }
        }
        try {
          const posts = source.fetch
            ? await source.fetch(variant, n, fetchOpts)
            : source.parse(await httpGet(source.url(variant, n)))
          if (posts && posts.length > 0) {
            rrIndex = (pool.indexOf(source) + 1) % pool.length
            // Random round pages must NOT poison the tag slot: a memoized
            // random page would repeat for 10 minutes on probe/market reads.
            // Only deterministic (probe/page-0) results are memoized.
            if (!fresh) cache?.setFeedCache?.(variant, posts)
            return { posts, source: source.id, ok: true, query: variant }
          }
        } catch {
          // try next variant / source
        }
      }
    }
    rrIndex = (rrIndex + 1) % pool.length

    // Fallback to cache if providers all failed offline
    const fallback = cache?.getFeedCache?.(query)
    if (fallback && fallback.length > 0) {
      return { posts: fallback, source: 'cache', ok: true, query, cached: true }
    }

    return { posts: [], source: null, ok: false }
  }
}

module.exports = { createFetchBooru, queryVariants, ROUND_DEADLINE_MS }
