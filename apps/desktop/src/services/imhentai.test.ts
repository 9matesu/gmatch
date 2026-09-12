import { describe, expect, it } from 'vitest'
import {
  imhentaiGalleryUrl,
  imhentaiSearchUrl,
  parseImhentaiCover,
  parseImhentaiSearch,
  parseImhentaiSearchResults,
  toImhentaiPost,
} from './imhentai'

const SEARCH_HTML =
  '<div class="gallery"><a href="/gallery/12345/"><img/></a></div>' +
  '<div class="gallery"><a href="/gallery/12345/"><img/></a></div>' +
  '<div class="gallery"><a href="/gallery/67890">caption gallery</a></div>' +
  '<a href="/tag/bbc">not a gallery</a>'

const SEARCH_THUMB_HTML =
  '<div class="thumb"><div class="inner_thumb"><a href="/gallery/12345/"><img class="lazy" data-src="https://m1.imhentai.xxx/001/a/thumb.jpg" /></a></div></div>' +
  '<div class="thumb"><div class="inner_thumb"><a href="/gallery/12345/"><img class="lazy" data-src="https://m1.imhentai.xxx/001/a/thumb.jpg" /></a></div></div>' +
  '<div class="thumb"><div class="inner_thumb"><a href="/gallery/67890/"><img class="lazy" data-src="https://m2.imhentai.xxx/002/b/thumb.jpg" /></a></div></div>'

const DQ = String.fromCharCode(34)
const SQ = String.fromCharCode(39)
const JSON_MAP =
  '{' + DQ + '1' + DQ + ':' + DQ + 'j,1280,1800' + DQ + ',' + DQ + '2' + DQ + ':' + DQ + 'p,1280,1800' + DQ + '}'

const GALLERY_HTML =
  '<h1>Some doujin</h1><img data-src="https://m1.imhentai.xxx/abc/1.jpg" />' +
  '<script>var x = $.parseJSON(' + SQ + JSON_MAP + SQ + ');</script>'

describe('imhentai adapter', () => {
  it('builds gallery-dl-shaped search/gallery URLs', () => {
    expect(imhentaiSearchUrl('goon_caption')).toBe('https://imhentai.xxx/search/?key=goon%20caption')
    expect(imhentaiGalleryUrl('12345')).toBe('https://imhentai.xxx/gallery/12345/')
  })

  it('extracts gallery IDs, deduped and capped', () => {
    expect(parseImhentaiSearch(SEARCH_HTML)).toEqual(['12345', '67890'])
    expect(parseImhentaiSearch(SEARCH_HTML, 1)).toEqual(['12345'])
  })

  it('extracts gallery IDs and cover thumbnails directly from search HTML', () => {
    expect(parseImhentaiSearchResults(SEARCH_THUMB_HTML)).toEqual([
      { id: '12345', coverUrl: 'https://m1.imhentai.xxx/001/a/thumb.jpg' },
      { id: '67890', coverUrl: 'https://m2.imhentai.xxx/002/b/thumb.jpg' },
    ])
    expect(parseImhentaiSearchResults(SEARCH_THUMB_HTML, 1)).toEqual([
      { id: '12345', coverUrl: 'https://m1.imhentai.xxx/001/a/thumb.jpg' },
    ])
  })

  it('resolves the cover via the parseJSON ext map', () => {
    expect(parseImhentaiCover(GALLERY_HTML)).toEqual({
      url: 'https://m1.imhentai.xxx/abc/1.jpg',
      width: 1280,
      height: 1800,
    })
  })

  it('tolerates JS-escaped quotes inside the parseJSON map', () => {
    const bs = String.fromCharCode(92)
    const escJson = JSON_MAP.split(DQ).join(bs + DQ)
    const escapedHtml =
      '<img data-src="https://m1.imhentai.xxx/abc/1.jpg" />' +
      '<script>var x = $.parseJSON(' + SQ + escJson + SQ + ');</script>'
    expect(parseImhentaiCover(escapedHtml)).toEqual({
      url: 'https://m1.imhentai.xxx/abc/1.jpg',
      width: 1280,
      height: 1800,
    })
  })

  it('falls back to raw data-src when the JSON map is missing', () => {
    expect(parseImhentaiCover('<img data-src="https://m1.imhentai.xxx/x/1.webp"/>')).toEqual({
      url: 'https://m1.imhentai.xxx/x/1.webp',
      width: 0,
      height: 0,
    })
  })

  it('maps a cover to a feed post tagged from the query', () => {
    const p = toImhentaiPost('12345', { url: 'https://m1.imhentai.xxx/abc/1.jpg', width: 1, height: 1 }, 'goon_caption')
    expect(p.id).toBe('imh-12345')
    expect(p.rating).toBe('e')
    expect(p.tags).toContain('goon')
    expect(p.tags).toContain('caption')
  })

  it('never throws on garbage', () => {
    expect(parseImhentaiSearch(null)).toEqual([])
    expect(parseImhentaiSearch('<div>no galleries</div>')).toEqual([])
    expect(parseImhentaiCover(null)).toBeNull()
    expect(parseImhentaiCover('<div>no image</div>')).toBeNull()
  })
})
