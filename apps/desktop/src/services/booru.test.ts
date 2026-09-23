import { afterEach, describe, expect, it, vi } from 'vitest'
import { __resetFeedState, clearMirrorCooldowns, drawFreshPage, drawFreshPid, expandPostViews, fetchPosts, fetchPostsMulti, interleaveBatches, isSeen, mapLimit, markSeen, parseBooruOrgEntries, parseBooruOrgPost, parseRealbooruEntries, parseRealbooruHtml, parseRealbooruPost, recallSeen, roundRobin } from './booru'
import { setCoRules, setFeedIntent, __resetCoRules } from '../game/tagCooccur'
import { setUserExcludes } from '../game/tagFilter'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.useRealTimers()
  __resetFeedState()
  __resetCoRules()
  setCoRules([])
  setFeedIntent([])
  setUserExcludes([])
})

describe('seen-set persistence', () => {
  it('persists at most once per burst (debounced)', async () => {
    vi.useFakeTimers()
    const setItem = vi.fn()
    vi.stubGlobal('localStorage', { getItem: () => null, setItem, removeItem: () => {} })
    markSeen('a', 'u1')
    markSeen('b', 'u2')
    markSeen('c', 'u3')
    expect(setItem).not.toHaveBeenCalled()
    vi.advanceTimersByTime(5_000)
    expect(setItem).toHaveBeenCalledTimes(1)
    const written = JSON.parse(String(setItem.mock.calls[0][1]))
    expect(written.ids).toEqual(expect.arrayContaining(['a', 'b', 'c']))
  })
})

