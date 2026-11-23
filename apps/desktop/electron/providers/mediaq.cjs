'use strict'

/**
 * ContentProvider adapter for a self-hosted mediaq REST instance (mediaq 0.1.0).
 *
 * The wire schema lives HERE and only here. The search mechanism
 * (`booruSources.cjs`) sees the ContentProvider contract
 * ({ id, capabilities, fetch }); it never learns that mediaq exists, what a
 * SearchItem is, or which sites it covers.
 *
 * Contract, pinned from the mediaq 0.1.0 source (core/models.py, api/routes):
 *   POST /search  SearchRequest -> SearchResult
 *     SearchRequest { query, sites?: string[], kinds?, filters?: { sort, ... },
 *                     page=1, pages=1..5, limit?, strict=false }
 *     SearchResult  { request, items: MediaItem[], errors, warnings, pages_fetched }
 *     MediaItem     { site, kind, id, title, page_url, thumb_url?, preview_url?,
 *                     tags: string[], sources: MediaSource[], ... }
 *   GET  /health  -> { status, version, sites, active_jobs }
 */

// The request subset per category. Fewer sites = a faster answer; mediaq's own
// config decides which of them are enabled, and this list decides which we ask
// for. Real tube sites for 'real', hentai/booru for 'hentai'.
const REAL_SITES = ['pornhub', 'xvideos', 'xnxx']
const HENTAI_SITES = ['nhentai', 'rule34', 'gelbooru']

// A search is a fallback, not the fast path: local mirrors usually win the race.
// This bound only matters when mediaq is the only source with results.
const SEARCH_TIMEOUT_MS = 5_000

// isPostAllowed (renderer) and the main gate require a known media extension;
// mediaq thumbs usually carry one, but an extensionless CDN url must be dropped
// rather than shown broken.
const MEDIA_EXT = /\.(jpe?g|png|gif|webp|mp4|webm)(?:[?#]|$)/i

/**
 * Map one mediaq MediaItem to the internal BooruPost model. Pure + exported so
 * the mapping is unit-tested against a frozen SearchResult fixture.
 * @param {any} item
 * @returns {null | { id: string, url: string, tags: string[], rating: string, preview?: string, source_url?: string }}
 */
function toBooruPost(item) {
  if (!item || typeof item !== 'object') return null
  const url = item.thumb_url || item.preview_url
  if (typeof url !== 'string' || !url || !MEDIA_EXT.test(url)) return null
  const site = typeof item.site === 'string' && item.site ? item.site : 'x'
  const id = item.id != null ? String(item.id) : Math.random().toString(36).slice(2, 10)
  const tags = Array.isArray(item.tags) ? item.tags.filter((t) => typeof t === 'string' && t) : []
  /** @type {any} */
  const post = {
    id: `mq-${site}-${id}`,
    url,
    tags,
    // mediaq indexes adult sites only; the booru gate requires an explicit rating.
    rating: 'explicit',
  }
  const preview = item.preview_url || item.thumb_url
  if (typeof preview === 'string' && preview && preview !== url) post.preview = preview
  if (typeof item.page_url === 'string' && item.page_url) post.source_url = item.page_url
  return post
}

/**
 * @param {{ baseUrl: string, postJson: (url: string, body: any, timeoutMs?: number, signal?: AbortSignal) => Promise<any>, timeoutMs?: number }} deps
 * @returns {import('./contentProvider.cjs').ContentProvider}
 */
function createMediaqProvider({ baseUrl, postJson, timeoutMs = SEARCH_TIMEOUT_MS }) {
  const root = String(baseUrl || '').replace(/\/+$/, '')
  return {
    id: 'mediaq',
    // A single POST — a fast-phase provider (races with local mirrors).
    kind: 'mediaq',
    // One provider, two categories — never duplicated per category.
    capabilities: { categories: ['real', 'hentai'], tagSupport: 'unknown' },
    async fetch(variant, n, opts = {}) {
      const query = String(variant || '').trim()
      if (!query || !root) return []
      const sites = []
      if (opts.allowReal !== false) sites.push(...REAL_SITES)
      if (opts.allowHentai !== false) sites.push(...HENTAI_SITES)
      if (sites.length === 0) return []
      const limit = Math.min(Math.max(parseInt(n, 10) || 10, 1), 50)
      const body = {
        query,
        sites,
        page: 1,
        pages: 1,
        limit,
        filters: { sort: 'relevance' },
      }
      // postJson throws on transport/HTTP error — the mechanism reads that as a
      // provider failure, cools it (circuit breaker) and falls back to local
      // sources. A mediaq that is not running therefore costs one attempt per
      // cooldown, not an error the user sees.
      const res = await postJson(`${root}/search`, body, timeoutMs, opts.signal)
      const items = res && Array.isArray(res.items) ? res.items : []
      const out = []
      for (const item of items) {
        const post = toBooruPost(item)
        if (post) out.push(post)
        if (out.length >= limit) break
      }
      return out
    },
  }
}

module.exports = { createMediaqProvider, toBooruPost, REAL_SITES, HENTAI_SITES, SEARCH_TIMEOUT_MS }