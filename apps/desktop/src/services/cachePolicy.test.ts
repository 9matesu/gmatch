import { describe, expect, it } from 'vitest'
import {
  FEED_CACHE_TTL_MS,
  cacheFileName,
  fnv1a,
  isFeedCacheFresh,
  normalizeFeedQuery,
  pickEvictions,
} from './cachePolicy'

describe('cachePolicy', () => {
  it('hashes deterministically, different urls differ', () => {
    expect(fnv1a('https://x/1.png')).toBe(fnv1a('https://x/1.png'))
    expect(fnv1a('https://x/1.png')).not.toBe(fnv1a('https://x/2.png'))
  })

  it('keeps the image extension, falls back to .img', () => {
    expect(cacheFileName('https://tbib.org/images/1/a.PNG?x=1')).toMatch(/^[0-9a-f]{8}\.png$/)
    expect(cacheFileName('https://x/v.mp4')).toMatch(/^[0-9a-f]{8}\.mp4$/)
    expect(cacheFileName('https://x/noext')).toMatch(/^[0-9a-f]{8}\.img$/)
  })

  it('evicts oldest-first until both caps fit', () => {
    const entries = [
      { key: 'old', bytes: 10, lastUsed: 1 },
      { key: 'mid', bytes: 10, lastUsed: 2 },
      { key: 'new', bytes: 10, lastUsed: 3 },
    ]
    expect(pickEvictions(entries, 2, 1000)).toEqual(['old'])
    expect(pickEvictions(entries, 10, 25)).toEqual(['old'])
    expect(pickEvictions(entries, 10, 1000)).toEqual([])
    expect(pickEvictions([], 0, 0)).toEqual([])
  })

  it('freshness follows the TTL boundary', () => {
    const now = 1_000_000
    expect(isFeedCacheFresh(now - 1000, now, FEED_CACHE_TTL_MS)).toBe(true)
    expect(isFeedCacheFresh(now - FEED_CACHE_TTL_MS, now, FEED_CACHE_TTL_MS)).toBe(false)
    expect(isFeedCacheFresh(0, now, FEED_CACHE_TTL_MS)).toBe(false)
  })

  it('normalizes queries to one cache slot', () => {
    expect(normalizeFeedQuery('  GangBang   Creampie ')).toBe('gangbang creampie')
  })
})
