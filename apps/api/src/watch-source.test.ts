import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('./proxy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./proxy')>()
  return {
    ...actual,
    proxyAndStoreExternal: vi.fn(),
    classifyAndResolve: vi.fn(),
    isPrivateTarget: vi.fn(async () => false),
    pageTitleFor: () => null,
  }
})

import { proxyAndStoreExternal, classifyAndResolve } from './proxy'
import { resolveWatchSource } from './watch-source'

const env = { DB: { prepare: () => ({ bind: () => ({ run: async () => ({}) }) }) }, BUCKET: {} }

beforeEach(() => {
  vi.mocked(proxyAndStoreExternal).mockReset()
  vi.mocked(classifyAndResolve).mockReset()
})

describe('resolveWatchSource', () => {
  it('rejects images and dangerous schemes without probing', async () => {
    const image = await resolveWatchSource(env as never, 'u1', 'https://cdn.example.com/pic.jpg')
    expect(image.kind).toBe('invalid')
    expect(image.reason).toMatch(/image/i)
    expect(proxyAndStoreExternal).not.toHaveBeenCalled()

    const dangerous = await resolveWatchSource(env as never, 'u1', 'javascript:alert(1)')
    expect(dangerous.kind).toBe('invalid')
    expect(dangerous.sync).toBe('none')
  })

  it('maps stored direct video to stored-video', async () => {
    vi.mocked(proxyAndStoreExternal).mockResolvedValueOnce({ storedUrl: '/api/objects/1', mimeType: 'video/mp4', isVideo: true, bytesStored: 10, proxiedMime: 'video/mp4' } as never)
    const res = await resolveWatchSource(env as never, 'u1', 'https://cdn.example.com/clip.mp4')
    expect(res.kind).toBe('stored-video')
    expect(res.playableUrl).toMatch(/\/api\/objects\//)
    expect(res.sync).toBe('full')
  })

  it('maps provider pages to resolved or honest unresolved states', async () => {
    vi.mocked(proxyAndStoreExternal).mockResolvedValueOnce({ storedUrl: '/api/objects/2', mimeType: 'video/mp4', isVideo: true, bytesStored: 10, proxiedMime: 'video/mp4' } as never)
    const ok = await resolveWatchSource(env as never, 'u1', 'https://www.redgifs.com/watch/abc')
    expect(ok.kind).toBe('provider-resolved')
    expect(ok.provider).toBe('redgifs')

    vi.mocked(proxyAndStoreExternal).mockResolvedValueOnce(null)
    vi.mocked(classifyAndResolve).mockResolvedValueOnce(null)
    const bad = await resolveWatchSource(env as never, 'u1', 'https://example.com/article')
    expect(bad.kind).toBe('provider-unresolved')
    expect(bad.reason).toMatch(/externally|direct video/i)
    expect(bad.sync).toBe('none')
  })
})