describe('fetchPosts (SPEC §6/§8)', () => {
  it('ipc path marks posts seen so the next round returns only fresh ones', async () => {
    const p1 = { id: 'x1', url: 'https://e.test/1.jpg', tags: ['skylar_vox'], rating: 'e' }
    const p2 = { id: 'x2', url: 'https://e.test/2.jpg', tags: ['skylar_vox'], rating: 'e' }
    const p3 = { id: 'x3', url: 'https://e.test/3.jpg', tags: ['skylar_vox'], rating: 'e' }
    const booruFetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, posts: [p1, p2], source: 'hgoon' })
      .mockResolvedValueOnce({ ok: true, posts: [p1, p3], source: 'hgoon' })
    vi.stubGlobal('window', { gmatch: { booruFetch } })
    const first = await fetchPosts({ tags: 'skylar_vox', limit: 5 })
    expect(first.posts.map((p) => p.id)).toEqual(['x1', 'x2'])
    const second = await fetchPosts({ tags: 'skylar_vox', limit: 5 })
    expect(second.posts.map((p) => p.id)).toEqual(['x3'])
  })
  it('uses the Electron IPC bridge when present', async () => {
    const booruFetch = vi.fn().mockResolvedValue({
      posts: [{ id: '1', url: 'https://x/1.png', tags: ['gangbang'], rating: 'e' }],
      source: 'tbib',
      ok: true,
    })
    vi.stubGlobal('window', { gmatch: { booruFetch } })
    const res = await fetchPosts({ tags: 'gangbang', limit: 10 })
    expect(booruFetch).toHaveBeenCalledWith({ tags: 'gangbang', limit: 10 })
    expect(res.ok).toBe(true)
    expect(res.source).toBe('tbib')
  })

  it('returns offline:true when the bridge reports failure', async () => {
    vi.stubGlobal('window', {
      gmatch: { booruFetch: vi.fn().mockResolvedValue({ posts: [], source: null, ok: false }) },
    })
    const res = await fetchPosts({ tags: '1girl', limit: 10 })
    expect(res.offline).toBe(true)
    expect(res.ok).toBe(false)
  })

  it('returns offline:true when direct fetch throws (CORS)', async () => {
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('CORS')))
    const res = await fetchPosts({ tags: '1girl', limit: 10 })
    expect(res.offline).toBe(true)
  })

  it('never even asks for a blocked query', async () => {
    const booruFetch = vi.fn()
    vi.stubGlobal('window', { gmatch: { booruFetch } })
    const res = await fetchPosts({ tags: '1girl loli', limit: 10 })
    expect(booruFetch).not.toHaveBeenCalled()
    expect(res.offline).toBe(true)
  })

  it('dedupes post ids across a session', async () => {
    const post = { id: 'dup', url: 'https://x/dup.png', tags: [], rating: 'e' }
    const booruFetch = vi.fn().mockResolvedValue({ posts: [post], source: 'tbib', ok: true })
    vi.stubGlobal('window', { gmatch: { booruFetch } })
    const first = await fetchPosts({ tags: 'wet', limit: 5 })
    const second = await fetchPosts({ tags: 'wet', limit: 5 })
    expect(first.posts).toHaveLength(1)
    expect(second.posts).toHaveLength(0)
  })

  it('browser mode fetches tbib through the dev proxy (no CORS)', async () => {
    vi.stubGlobal('window', {})
    const tbibPost = {
      id: 28545394,
      directory: 10792,
      image: 'ae15a5c325658023a6123e14f6dcac2bd602e240.jpg',
      width: 1824,
      height: 2432,
      rating: 'explicit',
      tags: 'gangbang creampie highres',
    }
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([tbibPost]),
    })
    vi.stubGlobal('fetch', fetchMock)
    const res = await fetchPosts({ tags: 'gangbang-proxy', limit: 10 })
    expect(res.ok).toBe(true)
    expect(res.source).toBe('tbib-direct')
    expect(fetchMock).toHaveBeenCalledOnce()
    const url = String(fetchMock.mock.calls[0][0])
    expect(url.startsWith('/booru/tbib/')).toBe(true)
    expect(url).not.toContain('tbib.org')
    expect(res.posts[0].url).toBe(
      'https://tbib.org/images/10792/ae15a5c325658023a6123e14f6dcac2bd602e240.jpg',
    )
  })

  it('browser mode falls through to xbooru when tbib yields nothing usable', async () => {
    vi.stubGlobal('window', {})
    const xPost = {
      id: 1274606,
      file_url: 'https://img.xbooru.com/images/477/2d9db914816e9fca38dc93f82f0033e5.png',
      width: 1400,
      height: 1360,
      rating: 'explicit',
      tags: 'gangbang creampie',
    }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([xPost]) })
    vi.stubGlobal('fetch', fetchMock)
    const res = await fetchPosts({ tags: 'gangbang-fallthrough', limit: 10 })
    expect(res.ok).toBe(true)
    expect(res.source).toBe('xbooru-direct')
    expect(String(fetchMock.mock.calls[1][0]).startsWith('/booru/xbooru/')).toBe(true)
  })

  it('browser mode reports offline when all direct sources fail', async () => {
    vi.stubGlobal('window', {})
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    const res = await fetchPosts({ tags: 'gangbang-allfail', limit: 10 })
    expect(res.offline).toBe(true)
    expect(res.ok).toBe(false)
  })

  it('browser mode falls back to narrower variants when combos truncate', async () => {
    vi.stubGlobal('window', {})
    const good = {
      id: 99,
      directory: 5,
      image: 'good-variant-fallback.jpg',
      width: 900,
      height: 900,
      rating: 'explicit',
      tags: 'gangbang creampie',
    }
    const fetchMock = vi
      .fn()
      // full 5-tag query comes back truncated on both mirrors…
      .mockResolvedValueOnce({ ok: true, json: () => Promise.reject(new Error('truncated')) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.reject(new Error('truncated')) })
      // …top-2 variant on tbib hits
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([good]) })
    vi.stubGlobal('fetch', fetchMock)
    const res = await fetchPosts({ tags: 'gangbang creampie ahegao deepthroat anal', limit: 10 })
    expect(res.ok).toBe(true)
    expect(res.posts).toHaveLength(1)
    const urls = fetchMock.mock.calls.map((c) => decodeURIComponent(String(c[0])))
    expect(urls[0]).toContain('gangbang creampie ahegao deepthroat anal')
    expect(urls[1]).toContain('gangbang creampie rating:explicit')
  })

  it('browser mode uses paheal single-tag when danbooru mirrors yield nothing', async () => {
    vi.stubGlobal('window', {})
    const xml =
      `<posts count="1" offset="0">` +
      `<tag id="4242" file_url="https://paheal.net/_images/abc123.jpg" width="900" height="1000" tags="gangbang creampie" />` +
      `</posts>`
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).startsWith('/booru/paheal/')) {
        return { ok: true, text: () => Promise.resolve(xml) }
      }
      return { ok: true, json: () => Promise.resolve([]) }
    })
    vi.stubGlobal('fetch', fetchMock)
    const res = await fetchPosts({ tags: 'gangbang creampie ahegao', limit: 5 })
    expect(res.ok).toBe(true)
    expect(res.source).toBe('paheal-direct')
    expect(res.posts[0].id).toBe('4242')
  })

  it('never repeats a seen post — dupes are skipped for the next source', async () => {
    vi.stubGlobal('window', {})
    const dupe = {
      id: 101,
      file_url: 'https://x/dupe-a.jpg',
      width: 900,
      height: 900,
      rating: 'explicit',
      tags: 'gangbang',
    }
    const fresh = {
      id: 102,
      file_url: 'https://x/fresh-b.png',
      width: 900,
      height: 900,
      rating: 'explicit',
      tags: 'gangbang',
    }
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).startsWith('/booru/xbooru/')) {
        return { ok: true, json: () => Promise.resolve([fresh]) }
      }
      return { ok: true, json: () => Promise.resolve([dupe]) }
    })
    vi.stubGlobal('fetch', fetchMock)
    const first = await fetchPosts({ tags: 'gangbang-norepeat', limit: 5 })
    expect(first.posts.map((p) => p.id)).toEqual(['101'])
    const second = await fetchPosts({ tags: 'gangbang-norepeat', limit: 5 })
    expect(second.ok).toBe(true)
    expect(second.source).toBe('xbooru-direct')
    expect(second.posts.map((p) => p.id)).toEqual(['102'])
  })

  it('cools down a throwing mirror and leads with the healthy one', async () => {
    vi.stubGlobal('window', {})
    const mk = (id: number) => ({
      id,
      file_url: `https://x/cool-${id}.png`,
      width: 900,
      height: 900,
      rating: 'explicit',
      tags: 'gangbang',
    })
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).startsWith('/booru/tbib/')) throw new Error('mirror down')
      return { ok: true, json: () => Promise.resolve([mk(103)]) }
    })
    vi.stubGlobal('fetch', fetchMock)
    const r1 = await fetchPosts({ tags: 'gangbang-cool', limit: 5 })
    expect(r1.source).toBe('xbooru-direct')
    fetchMock.mockClear()
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).startsWith('/booru/tbib/')) throw new Error('mirror down')
      return { ok: true, json: () => Promise.resolve([mk(104)]) }
    })
    const r2 = await fetchPosts({ tags: 'gangbang-cool', limit: 5 })
    expect(r2.ok).toBe(true)
    // tbib sat out its cooldown — xbooru was attempted first.
    expect(String(fetchMock.mock.calls[0][0]).startsWith('/booru/xbooru/')).toBe(true)
  })

  it('drops text-overlay tags unless the query is a caption hunt', async () => {
    vi.stubGlobal('window', {})
    const post = {
      id: 201,
      file_url: 'https://x/cap-a.jpg',
      width: 900,
      height: 900,
      rating: 'explicit',
      tags: 'breeding speech_bubble english_text',
    }
    const fetchMock = vi.fn(async (url: string) => {
      const u = String(url)
      if (u.startsWith('/booru/tbib/') || u.startsWith('/booru/xbooru/')) {
        return { ok: true, json: () => Promise.resolve([post]) }
      }
      return { ok: false }
    })
    vi.stubGlobal('fetch', fetchMock)
    const plain = await fetchPosts({ tags: 'breeding', limit: 5 })
    expect(plain.ok).toBe(false)
    const hunt = await fetchPosts({ tags: 'breeding caption', limit: 5 })
    expect(hunt.ok).toBe(true)
    expect(hunt.posts).toHaveLength(1)
  })

  it('browser mode searches redgifs (mp4/video) through the proxy', async () => {
    vi.stubGlobal('window', {})
    const gif = {
      id: 'skylarvoxabc',
      width: 1080,
      height: 1920,
      tags: ['Skylar Vox', 'BBC'],
      niches: [],
      urls: {
        hd: 'https://media.redgifs.com/Skylarvoxabc.mp4',
        poster: 'https://media.redgifs.com/Skylarvoxabc-poster.jpg',
      },
    }
    const fetchMock = vi.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
      const u = String(url)
      if (u.startsWith('/booru/tbib/') || u.startsWith('/booru/xbooru/')) {
        return { ok: true, json: () => Promise.resolve([]) }
      }
      if (u.includes('/auth/temporary')) {
        return { ok: true, json: () => Promise.resolve({ token: 'tok123' }) }
      }
      if (u.startsWith('/rg-auth/')) {
        expect(init?.headers?.Authorization).toBe('Bearer tok123')
        expect(decodeURIComponent(u)).toContain('skylar vox')
        return { ok: true, json: () => Promise.resolve({ gifs: [gif] }) }
      }
      return { ok: false }
    })
    vi.stubGlobal('fetch', fetchMock)
    const res = await fetchPosts({ tags: 'skylar_vox', limit: 10 })
    expect(res.ok).toBe(true)
    expect(res.source).toBe('redgifs-direct')
    expect(res.posts[0].kind).toBe('video')
    expect(res.posts[0].url).toMatch(/mp4$/)
    expect(res.posts[0].tags).toContain('bbc')
  })

  it('browser mode scrapes imhentai covers through the proxy', async () => {
    vi.stubGlobal('window', {})
    const searchHtml =
      '<div class="thumb"><a href="/gallery/999/"><img class="lazy" data-src="https://m1.imhentai.xxx/cov/thumb.jpg" /></a></div>'
    const galleryHtml =
      '<h1>caption doujin</h1><img data-src="https://m1.imhentai.xxx/cov/1.jpg" />'
    const fetchMock = vi.fn(async (url: string) => {
      const u = String(url)
      if (u.startsWith('/booru/imh/search')) {
        return { ok: true, text: () => Promise.resolve(searchHtml) }
      }
      if (u.startsWith('/booru/imh/gallery')) {
        return { ok: true, text: () => Promise.resolve(galleryHtml) }
      }
      if (u.startsWith('/booru/tbib/') || u.startsWith('/booru/xbooru/')) {
        return { ok: true, json: () => Promise.resolve([]) }
      }
      return { ok: false }
    })
    vi.stubGlobal('fetch', fetchMock)
    const res = await fetchPosts({ tags: 'goon_caption', limit: 5 })
    expect(res.ok).toBe(true)
    expect(res.source).toBe('imh-direct')
    expect(res.posts[0].id).toBe('imh-999-p1')
  })

  it('browser mode enters imhentai galleries and takes every page image', async () => {
    vi.stubGlobal('window', {})
    const searchHtml =
      '<div class="gallery"><a href="/gallery/555/"><img/></a></div>'
    const DQ = String.fromCharCode(34)
    const SQ = String.fromCharCode(39)
    const map =
      '{' + DQ + '1' + DQ + ':' + DQ + 'j,1000,1400' + DQ + ',' +
      DQ + '2' + DQ + ':' + DQ + 'g,900,1200' + DQ + ',' +
      DQ + '3' + DQ + ':' + DQ + 'p,1100,1500' + DQ + '}'
    const galleryHtml =
      '<img data-src="https://m2.imhentai.xxx/xyz/1.jpg" />' +
      '<script>var x = $.parseJSON(' + SQ + map + SQ + ');</script>'
    const fetchMock = vi.fn(async (url: string) => {
      const u = String(url)
      if (u.startsWith('/booru/imh/search')) {
        return { ok: true, text: () => Promise.resolve(searchHtml) }
      }
      if (u.startsWith('/booru/imh/gallery')) {
        return { ok: true, text: () => Promise.resolve(galleryHtml) }
      }
      if (u.startsWith('/booru/tbib/') || u.startsWith('/booru/xbooru/')) {
        return { ok: true, json: () => Promise.resolve([]) }
      }
      return { ok: false }
    })
    vi.stubGlobal('fetch', fetchMock)
    const res = await fetchPosts({ tags: 'goon_caption', limit: 5 })
    expect(res.ok).toBe(true)
    expect(res.source).toBe('imh-direct')
    expect(res.posts.map((p) => p.id)).toEqual(['imh-555-p1', 'imh-555-p2', 'imh-555-p3'])
    expect(res.posts.map((p) => p.url)).toEqual([
      'https://m2.imhentai.xxx/xyz/1.jpg',
      'https://m2.imhentai.xxx/xyz/2.gif',
      'https://m2.imhentai.xxx/xyz/3.png',
    ])
    // one gallery fetch yields the whole book — no per-page requests
    const galleryCalls = fetchMock.mock.calls.filter((c) => String(c[0]).startsWith('/booru/imh/gallery'))
    expect(galleryCalls).toHaveLength(1)
  })

  it('all galleries 403 cools imh-direct down (no per-round retry spam)', async () => {
    vi.stubGlobal('window', {})
    const searchHtml = '<a href="/gallery/1/"></a><a href="/gallery/2/"></a>'
    const fetchMock = vi.fn(async (url: string) => {
      const u = String(url)
      if (u.startsWith('/booru/imh/search')) {
        return { ok: true, text: () => Promise.resolve(searchHtml) }
      }
      if (u.startsWith('/booru/imh/gallery')) {
        return { ok: false, status: 403 }
      }
      if (u.startsWith('/booru/tbib/') || u.startsWith('/booru/xbooru/')) {
        return { ok: true, json: () => Promise.resolve([]) }
      }
      return { ok: false }
    })
    vi.stubGlobal('fetch', fetchMock)
    const first = await fetchPosts({ tags: 'creampie', limit: 5 })
    expect(first.ok).toBe(false) // everything exhausted -> offline
    const galleryHits = fetchMock.mock.calls.filter((a) => String(a[0]).startsWith('/booru/imh/gallery')).length
    expect(galleryHits).toBe(2) // bounded lanes attempt each gallery once (no per-gallery retries); 403s cool the source
    // Second round: imh-direct is cooling down — no gallery fetches at all.
    await fetchPosts({ tags: 'creampie', limit: 5 })
    const galleryHits2 = fetchMock.mock.calls.filter((a) => String(a[0]).startsWith('/booru/imh/gallery')).length
    expect(galleryHits2).toBe(2)
  })

  it('browser mode scrapes booru.org sub without tags query to dodge Cloudflare 403 WAF', async () => {
    vi.stubGlobal('window', {})
    const booruHtml = `
      <img src="https://thumbs.booru.org/blacked/thumbnails//105/thumbnail_ecc2af25bfbdf61e9eb509839676dcc53553c731.png" alt="post" border="0" title=" 1girl big_breasts cum interracial score:0 rating:Explicit"/>
    `
    const fetchMock = vi.fn(async (url: string) => {
      const u = String(url)
      if (u.startsWith('/booru/blacked')) {
        expect(u).not.toContain('tags=')
        expect(u).toMatch(/[?&]pid=\d+/)
        return { ok: true, text: () => Promise.resolve(booruHtml) }
      }
      if (
        u.startsWith('/booru/tbib/') ||
        u.startsWith('/booru/xbooru/') ||
        u.startsWith('/booru/kona') ||
        u.startsWith('/booru/yand') ||
        u.startsWith('/booru/real')
      ) {
        return { ok: true, json: () => Promise.resolve([]), text: () => Promise.resolve('') }
      }
      return { ok: false }
    })
    vi.stubGlobal('fetch', fetchMock)
    const res = await fetchPosts({ tags: 'interracial', limit: 5 })
    expect(res.ok).toBe(true)
    expect(res.posts[0].url).toContain(
      'img.booru.org/blacked//images/105/ecc2af25bfbdf61e9eb509839676dcc53553c731.png',
    )
  })

  it('drops booru.org posts carrying none of the query tokens', async () => {
    vi.stubGlobal('window', {})
    const junk = `<img src="https://thumbs.booru.org/blacked/thumbnails//105/thumbnail_abc123def456.png" alt="post" border="0" title=" 1girl big_breasts score:0 rating:Explicit"/>`
    const fetchMock = vi.fn(async (url: string) => {
      const u = String(url)
      if (
        u.startsWith('/booru/tbib/') ||
        u.startsWith('/booru/xbooru/') ||
        u.startsWith('/booru/kona') ||
        u.startsWith('/booru/yand') ||
        u.startsWith('/booru/real')
      ) {
        return { ok: false }
      }
      if (u.startsWith('/booru/')) {
        return { ok: true, text: () => Promise.resolve(junk) }
      }
      return { ok: false }
    })
    vi.stubGlobal('fetch', fetchMock)
    const res = await fetchPosts({ tags: 'skylar_vox', limit: 5 })
    expect(res.ok).toBe(false)
  })

  it('extracts imhentai covers from search HTML as the FALLBACK and prefers real gallery pages', async () => {
    vi.stubGlobal('window', {})
    const searchHtml =
      '<div class="thumb"><div class="inner_thumb"><a href="/gallery/777/"><img class="lazy" data-src="https://m1.imhentai.xxx/001/a/thumb.jpg" /></a></div></div>'
    const fetchMock = vi.fn(async (url: string) => {
      const u = String(url)
      if (u.startsWith('/booru/imh/search')) {
        return { ok: true, text: () => Promise.resolve(searchHtml) }
      }
      if (u.startsWith('/booru/imh/gallery')) {
        // No ext map + no parseJSON: parser falls back to the data-src list.
        return { ok: true, text: () => Promise.resolve('<img data-src="https://m1.imhentai.xxx/001/a/1.png" /><img data-src="https://m1.imhentai.xxx/001/a/2.png" />') }
      }
      return { ok: false }
    })
    vi.stubGlobal('fetch', fetchMock)
    const res = await fetchPosts({ tags: 'doujin_caption', limit: 5 })
    expect(res.ok).toBe(true)
    expect(res.source).toBe('imh-direct')
    // The gallery page was ENTERED (its real extensions beat the thumb->1.jpg guess)
    const galleryCalls = fetchMock.mock.calls.filter((c) => String(c[0]).startsWith('/booru/imh/gallery'))
    expect(galleryCalls.length).toBe(1)
    expect(res.posts.map((p) => p.url)).toContain('https://m1.imhentai.xxx/001/a/1.png')
  })

  it('imhentai cover fallback survives when every gallery page 403s', async () => {
    vi.stubGlobal('window', {})
    const searchHtml =
      '<div class="thumb"><div class="inner_thumb"><a href="/gallery/777/"><img class="lazy" data-src="https://m1.imhentai.xxx/001/a/thumb.jpg" /></a></div></div>'
    const fetchMock = vi.fn(async (url: string) => {
      const u = String(url)
      if (u.startsWith('/booru/imh/search')) return { ok: true, text: () => Promise.resolve(searchHtml) }
      if (u.startsWith('/booru/imh/gallery')) return { ok: false, status: 403 }
      return { ok: false }
    })
    vi.stubGlobal('fetch', fetchMock)
    const res = await fetchPosts({ tags: 'doujin_caption', limit: 5 })
    expect(res.source).toBe('imh-direct')
    expect(res.posts[0].url).toBe('https://m1.imhentai.xxx/001/a/1.jpg')
  })

  it('babesource uses page1 only for single-page queries (no 404 page2+ probes)', async () => {
    vi.stubGlobal('window', {})
    const searchHtml =
      '<a class="main-content__card-link" href="https://babesource.com/galleries/shrooms-q-swallowed-205844.html">' +
      '<picture><img src="https://media.babesource.com/galleries/69bfc5acec79c/thumbs/187270_013.jpg"></picture></a>'
    const galleryHtml =
      '<meta name="keywords" content="swallowed, blonde">' +
      '<a data-index="0" class="box-massage__card-link slideshowGalleryImage" href="https://babesource.com/media/galleries/69bfc5acec79c/187270_013.jpg">' +
      '<picture><img src="https://media.babesource.com/galleries/69bfc5acec79c/thumbs/187270_013.jpg"></picture></a>'
    const fetchMock = vi.fn(async (url: string) => {
      const u = String(url)
      if (u.startsWith('/booru/babe/search')) {
        expect(u).toContain('page1.html')
        return { ok: true, text: () => Promise.resolve(searchHtml) }
      }
      if (u.startsWith('/booru/babe/')) {
        return { ok: true, text: () => Promise.resolve(galleryHtml) }
      }
      return { ok: false }
    })
    vi.stubGlobal('fetch', fetchMock)
    const res = await fetchPosts({ tags: 'shrooms_q', limit: 5 })
    expect(res.ok).toBe(true)
    expect(res.source).toBe('babesource-direct')
    expect(res.posts[0].url).toBe('https://babesource.com/media/galleries/69bfc5acec79c/187270_013.jpg')
    const searchCalls = fetchMock.mock.calls.filter((c) => String(c[0]).startsWith('/booru/babe/search'))
    expect(searchCalls.length).toBe(1)
  })

  it('cools down all booru.org subdomains when any subdomain returns 429', async () => {
    vi.stubGlobal('window', {})
    const fetchMock = vi.fn(async (url: string) => {
      const u = String(url)
      if (u.startsWith('/booru/blacked')) {
        return { ok: false, status: 429 }
      }
      return { ok: false }
    })
    vi.stubGlobal('fetch', fetchMock)
    const res = await fetchPosts({ tags: 'interracial', limit: 5 })
    expect(res.ok).toBe(false)
    // Both blacked-direct and other booruorg subdomains (hgoon, qoh, etc.) should be cooling down
    fetchMock.mockClear()
    fetchMock.mockImplementation(async (url: string) => {
      const u = String(url)
      if (u.includes('booru.org') || u.startsWith('/booru/hgoon') || u.startsWith('/booru/blacked') || u.startsWith('/booru/qoh')) {
        throw new Error('booru.org should not be queried during shared 429 cooldown')
      }
      return { ok: false }
    })
    const res2 = await fetchPosts({ tags: 'interracial', limit: 5 })
    expect(res2.ok).toBe(false)
  })
})

