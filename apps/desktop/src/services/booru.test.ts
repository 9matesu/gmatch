import { afterEach, describe, expect, it, vi } from 'vitest'
import { __resetFeedState, clearMirrorCooldowns, fetchPosts, markSeen, parseRealbooruHtml, recallSeen } from './booru'
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
      '<div class="gallery"><a href="/gallery/999/"><img/></a></div>'
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
    expect(galleryHits).toBe(1) // fail-fast: first 403 cools imh-direct, no further galleries this round
    // Second round: imh-direct is cooling down — no gallery fetches at all.
    await fetchPosts({ tags: 'creampie', limit: 5 })
    const galleryHits2 = fetchMock.mock.calls.filter((a) => String(a[0]).startsWith('/booru/imh/gallery')).length
    expect(galleryHits2).toBe(1)
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

  it('extracts imhentai covers directly from search HTML without requesting /gallery/<id>', async () => {
    vi.stubGlobal('window', {})
    const searchHtml =
      '<div class="thumb"><div class="inner_thumb"><a href="/gallery/777/"><img class="lazy" data-src="https://m1.imhentai.xxx/001/a/thumb.jpg" /></a></div></div>'
    const fetchMock = vi.fn(async (url: string) => {
      const u = String(url)
      if (u.startsWith('/booru/imh/search')) {
        return { ok: true, text: () => Promise.resolve(searchHtml) }
      }
      if (u.startsWith('/booru/imh/gallery')) {
        throw new Error('should not fetch individual gallery when thumbnails are in search')
      }
      return { ok: false }
    })
    vi.stubGlobal('fetch', fetchMock)
    const res = await fetchPosts({ tags: 'doujin_caption', limit: 5 })
    expect(res.ok).toBe(true)
    expect(res.source).toBe('imh-direct')
    expect(res.posts[0].id).toBe('imh-777')
    expect(res.posts[0].url).toBe('https://m1.imhentai.xxx/001/a/1.jpg')
    expect(res.posts[0].preview).toBe('https://m1.imhentai.xxx/001/a/thumb.jpg')
    const galleryCalls = fetchMock.mock.calls.filter((c) => String(c[0]).startsWith('/booru/imh/gallery'))
    expect(galleryCalls.length).toBe(0)
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

  it('recallSeen rotates least-recent posts flagged repeat:true', async () => {
    const booruFetch = vi.fn().mockResolvedValue({ ok: true, posts: [mkPost('a'), mkPost('b'), mkPost('c')], source: 't' })
    vi.stubGlobal('window', { gmatch: { booruFetch } })
    await fetchPosts({ tags: 'skylar_vox', limit: 5 })
    expect(recallSeen(2).map((p) => p.id)).toEqual(['a', 'b'])
    expect(recallSeen(2).map((p) => p.id)).toEqual(['c', 'a'])
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
