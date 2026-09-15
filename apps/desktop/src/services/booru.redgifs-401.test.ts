import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const GIF = {
  id: 'dentalswelteringdwarfrabbit',
  width: 1080,
  height: 1920,
  tags: ['BBC'],
  niches: [],
  urls: {
    hd: 'https://media.redgifs.com/DentalSwelteringDwarfrabbit.mp4',
    poster: 'https://media.redgifs.com/DentalSwelteringDwarfrabbit-poster.jpg',
  },
}

describe('redgifsDirect 401 recovery', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('drops the cached token and retries once with a fresh token', async () => {
    const seen: { url: string; auth: string | null }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const auth = (init?.headers as Record<string, string> | undefined)?.Authorization ?? null
        seen.push({ url, auth })
        if (url.includes('/v2/auth/temporary')) {
          const n = seen.filter((s) => s.url.includes('/v2/auth/temporary')).length
          return {
            ok: true,
            status: 200,
            json: async () => ({ token: n === 1 ? 'first' : 'second' }),
          } as Response
        }
        if (auth === 'Bearer first') {
          return { ok: false, status: 401, json: async () => ({}) } as Response
        }
        return { ok: true, status: 200, json: async () => ({ gifs: [GIF] }) } as Response
      }),
    )
    const { redgifsDirect } = await import('./booru')
    const posts = await redgifsDirect('kenzie reeves', 30)
    expect(posts).not.toBeNull()
    expect(posts).toHaveLength(1)
    expect(seen.some((s) => s.auth === 'Bearer second' && s.url.includes('/v2/gifs/search'))).toBe(true)
  })

  it('prefers niche-targeted gifs tagged with the query over generic trending', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/v2/auth/temporary')) {
          return { ok: true, status: 200, json: async () => ({ token: 'tok' }) } as Response
        }
        if (url.includes('/v2/niches/search')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              niches: [{ id: 'fair-haired', name: 'Fair-Haired', tags: ['Blonde'], subscribers: 100 }],
            }),
          } as Response
        }
        if (url.includes('/v2/niches/fair-haired/gifs')) {
          return { ok: true, status: 200, json: async () => ({ gifs: [GIF] }) } as Response
        }
        throw new Error(`unexpected fetch: ${url}`)
      }),
    )
    const { redgifsDirect } = await import('./booru')
    const posts = await redgifsDirect('blonde', 10)
    expect(posts).toHaveLength(1)
    expect(posts![0].url).toMatch(/mp4$/)
    // niche items ship untagged upstream — the matched query tags are attached
    expect(posts![0].tags).toContain('blonde')
    expect(posts![0].tags).toContain('bbc')
  })

  it('falls back to generic trending when no niche matches (pornstar names)', async () => {
    const seen: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        seen.push(url)
        if (url.includes('/v2/auth/temporary')) {
          return { ok: true, status: 200, json: async () => ({ token: 'tok' }) } as Response
        }
        if (url.includes('/v2/niches/search')) {
          return { ok: true, status: 200, json: async () => ({ niches: [] }) } as Response
        }
        if (url.includes('/v2/gifs/search')) {
          return { ok: true, status: 200, json: async () => ({ gifs: [GIF] }) } as Response
        }
        throw new Error(`unexpected fetch: ${url}`)
      }),
    )
    const { redgifsDirect } = await import('./booru')
    const posts = await redgifsDirect('kenzie reeves', 10)
    expect(posts).toHaveLength(1)
    expect(seen.some((u) => u.includes('/v2/gifs/search'))).toBe(true)
  })
})