describe('co-occurrence gate (T4)', () => {
  it('drops posts carrying a learned pair, keeps feed-intent posts', async () => {
    setCoRules([{ a: 'heterochromia', b: 'odd_eyes', count: 2 }])
    setFeedIntent([])
    const bad = { id: 'c1', url: 'https://e.test/c1.jpg', tags: ['skylar_vox', 'heterochromia', 'odd_eyes'], rating: 'e' }
    const good = { id: 'c2', url: 'https://e.test/c2.jpg', tags: ['skylar_vox', 'heterochromia'], rating: 'e' }
    vi.stubGlobal('window', { gmatch: { booruFetch: vi.fn().mockResolvedValue({ ok: true, posts: [bad, good], source: 'hgoon' }) } })
    const res = await fetchPosts({ tags: 'heterochromia', limit: 5 })
    expect(res.posts.map((p) => p.id)).toEqual(['c2'])
    // same rule, but the tag is active feed intent -> stand down
    setFeedIntent(['heterochromia'])
    __resetFeedState()
    vi.stubGlobal('window', { gmatch: { booruFetch: vi.fn().mockResolvedValue({ ok: true, posts: [bad], source: 'hgoon' }) } })
    const res2 = await fetchPosts({ tags: 'odd_eyes', limit: 5 })
    expect(res2.posts.map((p) => p.id)).toEqual(['c1'])
  })
})

