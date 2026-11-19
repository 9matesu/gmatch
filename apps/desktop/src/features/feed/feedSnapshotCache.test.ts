import { beforeEach, describe, expect, it } from 'vitest'
import {
  SNAPSHOT_STALE_MS, clearCachedFeed, isStaleSnapshot, readCachedFeed, writeCachedFeed,
} from './feedSnapshotCache'
import type { FeedPost } from '../../components/feed/GMatchFeed'

// jsdom in this repo has no localStorage; stub it the way the other persistence
// tests do.
const storage: Record<string, string> = {}
globalThis.localStorage = {
  getItem: (key: string) => storage[key] ?? null,
  setItem: (key: string, value: string) => { storage[key] = String(value) },
  removeItem: (key: string) => { delete storage[key] },
  clear: () => { for (const k of Object.keys(storage)) delete storage[k] },
  key: () => null,
  length: 0,
} as Storage

function post(id: string): FeedPost {
  return {
    id,
    author_id: 'a',
    author_name: 'A',
    url: `https://x/${id}.jpg`,
    caption: id,
    created_at: new Date().toISOString(),
    like_count: 0,
    comment_count: 0,
  }
}

beforeEach(() => { localStorage.clear() })

describe('feed snapshot cache', () => {
  it('round-trips a timeline', () => {
    writeCachedFeed('alice', [post('1'), post('2')])
    const snap = readCachedFeed('alice')
    expect(snap?.posts.map((p) => p.id)).toEqual(['1', '2'])
  })

  it('is scoped per identity (no inheriting another player feed)', () => {
    writeCachedFeed('alice', [post('1')])
    expect(readCachedFeed('bob')).toBeNull()
    expect(readCachedFeed(null)).toBeNull()
  })

  it('replaces instead of appending', () => {
    writeCachedFeed('alice', [post('1'), post('2')])
    writeCachedFeed('alice', [post('3')])
    expect(readCachedFeed('alice')?.posts.map((p) => p.id)).toEqual(['3'])
  })

  it('bounds the stored rows', () => {
    const many = Array.from({ length: 500 }, (_, i) => post(String(i)))
    writeCachedFeed('alice', many)
    // The read is bounded to what a feed needs, not the whole history.
    expect(readCachedFeed('alice')!.posts.length).toBeLessThanOrEqual(200)
  })

  it('a corrupt entry is a cache miss, not a throw', () => {
    storage['gmatch.feed.snapshot.v1:alice'] = '{not json'
    expect(readCachedFeed('alice')).toBeNull()
  })

  it('clears on demand', () => {
    writeCachedFeed('alice', [post('1')])
    clearCachedFeed('alice')
    expect(readCachedFeed('alice')).toBeNull()
  })

  it('reports staleness by age, not by guess', () => {
    writeCachedFeed('alice', [post('1')])
    const fresh = readCachedFeed('alice')
    expect(isStaleSnapshot(fresh, Date.now())).toBe(false)
    expect(isStaleSnapshot(fresh, Date.now() + SNAPSHOT_STALE_MS + 1)).toBe(true)
    expect(isStaleSnapshot(null)).toBe(false)
  })
})