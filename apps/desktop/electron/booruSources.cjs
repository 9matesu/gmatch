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

function createFetchBooru({ sources, httpGet, cache, blocked = () => false }) {
  let rrIndex = 0
  return async function fetchBooru({ tags, limit, allowReal, allowHentai, fresh }) {
    const query = String(tags ?? '').trim()
    const n = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100)
    if (!query || blocked(query)) {
      return { posts: [], source: null, ok: false, error: 'blocked-or-empty query' }
    }

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
    for (const source of ordered) {
      for (const variant of variants) {
        try {
          const posts = source.fetch
            ? await source.fetch(variant, n)
            : source.parse(await httpGet(source.url(variant, n)))
          if (posts && posts.length > 0) {
            rrIndex = (pool.indexOf(source) + 1) % pool.length
            cache?.setFeedCache?.(variant, posts)
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

module.exports = { createFetchBooru, queryVariants }
