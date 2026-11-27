'use strict'
// node electron/babesource.test.cjs — exits 1 on failure (plain-node style).
//
// babesource has no JSON API either: the parser is the contract. These fixtures
// pin the slug, the thumb->full rewrite, the search/max-page scan, the gallery
// anchors and the tag source (its own keywords, never the search key).
const assert = require('assert')
const { createBabesourceSource } = require('./babesource.cjs')

const bs = createBabesourceSource({
  httpGet: async () => '',
  htmlTimeoutMs: 1000,
  galleryCap: 6,
  galleryLanes: 3,
  mapLimit: async (items, n, fn) => Promise.all(items.map(fn)),
  roundRobinPosts: (lists, limit) => lists.flat().slice(0, limit),
  hasBadTag: () => false,
  normRedgifsTag: (t) => String(t || '').trim().toLowerCase().replace(/\s+/g, '_'),
})

const { parseBabesourceSearch, parseBabesourceMaxPage, parseBabesourceGallery, parseBabesourceTags, babesourceSlug, babesourceThumbToFull } =
  bs._parsers

// --- slug + thumb -> full --------------------------------------------------
assert.strictEqual(babesourceSlug('Some Tag_Name'), 'some-tag-name')
assert.strictEqual(babesourceSlug('  Two  Words '), 'two-words')
assert.strictEqual(
  babesourceThumbToFull('https://media.babesource.com/galleries/abc123/thumbs/300x406/1.jpg'),
  'https://babesource.com/media/galleries/abc123/1.jpg',
)
assert.strictEqual(babesourceThumbToFull('https://example.com/x.jpg'), null)

// --- search page: gallery links, /video/ skipped, limit holds --------------
{
  const html = `
    <a href="https://babesource.com/galleries/hot-stuff-111.html">Hot</a>
    <a href="https://babesource.com/galleries/another-222.html">Another</a>
    <a href="https://babesource.com/galleries/video/333.html">Video</a>`
  assert.deepStrictEqual(parseBabesourceSearch(html, 6), [
    'https://babesource.com/galleries/hot-stuff-111.html',
    'https://babesource.com/galleries/another-222.html',
  ])
  assert.strictEqual(parseBabesourceSearch(html, 1).length, 1)
}

// --- max page ---------------------------------------------------------------
assert.strictEqual(parseBabesourceMaxPage('<a href="page3.html">3</a><a href="page7.html">7</a>'), 7)
assert.strictEqual(parseBabesourceMaxPage('<a href="page999.html">x</a>'), 50) // capped
assert.strictEqual(parseBabesourceMaxPage('nothing'), 1)

// --- gallery anchors: full image + preview ---------------------------------
{
  const html = `
    <a class="slideshowGalleryImage" href="https://babesource.com/media/galleries/abc/full.jpg">
      <img src="https://media.babesource.com/galleries/abc/thumbs/300x406/1.jpg">
    </a>
    <a class="slideshowGalleryImage" href="https://babesource.com/media/galleries/def/two.png">
      <img src="https://media.babesource.com/galleries/def/thumbs/two.png">
    </a>`
  assert.deepStrictEqual(parseBabesourceGallery(html, 6), [
    { url: 'https://babesource.com/media/galleries/abc/full.jpg', preview: 'https://media.babesource.com/galleries/abc/thumbs/300x406/1.jpg' },
    { url: 'https://babesource.com/media/galleries/def/two.png', preview: 'https://media.babesource.com/galleries/def/thumbs/two.png' },
  ])
  // A non-gallery url is rejected (the shape is the contract).
  assert.deepStrictEqual(parseBabesourceGallery('<a class="slideshowGalleryImage" href="https://x.test/a.jpg">', 6), [])
}

// --- tags: its own keywords, then the query as ONE token -------------------
{
  const html = '<meta name="keywords" content="Blonde, Big Tits, BBC">'
  assert.deepStrictEqual(parseBabesourceTags(html, 'ignored'), ['blonde', 'big_tits', 'bbc'])
  // No keywords: the query, as one whole token (never split).
  assert.deepStrictEqual(parseBabesourceTags('<html></html>', 'skylar vox'), ['skylar_vox'])
  // Performer links are tags too.
  assert.deepStrictEqual(
    parseBabesourceTags('<a href="https://babesource.com/pornstars/Some_Star/">x</a>', 'q'),
    ['some_star'],
  )
}

console.log('babesource parser: all fixtures passed')