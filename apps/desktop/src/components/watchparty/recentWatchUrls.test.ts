// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { isWatchUrl, readRecentWatchUrls, rememberWatchUrls } from './recentWatchUrls'

// jsdom in this repo has no localStorage; stub it the way other persistence tests do.
const storage: Record<string, string> = {}
globalThis.localStorage = {
  getItem: (key: string) => storage[key] ?? null,
  setItem: (key: string, value: string) => { storage[key] = String(value) },
  removeItem: (key: string) => { delete storage[key] },
  clear: () => { for (const k of Object.keys(storage)) delete storage[k] },
  key: () => null,
  length: 0,
} as Storage

describe('recent watch URLs', () => {
  beforeEach(() => window.localStorage.clear())

  it('accepts only http(s) links and keeps each link once, newest first', () => {
    expect(isWatchUrl('ipfs://abc')).toBe(false)
    expect(isWatchUrl('javascript:alert(1)')).toBe(false)
    expect(isWatchUrl('https://example.com/v')).toBe(true)

    const rows = rememberWatchUrls([
      'https://a.example/v', 'ipfs://bad', 'https://b.example/v', 'https://a.example/v',
    ], 1000)
    expect(rows.map((r) => r.url)).toEqual(['https://a.example/v', 'https://b.example/v'])
    expect(readRecentWatchUrls().map((r) => r.url)).toEqual(['https://a.example/v', 'https://b.example/v'])
  })

  it('caps the list at eight and moves a relaunched link to the front', () => {
    rememberWatchUrls(Array.from({ length: 10 }, (_, i) => `https://v${i}.example`), 1)
    const rows = rememberWatchUrls(['https://v9.example'], 2)
    expect(rows).toHaveLength(8)
    expect(rows[0]).toEqual({ url: 'https://v9.example', at: 2 })
    expect(readRecentWatchUrls()).toHaveLength(8)
  })

  it('ignores corrupt stored rows instead of throwing', () => {
    window.localStorage.setItem('gmatch_watch_urls_v1', '{not json')
    expect(readRecentWatchUrls()).toEqual([])
  })
})