describe('realbooru parser', () => {
  // realbooru serves stills as .jpeg on the full-image path (.jpg 404s,
  // verified live); video/gif posts keep their extension.
  const html = '<img src="https://realbooru.com/thumbnails/a8/9c/thumbnail_a89c.jpg" title="1girl, selfie" alt="Image: 1007254"/><img src="https://realbooru.com/thumbnails/b1/22/thumbnail_b122.jpg" title="creampie, gif" alt="Image: 999"/><img src="https://realbooru.com/thumbnails/c3/44/thumbnail_c344.jpg" title="pov, video" alt="Image: 888"/>'
  const posts = parseRealbooruHtml(html)
  it('builds .jpeg full-image URLs for stills and keeps gif/mp4 tags', () => {
    expect(posts).toHaveLength(3)
    expect(posts[0].url).toBe('https://realbooru.com/images/a8/9c/a89c.jpeg')
    expect(posts[1].url).toBe('https://realbooru.com/images/b1/22/b122.gif')
    expect(posts[2].url).toBe('https://realbooru.com/images/c3/44/c344.mp4')
  })
})

describe('non-stop feed (exhaustion → reshow)', () => {
  const mkPost = (id: string) => ({ id, url: `https://e.test/${id}.jpg`, tags: [], rating: 'e' })

  it('recallSeen rotates least-recent posts flagged repeat:true (order varies)', async () => {
    const booruFetch = vi.fn().mockResolvedValue({ ok: true, posts: [mkPost('a'), mkPost('b'), mkPost('c'), mkPost('d')], source: 't' })
    vi.stubGlobal('window', { gmatch: { booruFetch } })
    await fetchPosts({ tags: 'skylar_vox', limit: 5 })
    // Deterministic RNG: Fisher-Yates with j=0 always. Call 1 (cursor 0):
    // [a,b,c,d] -> [b,c,d,a], out [b,c]. Call 2 (cursor 2): [c,d,a,b] ->
    // [d,a,b,c], out [d,a]. Same pool, never byte-identical.
    const realRandom = Math.random
    Math.random = () => 0
    try {
      expect(recallSeen(2).map((p) => p.id)).toEqual(['b', 'c'])
      expect(recallSeen(2).map((p) => p.id)).toEqual(['d', 'a'])
    } finally {
      Math.random = realRandom
    }
    const r = recallSeen(2)
    expect(r.every((p) => p.repeat === true)).toBe(true)
    expect(r.every((p) => p.tags.length === 0)).toBe(true)
  })

  it('all-seen IPC round reports emptyFresh first, reshows on repeat contact', async () => {
    const booruFetch = vi.fn().mockResolvedValue({ ok: true, posts: [mkPost('x1')], source: 't' })
    vi.stubGlobal('window', { gmatch: { booruFetch } })
    const first = await fetchPosts({ tags: 'skylar_vox', limit: 5 })
    expect(first.posts.map((p) => p.id)).toEqual(['x1'])
    const second = await fetchPosts({ tags: 'skylar_vox', limit: 5 })
    expect(second.ok).toBe(false)
    expect(second.emptyFresh).toBe(true)
    expect(second.offline).toBeUndefined()
    const third = await fetchPosts({ tags: 'skylar_vox', limit: 5 })
    expect(third.ok).toBe(true)
    expect(third.source).toBe('reshow')
    expect(third.posts[0]).toMatchObject({ id: 'x1', repeat: true })
  })

  it('clearMirrorCooldowns keeps no-repeat memory intact', async () => {
    const booruFetch = vi.fn().mockResolvedValue({ ok: true, posts: [mkPost('y1')], source: 't' })
    vi.stubGlobal('window', { gmatch: { booruFetch } })
    await fetchPosts({ tags: 'skylar_vox', limit: 5 })
    clearMirrorCooldowns()
    const res = await fetchPosts({ tags: 'skylar_vox', limit: 5 })
    expect(res.posts).toEqual([])
    expect(res.emptyFresh).toBe(true)
  })
})

