// Builders for the repetitive booru source shapes (pure node: httpGet/parse
// injected), mirroring the updater-core/server-mode-core pattern. The old
// SOURCES array had 9 hand-copied closures that differed only by hostname.
'use strict'

// Post-view (exact file URL) expansion bounds, mirroring services/booru.ts.
const VIEW_POST_CAP = 6
const VIEW_POST_LANES = 3
const HTML_TIMEOUT_MS = 8000

// Bounded-concurrency map (mirrors main.cjs/services); failures settle to
// undefined and are dropped.
async function mapLimit(items, n, fn) {
  const out = new Array(items.length)
  let next = 0
  const lanes = Math.min(Math.max(1, n), Math.max(items.length, 1))
  const lane = async () => {
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
  return out.filter((v) => v !== undefined)
}

/** Danbooru-API (JSON) shape with random-pid + pid=0 retry.
 * pid window (0..999) matches the renderer dapiPass so both runtimes sample
 * the same deep pool. Pass { deterministic: true } for probes (pid 0). */
function dapiSource(id, base, { httpGet, parse, negatives }, category = 'hentai') {
  return {
    id,
    category,
    fetch: async (variant, n, opts) => {
      // # ponytail: expanded random pid window (0..999) stops image repetition; fallback to 0
      const pid = opts && opts.deterministic ? 0 : Math.floor(Math.random() * 1000)
      const query = (variant + ' rating:explicit ' + negatives()).trim()
      const url = (p) => `${base}/index.php?page=dapi&s=post&q=index&tags=${encodeURIComponent(query)}&limit=${n}&json=1&pid=${p}`
      let posts = parse(await httpGet(url(pid)), base)
      if (posts.length === 0 && pid > 0) {
        posts = parse(await httpGet(url(0)), base)
      }
      return posts
    },
  }
}

/** booru.org subdomain HTML-list shape (WAF: no tags=, random pid page).
 * pid window (0..49 * 20) matches the renderer so both runtimes sample the
 * same pool. Pass { deterministic: true } for probes (pid 0). When
 * parseEntries/parsePost are supplied, post-view pages expand to exact file
 * URLs (guessed-url fallback); otherwise the legacy guessed path runs. */
function booruOrgSource(sub, { httpGet, parse, parseEntries, parsePost }, id = sub.split('.')[0], category = 'hentai') {
  return {
    id,
    category,
    fetch: async (variant, n, opts) => {
      // # ponytail: expanded pid sampling (0..49 * 20 = up to page 1000) for deep diversity
      const pid = opts && opts.deterministic ? 0 : Math.floor(Math.random() * 50) * 20
      const html = await httpGet(`https://${sub}/index.php?page=post&s=list&pid=${pid}`)
      if (parseEntries && parsePost) {
        const strip = (e) => {
          const post = { ...e }
          delete post.postId
          return post
        }
        const all = parseEntries(html, variant)
        const withId = all.filter((e) => e.postId).slice(0, VIEW_POST_CAP)
        if (withId.length > 0) {
          const expanded = await mapLimit(withId, VIEW_POST_LANES, async (entry) => {
            try {
              const view = await httpGet(
                `https://${sub}/index.php?page=post&s=view&id=${entry.postId}`,
                undefined,
                HTML_TIMEOUT_MS,
              )
              const hit = parsePost(view)
              if (!hit || !hit.url) return undefined
              const post = strip(entry)
              post.url = hit.url
              post.kind = hit.kind || post.kind
              return post
            } catch {
              return undefined // guessed-url entry below keeps the round alive
            }
          })
          const byId = new Map(expanded.map((p) => [p.id, p]))
          return all.map((e) => byId.get(e.id) || strip(e)).slice(0, n)
        }
      }
      return parse(html, variant).slice(0, n)
    },
  }
}

module.exports = { dapiSource, booruOrgSource }
