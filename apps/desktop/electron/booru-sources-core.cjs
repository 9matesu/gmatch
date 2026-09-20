// Builders for the repetitive booru source shapes (pure node: httpGet/parse
// injected), mirroring the updater-core/server-mode-core pattern. The old
// SOURCES array had 9 hand-copied closures that differed only by hostname.
'use strict'

/** Danbooru-API (JSON) shape with random-pid + pid=0 retry. */
function dapiSource(id, base, { httpGet, parse, negatives }, category = 'hentai') {
  return {
    id,
    category,
    fetch: async (variant, n) => {
      // # ponytail: expanded random pid window (0..79) stops image repetition; fallback to 0
      const pid = Math.floor(Math.random() * 80)
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

/** booru.org subdomain HTML-list shape (WAF: no tags=, random pid page). */
function booruOrgSource(sub, { httpGet, parse }, id = sub.split('.')[0], category = 'hentai') {
  return {
    id,
    category,
    fetch: async (variant, n) => {
      // # ponytail: expanded pid sampling (0..39 * 20 = up to page 800) for deep diversity
      const pid = Math.floor(Math.random() * 40) * 20
      const html = await httpGet(`https://${sub}/index.php?page=post&s=list&pid=${pid}`)
      return parse(html, variant).slice(0, n)
    },
  }
}

module.exports = { dapiSource, booruOrgSource }