describe('roundRobin (every gallery contributes)', () => {
  const p = (id: string) => ({ id, url: `https://e.test/${id}.jpg`, tags: [] as string[], rating: 'e' })
  it('takes one per gallery per turn instead of first-fills-batch', () => {
    const out = roundRobin(
      [[p('g1a'), p('g1b'), p('g1c')], [p('g2a')], [p('g3a'), p('g3b')]],
      5,
    )
    expect(out.map((x) => x.id)).toEqual(['g1a', 'g2a', 'g3a', 'g1b', 'g3b'])
  })
  it('caps at limit and skips empty sets', () => {
    expect(roundRobin([[], [p('a')], []], 10).map((x) => x.id)).toEqual(['a'])
    expect(roundRobin([[p('a'), p('b')]], 1).map((x) => x.id)).toEqual(['a'])
  })
})

describe('interleaveBatches (recency-weighted tag mix)', () => {
  const p = (id: string) => ({ id, url: `https://e.test/${id}.jpg`, tags: [] as string[], rating: 'e' })
  it('gives the priority tag every other slot (~50%)', () => {
    const out = interleaveBatches(
      [
        { tag: 'new', posts: [p('n1'), p('n2'), p('n3'), p('n4')] },
        { tag: 'old', posts: [p('o1'), p('o2'), p('o3'), p('o4')] },
      ],
      'new',
    )
    expect(out.map((x) => x.id)).toEqual(['n1', 'o1', 'n2', 'o2', 'n3', 'o3', 'n4', 'o4'])
  })
  it('rotates the rest when several non-priority tags share the round', () => {
    const out = interleaveBatches(
      [
        { tag: 'new', posts: [p('n1'), p('n2')] },
        { tag: 'b', posts: [p('b1')] },
        { tag: 'c', posts: [p('c1')] },
      ],
      'new',
    )
    expect(out.map((x) => x.id)).toEqual(['n1', 'b1', 'n2', 'c1'])
  })
  it('passes a single batch through untouched; no priority = plain round-robin', () => {
    const solo = interleaveBatches([{ tag: 'a', posts: [p('a1'), p('a2')] }], 'a')
    expect(solo.map((x) => x.id)).toEqual(['a1', 'a2'])
    const rr = interleaveBatches(
      [{ tag: 'a', posts: [p('a1')] }, { tag: 'b', posts: [p('b1'), p('b2')] }],
      null,
    )
    expect(rr.map((x) => x.id)).toEqual(['a1', 'b1', 'b2'])
  })
})

