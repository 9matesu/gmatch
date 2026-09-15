import { describe, it, expect, vi, afterEach } from 'vitest'
import { classifyAndResolve, extractEmbeddedVideo, extractPageTitle, pageTitleFor } from './proxy'

const html = (body: string, ct = 'text/html') =>
  ({ ok: true, headers: { get: (k: string) => (k === 'content-type' ? ct : null) }, text: async () => body }) as unknown as Response

afterEach(() => {
  vi.unstubAllGlobals()
})


describe('extractEmbeddedVideo (all playable formats)', () => {
  it('finds webm/mov/m4v urls with query strings and <video>/<source> tags', () => {
    expect(extractEmbeddedVideo('x https://cdn.t/a.webm?tok=1 y')).toContain('.webm')
    expect(extractEmbeddedVideo('<video><source src="https://c.t/x.m4v" type="video/mp4"></video>')).toBe('https://c.t/x.m4v')
    expect(extractEmbeddedVideo('nope <script>var a=".fake.mp4"</script>')).toBeNull()
  })
})

describe('extractPageTitle', () => {
  it('prefers og:title over <title>, decodes entities', () => {
    expect(extractPageTitle('<meta property="og:title" content="OG Title"><title>Plain</title>')).toBe('OG Title')
    expect(extractPageTitle('<title>Only &amp; This</title>')).toBe('Only & This')
    expect(extractPageTitle('<html></html>')).toBeNull()
  })
})

describe('pageTitleFor stash', () => {
  it('captures the page title while resolving', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      html('<meta property="og:title" content="Chloe 19 YO"><p>https://cdn.t/a.mp4</p>')))
    const out = await classifyAndResolve('https://pmvhaven.example/video/show_abc')
    expect(out).toContain('.mp4')
    expect(pageTitleFor('https://pmvhaven.example/video/show_abc')).toBe('Chloe 19 YO')
  })
})

describe('classifyAndResolve (post-modal URL uploads)', () => {
  it('resolves redgifs watch pages via og:video meta', async () => {
    const fetchMock = vi.fn(async () =>
      html('<html><head><meta property="og:video:secure_url" content="https://media.redgifs.com/abc123.mp4" /></head></html>'),
    )
    vi.stubGlobal('fetch', fetchMock)
    expect(await classifyAndResolve('https://www.redgifs.com/watch/abc123')).toBe(
      'https://media.redgifs.com/abc123.mp4',
    )
  })

  it('falls back to generic og:image for unknown article pages', async () => {
    const fetchMock = vi.fn(async () =>
      html('<html><head><meta property="og:image" content="https://cdn.example.com/pic.jpg" /></head></html>'),
    )
    vi.stubGlobal('fetch', fetchMock)
    expect(await classifyAndResolve('https://example.com/some/article')).toBe(
      'https://cdn.example.com/pic.jpg',
    )
  })

  it('resolves pmvhaven video pages (escaped JSON, no og:video)', async () => {
    const page = '<html><head><meta property="og:image" content="https://pmvhavencloud.s3.eu-west-par.io.cloud.ovh.net/thumbnails/abc/thumb_lg.webp" /></head><body>{"sources":[{"file":"https:\\u002F\\u002Fpmvhavencloud.s3.eu-west-par.io.cloud.ovh.net\\u002Fvideos\\u002Fshow_1b093l3k.mp4\\u002Fmaster.m3u8"},{"file":"https:\\u002F\\u002Fpmvhavencloud.s3.eu-west-par.io.cloud.ovh.net\\u002Fvideos\\u002Fshow_1b093l3k.mp4"}]}</body></html>'
    vi.stubGlobal('fetch', vi.fn(async () => html(page)))
    expect(await classifyAndResolve('https://pmvhaven.com/video/show_abc?from=home')).toBe(
      'https://pmvhavencloud.s3.eu-west-par.io.cloud.ovh.net/videos/show_1b093l3k.mp4',
    )
  })

  it('passes direct file URLs through without fetching', async () => {
    const fetchMock = vi.fn(async () => { throw new Error('must not fetch') })
    vi.stubGlobal('fetch', fetchMock)
    expect(await classifyAndResolve('https://cdn.example.com/clip.mp4')).toBe(
      'https://cdn.example.com/clip.mp4',
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns null for garbage; unresolvable pages pass through for proxy validation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => html('<html><head></head></html>')))
    expect(await classifyAndResolve('not a url')).toBeNull()
    expect(await classifyAndResolve('https://example.com/blank')).toBe(
      'https://example.com/blank',
    )
  })
})
