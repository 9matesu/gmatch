import { describe, it, expect, vi, afterEach } from 'vitest'
import { customKindOf, isCustomMediaUrl, sampleCustomSources, __resetCustomSeen } from './customSources'
import type { CustomSource } from '../game/types'

const base: CustomSource = {
  id: 's1',
  label: 'My pics',
  kind: 'urls',
  enabled: true,
  urls: [],
  folderId: null,
  folderPath: null,
  addedAt: 0,
}

afterEach(() => {
  __resetCustomSeen()
  vi.unstubAllGlobals()
})

describe('isCustomMediaUrl', () => {
  it('accepts direct http(s) media links', () => {
    expect(isCustomMediaUrl('https://cdn.example/a.jpg')).toBe(true)
    expect(isCustomMediaUrl('http://x.test/b.mp4?token=1')).toBe(true)
  })
  it('rejects pages, scripts and non-http schemes', () => {
    expect(isCustomMediaUrl('https://example.com/gallery/1')).toBe(false)
    expect(isCustomMediaUrl('javascript:alert(1)')).toBe(false)
    expect(isCustomMediaUrl('data:image/png;base64,xx')).toBe(false)
    expect(isCustomMediaUrl('ftp://x.test/a.jpg')).toBe(false)
    expect(isCustomMediaUrl('')).toBe(false)
  })
})

describe('customKindOf', () => {
  it('detects video extensions', () => {
    expect(customKindOf('https://x/a.mp4')).toBe('video')
    expect(customKindOf('https://x/a.jpg')).toBe('image')
  })
})

describe('sampleCustomSources', () => {
  it('returns nothing when no source is enabled', async () => {
    const posts = await sampleCustomSources([{ ...base, enabled: false, urls: ['https://x/a.jpg'] }], 10)
    expect(posts).toEqual([])
  })
  it('samples url sources and never repeats ids', async () => {
    const src = { ...base, urls: ['https://x/a.jpg', 'https://x/b.png'] }
    const first = await sampleCustomSources([src], 10)
    expect(first.length).toBe(2)
    const second = await sampleCustomSources([src], 10)
    expect(second).toEqual([])
  })
  it('skips folder sources without a desktop bridge', async () => {
    vi.stubGlobal('window', {})
    const src: CustomSource = { ...base, id: 'f1', kind: 'folder', folderId: 'f9', folderPath: '/tmp' }
    const posts = await sampleCustomSources([src], 10)
    expect(posts).toEqual([])
  })
})
