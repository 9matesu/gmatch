import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchPosts } from './booru'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('fetchPosts (SPEC §6/§8)', () => {
  it('uses the Electron IPC bridge when present', async () => {
    const booruFetch = vi.fn().mockResolvedValue({
      posts: [{ id: '1', url: 'https://x/1.png', tags: ['1girl'], rating: 'e' }],
      source: 'tbib',
      ok: true,
    })
    vi.stubGlobal('window', { goongrid: { booruFetch } })
    const res = await fetchPosts({ tags: '1girl', limit: 10 })
    expect(booruFetch).toHaveBeenCalledWith({ tags: '1girl', limit: 10 })
    expect(res.ok).toBe(true)
    expect(res.source).toBe('tbib')
  })

  it('returns offline:true when the bridge reports failure', async () => {
    vi.stubGlobal('window', {
      goongrid: { booruFetch: vi.fn().mockResolvedValue({ posts: [], source: null, ok: false }) },
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
    vi.stubGlobal('window', { goongrid: { booruFetch } })
    const res = await fetchPosts({ tags: '1girl loli', limit: 10 })
    expect(booruFetch).not.toHaveBeenCalled()
    expect(res.offline).toBe(true)
  })

  it('dedupes post ids across a session', async () => {
    const post = { id: 'dup', url: 'https://x/dup.png', tags: [], rating: 'e' }
    const booruFetch = vi.fn().mockResolvedValue({ posts: [post], source: 'tbib', ok: true })
    vi.stubGlobal('window', { goongrid: { booruFetch } })
    const first = await fetchPosts({ tags: 'wet', limit: 5 })
    const second = await fetchPosts({ tags: 'wet', limit: 5 })
    expect(first.posts).toHaveLength(1)
    expect(second.posts).toHaveLength(0)
  })
})