describe('mapLimit (bounded gallery lanes)', () => {
  it('caps in-flight work and keeps input order', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const out = await mapLimit([1, 2, 3, 4, 5], 2, async (n) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      return n * 10
    })
    expect(out).toEqual([10, 20, 30, 40, 50])
    expect(maxInFlight).toBeLessThanOrEqual(2)
  })
  it('drops failures without killing the batch', async () => {
    const out = await mapLimit([1, 2, 3], 3, async (n) => {
      if (n === 2) throw new Error('dead gallery')
      return n
    })
    expect(out).toEqual([1, 3])
  })
})

describe('recallSeen tag preference (no cross-tag leftovers)', () => {
  const mkPost = (id: string) => ({ id, url: `https://e.test/${id}.jpg`, tags: [], rating: 'e' })
  it('serves same-tag history first even when it is not least-recent', async () => {
    const booruFetch = vi.fn().mockResolvedValue({ ok: true, posts: [], source: 't' })
    vi.stubGlobal('window', { gmatch: { booruFetch } })
    // Ledger order: old-tag posts first, new-tag posts second.
    booruFetch.mockResolvedValueOnce({ ok: true, posts: [mkPost('old1'), mkPost('old2')], source: 't' })
    await fetchPosts({ tags: 'old_tag', limit: 5 })
    booruFetch.mockResolvedValueOnce({ ok: true, posts: [mkPost('new1')], source: 't' })
    await fetchPosts({ tags: 'new_tag', limit: 5 })
    // Rotation starts at old1 — but the new tag must recall its own first.
    // (Single-element groups are shuffle-proof; the filler may be either leftover.)
    const out = recallSeen(2, 'new_tag').map((p) => p.id)
    expect(out[0]).toBe('new1')
    expect(['old1', 'old2']).toContain(out[1])
  })
})

describe('fetchPostsMulti (one round, every tag)', () => {
  const mkPost = (id: string, tag: string) => ({ id, url: `https://e.test/${id}.jpg`, tags: [tag], rating: 'e' })
  it('fans out concurrently and interleaves with priority weight', async () => {
    const booruFetch = vi.fn(async (req: { tags: string }) => ({
      ok: true,
      source: 't',
      posts: req.tags === 'gangbang' ? [mkPost('a1', 'gangbang'), mkPost('a2', 'gangbang')] : [mkPost('b1', 'skylar_vox'), mkPost('b2', 'skylar_vox')],
    }))
    vi.stubGlobal('window', { gmatch: { booruFetch } })
    const res = await fetchPostsMulti({ tags: ['gangbang', 'skylar_vox'], limit: 4, priority: 'gangbang' })
    expect(res.ok).toBe(true)
    expect(booruFetch).toHaveBeenCalledTimes(2)
    // priority every other slot: a1, b1, a2, b2
    expect(res.posts.map((p) => p.id)).toEqual(['a1', 'b1', 'a2', 'b2'])
  })
  it('accounts exhaustion once per round, not once per tag', async () => {
    // seen1 memoized by the first round; the two-tag round replays it on
    // both lanes. Without single-round accounting the streak would hit 2
    // and instantly reshow — expect one gentle emptyFresh instead.
    const booruFetch = vi.fn().mockResolvedValue({ ok: true, posts: [mkPost('seen1', 'gangbang')], source: 't' })
    vi.stubGlobal('window', { gmatch: { booruFetch } })
    await fetchPostsMulti({ tags: ['gangbang'], limit: 5 })
    const res = await fetchPostsMulti({ tags: ['gangbang', 'skylar_vox'], limit: 5 })
    expect(res.ok).toBe(false)
    expect(res.emptyFresh).toBe(true)
  })
  it('a new tag set resets exhaustion (no other-tag leftovers as fresh)', async () => {
    const seen = mkPost('seen1', 'gangbang')
    const booruFetch = vi.fn().mockResolvedValue({ ok: true, posts: [seen], source: 't' })
    vi.stubGlobal('window', { gmatch: { booruFetch } })
    await fetchPostsMulti({ tags: ['gangbang'], limit: 5 })
    // Second dead round on gangbang...
    await fetchPostsMulti({ tags: ['gangbang'], limit: 5 })
    // ...must not leak a reshow of gangbang history into a fresh skylar_vox query.
    const res = await fetchPostsMulti({ tags: ['skylar_vox'], limit: 5 })
    expect(res.ok).toBe(false)
    expect(res.emptyFresh).toBe(true)
    expect(res.source).not.toBe('reshow')
  })
  it('total failure on every tag reports offline, never throws', async () => {
    const booruFetch = vi.fn().mockResolvedValue({ posts: [], source: null, ok: false })
    vi.stubGlobal('window', { gmatch: { booruFetch } })
    const res = await fetchPostsMulti({ tags: ['aaa', 'bbb'], limit: 5 })
    expect(res.ok).toBe(false)
    expect(res.offline).toBe(true)
  })
})

