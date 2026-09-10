import { afterEach, describe, expect, it, vi } from 'vitest'
import { __resetFeedState, fetchPosts } from './booru'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  __resetFeedState()
})

describe('fetchPosts (SPEC §6/§8)', () => {
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
    expect(res.posts[0].id).toBe('imh-999')
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
    expect(galleryHits).toBe(2) // both dead galleries tried once
    // Second round: imh-direct is cooling down — no gallery fetches at all.
    await fetchPosts({ tags: 'creampie', limit: 5 })
    const galleryHits2 = fetchMock.mock.calls.filter((a) => String(a[0]).startsWith('/booru/imh/gallery')).length
    expect(galleryHits2).toBe(2)
  })
})
