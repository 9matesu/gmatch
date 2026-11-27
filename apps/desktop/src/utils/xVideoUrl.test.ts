import { describe, expect, it, vi } from 'vitest'
import { resolveXStatusMedia, xStatusApiUrl } from './xVideoUrl'

/** The reported broken link — kept verbatim so a future suffix regression fails here. */
 const FAILING_URL = 'https://x.com/TimbyWuff/status/2126355778718085341/video/1'
const MP4 = 'https://video.twimg.com/amplify_video/2126355778718085341/vid/avc1/1280x720/abc.mp4'

describe('xStatusApiUrl', () => {
  it('strips the /video/1 page suffix from the exact failing link', () => {
    expect(xStatusApiUrl(FAILING_URL)).toBe('https://api.vxtwitter.com/TimbyWuff/status/2126355778718085341')
  })

  it('handles twitter.com and query/fragment, and refuses non-status links', () => {
    expect(xStatusApiUrl('https://twitter.com/u/status/123?s=20')).toBe('https://api.vxtwitter.com/u/status/123')
    expect(xStatusApiUrl('https://x.com/u')).toBeNull()
    expect(xStatusApiUrl('https://evil.test/u/status/123')).toBeNull()
    expect(xStatusApiUrl('javascript:alert(1)')).toBeNull()
  })
})

describe('resolveXStatusMedia', () => {
  it('turns the reported X video link into a playable mp4 URL', async () => {
    const fetchMock = vi.fn(async (_url: string) => ({
      ok: true,
      status: 200,
      json: async () => ({
        text: 'clip #blonde',
        media_extended: [{
          type: 'video',
          url: MP4,
          variants: [
            { content_type: 'video/mp4', bitrate: 832000, url: MP4 },
            { content_type: 'video/mp4', bitrate: 2176000, url: MP4 + '?high=1' },
          ],
        }],
      }),
    }))
    const got = await resolveXStatusMedia(FAILING_URL, { fetch: fetchMock as unknown as typeof fetch })
    expect(got.ok).toBe(true)
    if (!got.ok) return
    expect(got.url).toContain('video.twimg.com')
    expect(got.url).toMatch(/\.mp4/)
    expect(got.kind).toBe('video')
    expect(got.id).toBe('2126355778718085341')
    expect(got.tags).toContain('blonde')
    // No fabricated poster field exists on the success result.
    expect('preview' in got).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.vxtwitter.com/TimbyWuff/status/2126355778718085341')
  })

  it('reports an explicit reason when the resolver is offline', async () => {
    const fetchMock = vi.fn(async () => { throw new Error('ENOTFOUND') })
    const got = await resolveXStatusMedia(FAILING_URL, { fetch: fetchMock as unknown as typeof fetch })
    expect(got).toMatchObject({ ok: false, reason: 'offline', sourceUrl: FAILING_URL })
  })

  it('never passes the status page off as playable media', async () => {
    const fetchMock = vi.fn(async (_url: string) => ({
      ok: true,
      status: 200,
      json: async () => ({ media_extended: [{ type: 'video', url: FAILING_URL }] }),
    }))
    expect(await resolveXStatusMedia(FAILING_URL, { fetch: fetchMock as unknown as typeof fetch }))
      .toMatchObject({ ok: false, reason: 'no-media' })
  })

  it('refuses a non-status URL before any network call', async () => {
    const fetchMock = vi.fn()
    expect(await resolveXStatusMedia('https://x.com/u', { fetch: fetchMock as unknown as typeof fetch }))
      .toMatchObject({ ok: false, reason: 'not-x-status' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
