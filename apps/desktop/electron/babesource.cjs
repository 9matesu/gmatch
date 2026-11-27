// babesource: real-photo galleries (full-res stills, never thumbs). Extracted
// from main.cjs with injected deps so the parsers are unit-testable.

function createBabesourceSource(deps) {
  const { httpGet, htmlTimeoutMs, galleryCap, galleryLanes, mapLimit, roundRobinPosts, hasBadTag, normRedgifsTag } = deps
  const HTML_TIMEOUT_MS = htmlTimeoutMs
  const GALLERY_CAP = galleryCap
  const GALLERY_LANES = galleryLanes

  // --- babesource (real porn photo galleries: full-res stills, never thumbs) --
  // Search: /search/<slug>/page<N>.html -> /galleries/<slug>-<id>.html (skip /video/)
  // Gallery: <a class="slideshowGalleryImage" href=FULL(babesource.com/media/...)>
  //          with thumb <img src>(media.babesource.com/.../thumbs/...).
  const BABESOURCE_ROOT = 'https://babesource.com'
  
  function babesourceSlug(query) {
  return String(query || '')
    .replace(/_/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  }
  
  function babesourceThumbToFull(thumb) {
  const m = /^https:\/\/media\.babesource\.com\/galleries\/([0-9a-f]+)\/thumbs\/(?:300x406\/)?(.+\.(?:jpe?g|png|webp|gif))$/i.exec(
    String(thumb || '').trim(),
  )
  if (!m) return null
  return `https://babesource.com/media/galleries/${m[1]}/${m[2]}`
  }
  
  function parseBabesourceSearch(html, limit) {
  const out = []
  if (!html || typeof html !== 'string') return out
  const re = /href="(https:\/\/babesource\.com\/galleries\/[^"]+?-(\d+)\.html)"/gi
  let m
  while ((m = re.exec(html))) {
    if (m[1].includes('/video/')) continue
    if (!out.includes(m[1])) out.push(m[1])
    if (out.length >= limit) break
  }
  return out
  }
  
  function parseBabesourceMaxPage(html) {
  if (!html || typeof html !== 'string') return 1
  let max = 1
  const re = /href=["']page(\d+)\.html["']/gi
  let m
  while ((m = re.exec(html))) {
    const n = Number(m[1])
    if (Number.isFinite(n) && n > max) max = Math.min(n, 50)
  }
  return Math.max(1, max)
  }
  
  function parseBabesourceGallery(html, limit) {
  const out = []
  const seen = new Set()
  if (!html || typeof html !== 'string') return out
  const isFull = (u) => /^https:\/\/babesource\.com\/media\/galleries\/[0-9a-f]+\/.+\.(?:jpe?g|png|webp|gif)$/i.test(u)
  const push = (url, preview) => {
    if (!isFull(url) || seen.has(url)) return
    seen.add(url)
    out.push({ url, preview: /^https:\/\/media\.babesource\.com\/galleries\//i.test(preview) ? preview : url })
  }
  let m
  const anchorRe = /<a[^>]*class="[^"]*slideshowGalleryImage"[^>]*href="([^"]+)"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"[^>]*>/gi
  while ((m = anchorRe.exec(html))) {
    push(m[1], m[2])
    if (out.length >= limit) return out
  }
  if (out.length === 0) {
    const thumbRe = /https:\/\/media\.babesource\.com\/galleries\/[0-9a-f]+\/thumbs\/(?:300x406\/)?[^"'\s]+\.(?:jpe?g|png|webp|gif)/gi
    while ((m = thumbRe.exec(html))) {
      const full = babesourceThumbToFull(m[0])
      if (full) push(full, m[0])
      if (out.length >= limit) return out
    }
  }
  return out
  }
  
  /**
   * Real tags for a babesource gallery: its own meta keywords / search links.
   *
   * The query used to be split into sub-words and unioned in, which meant every
   * gallery the search returned was stamped as if it carried the tag — so
   * `matchesQuery` passed by construction and a loosely-related gallery was
   * indistinguishable from an exact one. Now the gallery's own keywords decide,
   * and the query is only a fallback (as ONE whole token) for a page that
   * publishes none.
   */
  function parseBabesourceTags(html, query) {
  const tags = new Set()
  if (html && typeof html === 'string') {
    const meta = /<meta\s+name="keywords"\s+content="([^"]*)"/i.exec(html)
    if (meta) {
      for (const part of meta[1].split(',')) {
        const n = part.trim().toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '')
        if (n.length >= 2) tags.add(n)
      }
    }
    // Gallery pages link to their own performers/search facets.
    const linkRe = /href="https:\/\/babesource\.com\/(?:pornstars?|search)\/([^"/?#]+)\/?"/gi
    let m
    while ((m = linkRe.exec(html)) !== null) {
      const n = normRedgifsTag(decodeURIComponent(m[1]))
      if (n) tags.add(n)
    }
  }
  if (tags.size === 0) {
    // No tags published: attest the search itself, as ONE whole token.
    const q = normRedgifsTag(String(query || '').replace(/[\s-]+/g, '_'))
    if (q) tags.add(q)
  }
  return [...tags]
  }
  
  async function fetchBabesource(variant, n) {
  const slug = babesourceSlug(variant)
  if (!slug) return []
  // Page-1 first; higher pages only when pagination advertises them.
  // Single-page queries 404 on page2+ — normal, not a failure.
  let searchBody
  try {
    searchBody = await httpGet(`${BABESOURCE_ROOT}/search/${encodeURIComponent(slug)}/page1.html`, undefined, HTML_TIMEOUT_MS)
  } catch (e) {
    if (/HTTP 404/.test(String((e && e.message) || e))) return []
    throw e
  }
  const seen = new Set()
  const galleries = []
  const collect = (html) => {
    for (const u of parseBabesourceSearch(html, GALLERY_CAP)) {
      if (!seen.has(u)) {
        seen.add(u)
        galleries.push(u)
      }
    }
  }
  collect(searchBody)
  const searchBodies = [searchBody]
  const maxPage = Math.min(parseBabesourceMaxPage(searchBody), 5)
  if (maxPage > 1 && galleries.length < GALLERY_CAP) {
    // Up to two extra distinct random pages — page 1 alone re-serves the
    // same galleries every round. Mirrors services/booru.ts.
    const extra = new Set()
    for (let i = 0; i < 6 && extra.size < 2; i++) {
      extra.add(Math.max(2, 1 + Math.floor(Math.random() * maxPage)))
    }
    for (const page of [...extra].sort((a, b) => a - b)) {
      try {
        const body = await httpGet(`${BABESOURCE_ROOT}/search/${encodeURIComponent(slug)}/page${page}.html`, undefined, HTML_TIMEOUT_MS)
        searchBodies.push(body)
        collect(body)
      } catch {
        /* stale pagination link — page-1 results still stand */
      }
    }
  }
  if (galleries.length === 0) return []
  // Every gallery contributes: bounded lanes expand in parallel, then images
  // round-robin across galleries so one gallery can't fill the batch alone.
  const perGallery = Math.max(1, Math.ceil(n / galleries.length))
  const sets = await mapLimit(galleries, GALLERY_LANES, async (gUrl) => {
    try {
      const gHtml = await httpGet(gUrl, undefined, HTML_TIMEOUT_MS)
      const tags = parseBabesourceTags(gHtml, variant)
      if (hasBadTag(tags)) return undefined
      const idMatch = /-(\d+)\.html?(?:[?#]|$)/.exec(gUrl)
      const gid = idMatch ? idMatch[1] : 'x'
      const images = parseBabesourceGallery(gHtml, perGallery)
      if (images.length === 0) return undefined
      return images.map((img, i) => ({ id: `bs-${gid}-${i}`, url: img.url, preview: img.preview, tags, rating: undefined, kind: 'image' }))
    } catch {
      return undefined /* one dead gallery never kills the round */
    }
  })
  const expanded = roundRobinPosts(sets, n)
  if (expanded.length > 0) return expanded
  // Gallery expansion died but search HTML arrived: fall back to
  // search-page covers rewritten to exact fulls (never thumbs-as-url).
  // Mirrors services/booru.ts.
  const seenCover = new Set()
  const covers = []
  const coverRe = /https:\/\/media\.babesource\.com\/galleries\/[0-9a-f]+\/thumbs\/(?:300x406\/)?[^"']+?\.(?:jpe?g|png|webp|gif)/gi
  for (const body of searchBodies) {
    let m
    while ((m = coverRe.exec(body))) {
      const full = babesourceThumbToFull(m[0])
      if (!full || seenCover.has(full)) continue
      seenCover.add(full)
      const h = /\/galleries\/([0-9a-f]+)\//i.exec(m[0])
      covers.push({
        id: `bs-c-${h ? h[1] : 'x'}-${covers.length}`,
        url: full,
        preview: m[0],
        tags: parseBabesourceTags(null, variant),
        // No rating asserted: this source cannot report one. The renderer gate fails
        // closed without an explicit no-rating-channel declaration.
        rating: undefined,
        kind: 'image',
      })
      if (covers.length >= n) break
    }
    if (covers.length >= n) break
  }
  return covers
  }

  return { fetch: fetchBabesource, _parsers: { parseBabesourceSearch, parseBabesourceMaxPage, parseBabesourceGallery, parseBabesourceTags, babesourceSlug, babesourceThumbToFull } }
}

module.exports = { createBabesourceSource }
