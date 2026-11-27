import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchPosts, __resetFeedState } from './booru'

const FAILING_URL = 'https://x.com/TimbyWuff/status/2126355778718085341/video/1'
const MP4 = 'https://video.twimg.com/amplify_video/2126355778718085341/vid/avc1/1280x720/abc.mp4'

afterEach(() => {
  vi.unstubAllGlobals()
  __resetFeedState()
})

function vxResponse(tags: string[] = ['blonde']) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      text: `clip ${tags.map((t) => `#${t}`).join(' ')}`,
      media_extended: [{ type: 'video', url: MP4, variants: [{ content_type: 'video/mp4', bitrate: 832000, url: MP4 }] }],
    }),
  }
}

describe('fetchPosts with an X status link', () => {
  it('resolves the exact failing /video/1 link to a playable video post', async () => {
    const fetchMock = vi.fn(async (_url: string) => vxResponse())
    vi.stubGlobal('fetch', fetchMock)
    // No IPC bridge in this test: the direct path is the one being pinned.
    vi.stubGlobal('window', undefined)

    const res = await fetchPosts({ tags: FAILING_URL, limit: 5 })
    expect(res.ok).toBe(true)
    expect(res.source).toBe('x-status')
    expect(res.posts).toHaveLength(1)
    expect(res.posts[0].url).toContain('video.twimg.com')
    expect(res.posts[0].url).toMatch(/\.mp4/)
    expect(res.posts[0].kind).toBe('video')
    expect(res.posts[0].rating).toBe('e')
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.vxtwitter.com/TimbyWuff/status/2126355778718085341')
  })

  it('honestly reports an offline resolver failure with its reason', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    vi.stubGlobal('window', undefined)
    const res = await fetchPosts({ tags: FAILING_URL, limit: 5 })
    expect(res.ok).toBe(false)
    expect(res.offline).toBe(true)
    expect(res.reason).toBe('offline')
    expect(res.posts).toHaveLength(0)
  })

  it('surfaces "no-media" as an answered round, not an outage', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ text: 'no clip' }) })))
    vi.stubGlobal('window', undefined)
    const res = await fetchPosts({ tags: FAILING_URL, limit: 5 })
    expect(res).toMatchObject({ ok: false, offline: false, reason: 'no-media' })
    expect(res.posts).toHaveLength(0)
  })

  it('keeps the blocklist gate: a tweet tagged with a blocked term is refused', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => vxResponse(['teen'])))
    vi.stubGlobal('window', undefined)
    const res = await fetchPosts({ tags: FAILING_URL, limit: 5 })
    expect(res.ok).toBe(false)
    expect(res.posts).toHaveLength(0)
  })
})
