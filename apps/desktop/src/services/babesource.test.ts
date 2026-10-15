import { describe, expect, it } from 'vitest'
import {
  babesourceSearchUrl,
  babesourceSlug,
  babesourceThumbToFull,
  parseBabesourceCovers,
  parseBabesourceGallery,
  parseBabesourceMaxPage,
  parseBabesourceSearch,
  parseBabesourceTags,
  toBabesourceCoverPosts,
  toBabesourcePosts,
} from './babesource'

const SEARCH_HTML =
  '<a class="main-content__card-link" href="https://babesource.com/galleries/kenzie-reeves-my-life-in-miami-186873.html">' +
  '<picture><img src="https://media.babesource.com/galleries/682309b80b97c/thumbs/165035_014.jpg"></picture></a>' +
  '<a class="main-content__card-link" href="https://babesource.com/galleries/shrooms-q-swallowed-205844.html">' +
  '<picture><img src="https://media.babesource.com/galleries/69bfc5acec79c/thumbs/300x406/swa0506_shroomsq_hq0174.jpg"></picture></a>' +
  '<a href="https://babesource.com/video/shrooms-q-fit-18-tube-video-157192.html">video</a>'

const GALLERY_HTML =
  '<meta name="keywords" content="Tony Rubino, doggystyle, blonde, tattoos">' +
  '<a data-index="0" class="box-massage__card-link slideshowGalleryImage" href="https://babesource.com/media/galleries/682309b80b97c/165035_001.jpg">' +
  '<picture><img alt="" loading="eager" src="https://media.babesource.com/galleries/682309b80b97c/thumbs/165035_001.jpg"></picture></a>' +
  '<a data-index="1" class="box-massage__card-link slideshowGalleryImage" href="https://babesource.com/media/galleries/682309b80b97c/165035_002.jpg">' +
  '<picture><img alt="" loading="lazy" src="https://media.babesource.com/galleries/682309b80b97c/thumbs/165035_002.jpg"></picture></a>'

describe('babesource adapter', () => {
  it('slugifies queries like the site search', () => {
    expect(babesourceSlug('Kenzie Reeves')).toBe('kenzie-reeves')
    expect(babesourceSlug('shrooms_q')).toBe('shrooms-q')
    expect(babesourceSearchUrl('kenzie reeves', 2)).toBe(
      'https://babesource.com/search/kenzie-reeves/page2.html',
    )
  })

  it('extracts gallery hrefs and skips /video/ entries', () => {
    expect(parseBabesourceSearch(SEARCH_HTML, 5)).toEqual([
      'https://babesource.com/galleries/kenzie-reeves-my-life-in-miami-186873.html',
      'https://babesource.com/galleries/shrooms-q-swallowed-205844.html',
    ])
  })

  it('extracts full-res urls with thumb previews (never thumb as url)', () => {
    const imgs = parseBabesourceGallery(GALLERY_HTML, 5)
    expect(imgs).toHaveLength(2)
    expect(imgs[0].url).toBe('https://babesource.com/media/galleries/682309b80b97c/165035_001.jpg')
    expect(imgs[0].preview).toBe(
      'https://media.babesource.com/galleries/682309b80b97c/thumbs/165035_001.jpg',
    )
    expect(imgs.every((i) => !/\/thumbs\//i.test(i.url))).toBe(true)
  })

  it('rewrites thumbs to fulls deterministically', () => {
    expect(
      babesourceThumbToFull('https://media.babesource.com/galleries/682309b80b97c/thumbs/165035_001.jpg'),
    ).toBe('https://babesource.com/media/galleries/682309b80b97c/165035_001.jpg')
    expect(
      babesourceThumbToFull(
        'https://media.babesource.com/galleries/69bfc5acec79c/thumbs/300x406/swa0506_shroomsq_hq0174.jpg',
      ),
    ).toBe('https://babesource.com/media/galleries/69bfc5acec79c/swa0506_shroomsq_hq0174.jpg')
    expect(babesourceThumbToFull('https://example.com/x.jpg')).toBeNull()
  })

  it('maps gallery images to image-kind feed posts', () => {
    const posts = toBabesourcePosts(
      'https://babesource.com/galleries/kenzie-reeves-my-life-in-miami-186873.html',
      parseBabesourceGallery(GALLERY_HTML, 5),
      'kenzie reeves',
      parseBabesourceTags(GALLERY_HTML),
    )
    expect(posts).toHaveLength(2)
    expect(posts[0].id).toMatch(/^bs-186873-/)
    expect(posts[0].kind).toBe('image')
    expect(posts[0].tags).toContain('kenzie')
    expect(posts[0].tags).toContain('doggystyle')
  })

  it('detects the max search page from pagination links', () => {
    expect(parseBabesourceMaxPage(`<a href='page2.html'>2</a><a href="page11.html">11</a>`)).toBe(11)
    expect(parseBabesourceMaxPage('<div>single page, no pagination</div>')).toBe(1)
    expect(parseBabesourceMaxPage(null)).toBe(1)
  })

  it('never throws on garbage', () => {
    expect(parseBabesourceSearch(null)).toEqual([])
    expect(parseBabesourceGallery(null)).toEqual([])
    expect(parseBabesourceGallery('<div>no pics</div>')).toEqual([])
    expect(parseBabesourceTags(null)).toEqual([])
    expect(parseBabesourceCovers(null)).toEqual([])
  })

  it('rewrites search-page covers to exact fulls (live markup, incl. spaced names)', () => {
    const html =
      '<img alt="" loading="lazy" src="https://media.babesource.com/galleries/6a7594d0172fe/thumbs/300x406/189434_005.jpg">' +
      '<img src="https://media.babesource.com/galleries/61cae4b698fe1/thumbs/4037 lhb_0137.jpg">'
    const covers = parseBabesourceCovers(html, 5)
    expect(covers).toHaveLength(2)
    expect(covers[0].url).toBe('https://babesource.com/media/galleries/6a7594d0172fe/189434_005.jpg')
    expect(covers[0].preview).toContain('/thumbs/300x406/')
    expect(covers[1].url).toBe('https://babesource.com/media/galleries/61cae4b698fe1/4037 lhb_0137.jpg')
    expect(covers.every((c) => !/\/thumbs\//i.test(c.url))).toBe(true)
  })

  it('maps covers to image-kind posts with stable ids and query tags', () => {
    const posts = toBabesourceCoverPosts(
      [
        {
          url: 'https://babesource.com/media/galleries/6a7594d0172fe/189434_005.jpg',
          preview: 'https://media.babesource.com/galleries/6a7594d0172fe/thumbs/300x406/189434_005.jpg',
        },
      ],
      'skylar_vox',
    )
    expect(posts).toHaveLength(1)
    expect(posts[0].id).toBe('bs-c-6a7594d0172fe-0')
    expect(posts[0].kind).toBe('image')
    // The query token verbatim, NOT split into its words: stamping
    // `skylar`/`vox` on a result the query asked for as `skylar_vox` meant
    // strict AND validation threw babesource's own hits away.
    expect(posts[0].tags).toContain('skylar_vox')
    expect(posts[0].tags).not.toContain('skylar')
  })
})
