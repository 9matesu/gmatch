import { describe, it, expect, vi, afterEach } from 'vitest'
import { classifyAndResolve } from './proxy'

const html = (body: string, ct = 'text/html') =>
  ({ ok: true, headers: { get: (k: string) => (k === 'content-type' ? ct : null) }, text: async () => body }) as unknown as Response

afterEach(() => {
  vi.unstubAllGlobals()
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