describe('deep random sampling (repeat-fix 2026-09-15)', () => {
  it('DAPI pid offset reaches the ~1000-post pool; probes stay shallow at 0', async () => {
    vi.stubGlobal('window', {})
    const urls: string[] = []
    const fetchMock = vi.fn(async (url: string) => {
      urls.push(String(url))
      return { ok: true, json: () => Promise.resolve([]), text: () => Promise.resolve('') }
    })
    vi.stubGlobal('fetch', fetchMock)
    const realRandom = Math.random
    Math.random = () => 0.999
    try {
      await fetchPosts({ tags: 'test_tag', limit: 15 })
      const roundPids = urls.filter((u) => u.includes('page=dapi')).map((u) => new URL(u, 'http://x').searchParams.get('pid'))
      // rand 0.999 * 1000 -> pid 999 (was rand*5 -> pid 4: the same ~20 newest
      // posts per tag every round — the reported repeat).
      expect(roundPids.length).toBeGreaterThan(0)
      expect(roundPids).toContain('999')
      urls.length = 0
      await fetchPosts({ tags: 'test_tag', limit: 15, probe: true })
      const probePids = urls.filter((u) => u.includes('page=dapi')).map((u) => new URL(u, 'http://x').searchParams.get('pid'))
      expect(probePids.length).toBeGreaterThan(0)
      expect(probePids.every((p) => p === '0')).toBe(true)
    } finally {
      Math.random = realRandom
    }
  })
})

describe('silent validation (probe/market never poison the pool)', () => {
  const p = (id: string) => ({ id, url: `https://e.test/${id}.jpg`, tags: ['skylar_vox'], rating: 'e' })
  it('checks servability without memoizing: ledger, seen-set untouched', async () => {
    const booruFetch = vi.fn().mockResolvedValue({ ok: true, posts: [p('s1'), p('s2')], source: 't' })
    vi.stubGlobal('window', { gmatch: { booruFetch } })
    const res = await fetchPosts({ tags: 'skylar_vox', limit: 5, silent: true })
    expect(res.ok).toBe(true)
    expect(res.posts.map((x) => x.id)).toEqual(['s1', 's2'])
    // Nothing memoized: the same pictures are still "new" afterwards.
    expect(isSeen('s1', 'https://e.test/s1.jpg')).toBe(false)
    expect(recallSeen(5, 'skylar_vox')).toEqual([])
    const res2 = await fetchPosts({ tags: 'skylar_vox', limit: 5 })
    expect(res2.posts.map((x) => x.id)).toEqual(['s1', 's2'])
  })
})

describe('drawFreshPid/drawFreshPage (sampling without replacement)', () => {
  it('covers every page before repeating while alternatives exist', () => {
    const seq = [0.1, 0.3, 0.5, 0.7, 0.9]
    let i = 0
    const rand = () => seq[i++ % seq.length]
    const draws = Array.from({ length: 5 }, () => drawFreshPid('cov', 5, rand))
    expect([...draws].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4])
  })
  it('accepts a repeat for tiny pools instead of hanging', () => {
    expect(drawFreshPid('tiny', 1, () => 0.5)).toBe(0)
    expect(drawFreshPid('tiny', 1, () => 0.5)).toBe(0)
  })
  it('drawFreshPage stays 1-based within bounds', () => {
    for (let i = 0; i < 20; i++) {
      const p = drawFreshPage('bnd', 5)
      expect(p).toBeGreaterThanOrEqual(1)
      expect(p).toBeLessThanOrEqual(5)
    }
  })
})

