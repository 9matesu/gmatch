'use strict'
// node electron/imhentai.test.cjs — exits 1 on failure (plain-node style).
//
// imhentai has no JSON API: the parser is the only contract with the site, and
// until now it lived inside main.cjs with no test. These fixtures pin the three
// shapes that matter: the search page (ids + covers), the gallery page (the
// data-src base + the $.parseJSON ext map), and the gallery's own tags.
const assert = require('assert')
const { createImhentaiSource } = require('./imhentai.cjs')

const imh = createImhentaiSource({
  net: null,
  httpGet: async () => '',
  ua: 'test',
  htmlTimeoutMs: 1000,
  galleryCap: 6,
  galleryLanes: 3,
  floorPx: 400,
  redgifsWords: (q) => q,
  normRedgifsTag: (t) => String(t || '').trim().toLowerCase().replace(/\s+/g, '_'),
  hasBadTag: () => false,
  mapLimit: async (items, n, fn) => Promise.all(items.map(fn)),
  roundRobinPosts: (lists, limit) => lists.flat().slice(0, limit),
})

const { parseImhentaiSearch, parseImhentaiSearchResults, parseImhentaiGalleryTags, parseImhentaiGalleryPages } =
  imh._parsers

// --- search page: thumb blocks carry the id and the cover -------------------
{
  const html = `
    <div class="thumb">
      <a href="/gallery/12345/"><img data-src="https://imhentai.xxx/images/thumb/a.jpg"></a>
    </div>
    <div class="thumb">
      <a href="/gallery/999"><img data-src="https://imhentai.xxx/images/thumb/b.jpg"></a>
    </div>`
  assert.deepStrictEqual(parseImhentaiSearch(html, 6), ['12345', '999'])
  assert.deepStrictEqual(parseImhentaiSearchResults(html, 6), [
    { id: '12345', coverUrl: 'https://imhentai.xxx/images/thumb/a.jpg' },
    { id: '999', coverUrl: 'https://imhentai.xxx/images/thumb/b.jpg' },
  ])
  // The limit holds.
  assert.strictEqual(parseImhentaiSearch(html, 1).length, 1)
}

// --- gallery page: the ext map carries every page --------------------------
{
  const html = `
    <img data-src="https://imhentai.xxx/images/galleries/abcd/1.jpg">
    <script>$.parseJSON('{"1":"j,1200,900","2":"p,800,600","3":"w,1000,1500"}')</script>`
  const pages = parseImhentaiGalleryPages(html, 10)
  assert.deepStrictEqual(pages, [
    { url: 'https://imhentai.xxx/images/galleries/abcd/1.jpg', width: 1200, height: 900 },
    { url: 'https://imhentai.xxx/images/galleries/abcd/2.png', width: 800, height: 600 },
    { url: 'https://imhentai.xxx/images/galleries/abcd/3.webp', width: 1000, height: 1500 },
  ])
  // Without the map, the data-src itself is the page (dims unknown).
  const bare = parseImhentaiGalleryPages('<img data-src="https://imhentai.xxx/images/galleries/x/1.jpg">', 10)
  assert.deepStrictEqual(bare, [{ url: 'https://imhentai.xxx/images/galleries/x/1.jpg', width: 0, height: 0 }])
  // The per-round cap holds.
  assert.strictEqual(parseImhentaiGalleryPages(html, 2).length, 2)
}

// --- gallery tags: the gallery's own words, not the search key -------------
{
  const html = '<div class="tags"><a href="/tag/big_breasts/">big breasts</a><a href="/tag/shorthair/">shorthair</a></div>'
  assert.deepStrictEqual(parseImhentaiGalleryTags(html), ['big_breasts', 'shorthair'])
  // No tags block: nothing invented.
  assert.deepStrictEqual(parseImhentaiGalleryTags('<html><body>nothing</body></html>'), [])
  // Not a string: empty, never a throw.
  assert.deepStrictEqual(parseImhentaiGalleryTags(null), [])
}

console.log('imhentai parser: all fixtures passed')