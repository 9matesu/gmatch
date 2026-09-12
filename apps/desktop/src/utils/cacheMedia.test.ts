import { describe, expect, it, vi } from 'vitest'
import { mediaUrlToCachedFile } from './cacheMedia'

function mockFetch(map: Record<string, { ok: boolean; type?: string; bytes?: number }>) {
  return vi.fn(async (input: string) => {
    const key = String(input)
    const hit = Object.entries(map).find(([k]) => key.includes(k))
    if (!hit) return { ok: false, blob: async () => new Blob() }
    const { ok, type = 'image/jpeg', bytes = 10 } = hit[1]
    return { ok, blob: async () => new Blob([new Uint8Array(bytes)], { type }) }
  }) as unknown as typeof fetch
}

describe('mediaUrlToCachedFile', () => {
  it('uploads a proxied image as a File', async () => {
    globalThis.fetch = mockFetch({ '/px': { ok: true } })
    const f = await mediaUrlToCachedFile('https://realbooru.com/images/1.jpeg')
    expect(f).toBeInstanceOf(File)
    expect(f.type).toBe('image/jpeg')
  })

  it('throws when every candidate refuses', async () => {
    globalThis.fetch = mockFetch({})
    await expect(mediaUrlToCachedFile('https://blocked.example/x.jpg')).rejects.toThrow(/cache/i)
  })

  it('rejects non-media content types', async () => {
    globalThis.fetch = mockFetch({ 'blocked.example': { ok: true, type: 'text/html' } })
    await expect(mediaUrlToCachedFile('https://blocked.example/x')).rejects.toThrow(/cache/i)
  })
})