describe('post-view expansion (exact file URLs, live-verified markup)', () => {
  const RB_LIST =
    '<div class="col thumb" id="s1000087"><a id="p1000087" href="https://realbooru.com/index.php?page=post&s=view&id=1000087">' +
    '<img src="https://realbooru.com/thumbnails/e5/9e/thumbnail_e59e2458228685aa29c9e661d0da1ff7.jpg" title="1boy, skylar vox, tattoo" alt="Image: 1000087" style=""/></a></div>' +
    '<div class="col thumb" id="s1000088"><img src="https://realbooru.com/thumbnails/e5/9e/thumbnail_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg" title="1girl, solo" alt="Image: 1000088"/></div>'
  const RB_VIEW_VIDEO =
    '<video style="width: 100%;" controls loop id="gelcomVideoPlayer">' +
    '<source src="https://realbooru.com//images/fc/14/fc14a7833ef171023deb3d10b841ee7e.mp4" type="video/mp4" />' +
    '<source src="https://realbooru.com//images/fc/14/fc14a7833ef171023deb3d10b841ee7e.webm" type="video/webm" /></video>'
  const RB_VIEW_STILL =
    '<img style="max-width: 100%;" alt="1girl skylar vox" src="https://realbooru.com//images/ba/c3/bac3a43e967d7a5f5201127198858d03.jpeg" id="image" onclick="javascript:; return false;"/>'
  const BO_LIST =
    '<span class="thumb"><a id="p119629" href="index.php?page=post&s=view&id=119629">' +
    '<img src="https://thumbs.booru.org/blacked/thumbnails//105/thumbnail_13e95013be4d2c3693717879294adbfa6ec94218.png" alt="post" border="0" title=" ass bbc score:2 rating:Explicit"/></a>'
  const BO_VIEW =
    '<div id="note-container"><img alt="img" src="https://img.booru.org/blacked//images/105/13e95013be4d2c3693717879294adbfa6ec94218.png" id="image" onclick="Note.toggle();" style="margin-right: 70px;"/>'

  it('parseRealbooruEntries captures view ids, keeps guessed urls', () => {
    const entries = parseRealbooruEntries(RB_LIST)
    expect(entries).toHaveLength(2)
    expect(entries[0].postId).toBe('1000087')
    expect(entries[0].tags).toContain('skylar_vox')
    expect(entries[0].url).toContain('/images/e5/9e/')
    expect(entries[1].postId).toBe('1000088')
  })

  it('parseRealbooruPost prefers the mp4 source on video pages', () => {
    expect(parseRealbooruPost(RB_VIEW_VIDEO)).toEqual({
      url: 'https://realbooru.com//images/fc/14/fc14a7833ef171023deb3d10b841ee7e.mp4',
      kind: 'video',
    })
  })

  it('parseRealbooruPost takes the id=image still regardless of attribute order', () => {
    expect(parseRealbooruPost(RB_VIEW_STILL)).toEqual({
      url: 'https://realbooru.com//images/ba/c3/bac3a43e967d7a5f5201127198858d03.jpeg',
      kind: 'image',
    })
  })

  it('parseRealbooruPost falls back to the Original link, null on garbage', () => {
    expect(
      parseRealbooruPost('<a style="color: #fff;" href="https://realbooru.com//images/x/y.webm">Original</a>'),
    ).toEqual({ url: 'https://realbooru.com//images/x/y.webm', kind: 'video' })
    expect(parseRealbooruPost('<div>no file here</div>')).toBeNull()
    expect(parseRealbooruPost(null)).toBeNull()
  })

  it('parseBooruOrgEntries captures relative view links', () => {
    const entries = parseBooruOrgEntries(BO_LIST)
    expect(entries).toHaveLength(1)
    expect(entries[0].postId).toBe('119629')
    expect(entries[0].url).toBe('https://img.booru.org/blacked//images/105/13e95013be4d2c3693717879294adbfa6ec94218.png')
    expect(entries[0].tags).toContain('bbc')
  })

  it('parseBooruOrgPost takes the id=image file url', () => {
    expect(parseBooruOrgPost(BO_VIEW)).toEqual({
      url: 'https://img.booru.org/blacked//images/105/13e95013be4d2c3693717879294adbfa6ec94218.png',
      kind: 'image',
    })
    expect(parseBooruOrgPost('<div>no file</div>')).toBeNull()
  })

  it('expandPostViews swaps exact urls, falls back to guessed on failure', async () => {
    vi.stubGlobal('window', {})
    const fetchMock = vi.fn(async (url: string) => {
      const u = String(url)
      if (u.includes('id=1000087')) return { ok: true, text: () => Promise.resolve(RB_VIEW_STILL) }
      return { ok: false, status: 404 }
    })
    vi.stubGlobal('fetch', fetchMock)
    const out = await expandPostViews(parseRealbooruEntries(RB_LIST), '/booru/real', parseRealbooruPost)
    expect(out).toHaveLength(2)
    // Expanded: exact view-page file.
    expect(out[0].url).toBe('https://realbooru.com//images/ba/c3/bac3a43e967d7a5f5201127198858d03.jpeg')
    expect(out[0].kind).toBe('image')
    // Failed view fetch: guessed url kept, round survives.
    expect(out[1].url).toContain('/images/e5/9e/')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('realbooru list omits pid (nonzero pid blanks small pools), expands s=view ids', async () => {
    // Live: skylar_vox base list carries 42 thumbs while pid=500 returns a
    // blank page — so the list URL must not page via pid at all.
    vi.stubGlobal('window', {})
    const listUrls: string[] = []
    const fetchMock = vi.fn(async (url: string) => {
      const u = String(url)
      if (u.startsWith('/booru/real')) {
        if (u.includes('s=view')) return { ok: true, text: () => Promise.resolve(RB_VIEW_STILL) }
        listUrls.push(u)
        return { ok: true, text: () => Promise.resolve(RB_LIST) }
      }
      return { ok: true, json: () => Promise.resolve([]), text: () => Promise.resolve('') }
    })
    vi.stubGlobal('fetch', fetchMock)
    const res = await fetchPosts({ tags: 'skylar_vox', limit: 5 })
    expect(listUrls).toHaveLength(1)
    expect(listUrls[0]).toContain('s=list')
    expect(listUrls[0]).toContain('tags=skylar_vox')
    expect(listUrls[0]).not.toContain('pid=')
    expect(res.ok).toBe(true)
    expect(res.posts[0].url).toBe('https://realbooru.com//images/ba/c3/bac3a43e967d7a5f5201127198858d03.jpeg')
  })

  it('redgifs refuses a fragment-only niche: foreign posts ship unstamped and die in sanitize', async () => {
    // Fresh query (no 1h niche-cache poisoning from other tests): `sky-high`
    // shares only the `sky` fragment with the query — electing it used to
    // stamp foreign posts with the query tags (wrong-tag rounds).
    vi.stubGlobal('window', {})
    const gif = {
      id: 'foreignabc',
      width: 1080,
      height: 1920,
      tags: ['Amateur', 'BBC'],
      niches: [],
      urls: {
        hd: 'https://media.redgifs.com/Foreignabc.mp4',
        poster: 'https://media.redgifs.com/Foreignabc-poster.jpg',
      },
    }
    const seen: string[] = []
    const fetchMock = vi.fn(async (url: string) => {
      const u = String(url)
      seen.push(u)
      if (u.startsWith('/booru/tbib/') || u.startsWith('/booru/xbooru/')) {
        return { ok: true, json: () => Promise.resolve([]) }
      }
      if (u.includes('/auth/temporary')) {
        return { ok: true, json: () => Promise.resolve({ token: 'tok' }) }
      }
      if (u.includes('/v2/niches/search')) {
        return {
          ok: true,
          json: () =>
            Promise.resolve({
              niches: [{ id: 'sky-high', name: 'Sky High', tags: ['Sky'], subscribers: 999999 }],
            }),
        }
      }
      if (u.includes('/v2/niches/sky-high/gifs') || u.includes('/v2/gifs/search')) {
        return { ok: true, json: () => Promise.resolve({ gifs: [gif] }) }
      }
      return { ok: false }
    })
    vi.stubGlobal('fetch', fetchMock)
    const res = await fetchPosts({ tags: 'skylar_vox_mistag', limit: 10 })
    // Fragment niche refused: generic fallback used, native tags kept, and
    // sanitize drops the foreign post instead of serving it as the query.
    expect(seen.some((u) => u.includes('/v2/gifs/search'))).toBe(true)
    expect(seen.some((u) => u.includes('/niches/sky-high/'))).toBe(false)
    expect(res.ok).toBe(false)
    expect(res.posts).toHaveLength(0)
  })

  it('matchesQuery refuses short-tag fragments (sky is not skylar_vox)', async () => {
    vi.stubGlobal('window', {})
    const skyPost = {
      id: 1,
      directory: 1,
      image: 'a.jpg',
      width: 100,
      height: 100,
      rating: 'explicit',
      tags: 'sky clouds landscape',
    }
    const fetchMock = vi.fn(async (url: string) => {
      const u = String(url)
      if (u.startsWith('/booru/tbib/')) return { ok: true, json: () => Promise.resolve([skyPost]) }
      return { ok: false }
    })
    vi.stubGlobal('fetch', fetchMock)
    const res = await fetchPosts({ tags: 'skylar_vox', limit: 10 })
    expect(res.ok).toBe(false)
    expect(res.posts).toHaveLength(0)
  })
})
