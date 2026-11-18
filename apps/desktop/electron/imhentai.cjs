// imhentai: galleries by scraping (no JSON API). Extracted from main.cjs so the
// parser can be unit-tested; every dependency is injected, so the module never
// reaches for main-process globals.

function createImhentaiSource(deps) {
  const {
    net, httpGet, ua, htmlTimeoutMs, galleryCap, galleryLanes, floorPx,
    redgifsWords, normRedgifsTag, hasBadTag, mapLimit, roundRobinPosts,
  } = deps
  const UA = ua
  const HTML_TIMEOUT_MS = htmlTimeoutMs
  const GALLERY_CAP = galleryCap
  const GALLERY_LANES = galleryLanes
  const FLOOR_PX = floorPx

  // --- imhentai (hentai galleries: captions, hardcore doujins) ------------------
  // No JSON API — scrape HTML like gallery-dl: search page → gallery IDs →
  // cover image per gallery (data-src base + $.parseJSON ext map).
  const IMHENTAI_ROOT = 'https://imhentai.xxx'
  
  /**
   * imhentai HTML via Electron's net stack (Chromium TLS passes Cloudflare;
   * plain https.get gets a 403 challenge). Falls back to httpGet outside
   * Electron. Throws on bad status like httpGet.
   */
  async function imhGet(url) {
  try {
    if (net && typeof net.fetch === 'function') {
      const res = await net.fetch(url, {
        headers: {
          'User-Agent': UA,
          Accept: 'text/html,application/xhtml+xml,*/*',
          Referer: 'https://imhentai.xxx/',
        },
      })
      if (res.status !== 200) throw new Error(`imh status ${res.status}`)
      return await res.text()
    }
  } catch (e) {
    if (e && /imh status/.test(e.message)) throw e
    /* no Electron net — fall through to https */
  }
  return httpGet(url, { Referer: 'https://imhentai.xxx/' })
  }
  const IMH_EXTS = { j: 'jpg', p: 'png', g: 'gif', w: 'webp', a: 'avif' }
  
  function parseImhentaiSearch(html, limit) {
  const out = []
  const re = /href="\/gallery\/(\d+)\/?"/g
  let m
  while ((m = re.exec(html))) {
    if (!out.includes(m[1])) out.push(m[1])
    if (out.length >= limit) break
  }
  return out
  }
  
  function parseImhentaiSearchResults(html, limit) {
  const out = []
  const seen = new Set()
  const thumbRe = /<div class="thumb"[\s\S]*?href="\/gallery\/(\d+)\/?"[\s\S]*?<img[^>]+data-src="([^"]+)"/g
  let m
  while ((m = thumbRe.exec(html))) {
    const [, id, coverUrl] = m
    if (!seen.has(id)) {
      seen.add(id)
      out.push({ id, coverUrl })
      if (out.length >= limit) break
    }
  }
  if (out.length === 0) {
    const linkRe = /href="\/gallery\/(\d+)\/?"[^>]*>[\s\S]*?<img[^>]+(?:data-src|src)="([^"]+)"/g
    while ((m = linkRe.exec(html))) {
      const [, id, coverUrl] = m
      if (!seen.has(id)) {
        seen.add(id)
        out.push({ id, coverUrl })
        if (out.length >= limit) break
      }
    }
  }
  return out
  }
  
  // EVERY page image from a gallery page (the $.parseJSON ext map carries the
  // whole book) — one fetch yields all pages, zero extra requests.
  /**
   * Real tags for an imhentai gallery, from its own tag links/title.
   *
   * imhentai has no JSON API, so relevance used to be FAKED: the search key was
   * split into sub-words and stamped onto every page of every gallery the search
   * returned. That made `matchesQuery` pass by construction, so whatever the
   * site's fuzzy search handed back was presented as if it carried the tag. It
   * also broke compounds — `shrooms_q` was stamped as `shrooms`, which the
   * renderer's whole-token gate then rejected, so the whole multi-fetch scrape
   * was spent producing results that got thrown away.
   *
   * Now the gallery's own tags decide. If the page publishes none (markup drift,
   * a book with no tags), we fall back to the search key as ONE whole tag —
   * search-attested rather than invented, and at least consistent with what the
   * renderer can match.
   */
  function parseImhentaiGalleryTags(html) {
  const out = []
  if (!html || typeof html !== 'string') return out
  const push = (t) => {
    const n = normRedgifsTag(String(t || '').replace(/\s+/g, '_'))
    if (n && !out.includes(n)) out.push(n)
  }
  // `<div class="tags">` block: each tag is a link to /tag/<name>/
  const tagsBlock = /class="tags"[\s\S]{0,4000}?<\/div>/i.exec(html)
  const scope = tagsBlock ? tagsBlock[0] : html
  const linkRe = /href="\/(?:tag|tags)\/([^"/?#]+)\/?"/gi
  let m
  while ((m = linkRe.exec(scope)) !== null) {
    try {
      push(decodeURIComponent(m[1]))
    } catch {
      push(m[1])
    }
  }
  return out
  }
  
  function parseImhentaiGalleryPages(html, limit) {
  const max = Math.max(1, limit || 20)
  if (!html || typeof html !== 'string') return []
  const srcTag = 'data-src="'
  const srcStart = html.indexOf(srcTag)
  if (srcStart === -1) return []
  const urlStart = srcStart + srcTag.length
  const urlEnd = html.indexOf('"', urlStart)
  if (urlEnd === -1) return []
  const src = html.slice(urlStart, urlEnd)
  if (!src) return []
  const slash = src.lastIndexOf('/')
  const root = slash === -1 ? '' : src.slice(0, slash + 1)
  const marker = 'parseJSON('
  const mStart = html.indexOf(marker)
  if (mStart !== -1) {
    const q1 = html.indexOf("'", mStart + marker.length)
    const q2 = q1 === -1 ? -1 : html.indexOf("'", q1 + 1)
    if (q1 !== -1 && q2 !== -1) {
      try {
        const raw = html.slice(q1 + 1, q2).split(String.fromCharCode(92)).join('')
        const data = JSON.parse(raw)
        const pages = Object.keys(data)
          .map(Number)
          .filter((n) => Number.isInteger(n) && n >= 1)
          .sort((a, b) => a - b)
        const covers = []
        for (const n of pages) {
          if (covers.length >= max) break
          const entry = data[String(n)]
          if (typeof entry !== 'string') continue
          const parts = entry.split(',')
          const suffix = IMH_EXTS[parts[0]]
          if (!suffix) continue
          covers.push({ url: root + n + '.' + suffix, width: Number(parts[1]) || 0, height: Number(parts[2]) || 0 })
        }
        if (covers.length > 0) return covers
      } catch {
        /* fall through to raw data-src */
      }
    }
  }
  return [{ url: src, width: 0, height: 0 }]
  }
  
  // Galleries expanded per gallery-source round; lanes expanded in parallel.
  async function fetchImhentai(variant, n) {
  const key = redgifsWords(variant)
  // Cloudflare challenges Node-TLS fetches (403 "Just a moment") — Electron's
  // net stack is Chromium TLS and passes like a real browser tab. Plain-node
  // fallback stays for contexts without Electron.
  const searchBody = await imhGet(`${IMHENTAI_ROOT}/search/?key=${encodeURIComponent(key)}`, undefined, HTML_TIMEOUT_MS)
  // The FULL query as ONE token. Splitting it into sub-words (`shrooms_q` ->
  // `shrooms`) produced tags the renderer's whole-token gate rejects, so the
  // scrape was paid for and discarded.
  const queryTag = normRedgifsTag(key.replace(/\s+/g, '_'))
  const tags = queryTag ? [queryTag] : []
  if (hasBadTag(tags)) return []
  
  // Direct results from search HTML give gallery ids + cover thumbs. Enter EVERY gallery from the search page: covers are only thumbs and
  // the blind thumb->1.jpg rewrite 404s on books that ship .webp/.png —
  // the ext map in the gallery page carries the real extensions. Cover
  // posts remain the fallback when all entries fail. parseImhentaiSearch
  // covers galleries whose markup hides the thumbnail from the direct parse.
  const results = parseImhentaiSearchResults(searchBody, GALLERY_CAP)
  const entries = results.length > 0
    ? results
    : parseImhentaiSearch(searchBody, GALLERY_CAP).map((id) => ({ id, coverUrl: '' }))
  if (entries.length === 0) return []
  const perGallery = Math.max(1, Math.ceil(n / Math.min(entries.length, GALLERY_LANES)))
  const sets = await mapLimit(entries, GALLERY_LANES, async ({ id, coverUrl }) => {
    try {
      const galleryBody = await imhGet(`${IMHENTAI_ROOT}/gallery/${encodeURIComponent(id)}/`, undefined, HTML_TIMEOUT_MS)
      const pages = parseImhentaiGalleryPages(galleryBody, perGallery)
      const thumb = pages.length > 0 ? pages[0].url : coverUrl
      // Prefer the gallery's OWN tags: then the renderer gate can actually
      // verify relevance instead of trusting a stamp. Fall back to the search
      // key when the page publishes none — search-attested, not invented.
      const own = parseImhentaiGalleryTags(galleryBody)
      const postTags = own.length > 0 ? own : tags
      if (hasBadTag(postTags)) return undefined
      const set = []
      pages.forEach((cover, i) => {
        // Dims gate only when known — map-less covers skip it. Floor 400px
        // (localhost parity), not the old 700px starver.
        if (cover.width > 0 && cover.height > 0) {
          if (cover.width < FLOOR_PX || cover.height < FLOOR_PX) return
        }
        set.push({ id: `imh-${id}-p${i + 1}`, url: cover.url, preview: thumb, tags: postTags, rating: undefined, kind: 'image' })
      })
      return set.length > 0 ? set : undefined
    } catch {
      return undefined /* one dead gallery never kills the round */
    }
  })
  const expanded = roundRobinPosts(sets, n)
  if (expanded.length > 0) return expanded
  const directPosts = []
  for (const { id, coverUrl } of results) {
    const full = coverUrl.replace(/\/(?:thumb|t)\.([a-z0-9]+)(?:[?#]|$)/i, '/1.$1')
    if (!full || /\/(?:thumb|thumbs)(?:[?#/.]|$)/i.test(full)) continue
    directPosts.push({ id: `imh-${id}`, url: full, preview: coverUrl, tags, rating: undefined, kind: 'image' })
    if (directPosts.length >= n) break
  }
  return directPosts
  }

  return {
    fetch: fetchImhentai,
    _parsers: { parseImhentaiSearch, parseImhentaiSearchResults, parseImhentaiGalleryTags, parseImhentaiGalleryPages },
  }
}

module.exports = { createImhentaiSource }
