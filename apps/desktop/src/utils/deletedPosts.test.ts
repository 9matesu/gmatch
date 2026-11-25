import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readDeletedPostIds, tombstonePost, isPostDeleted, filterDeleted } from './deletedPosts'

/**
 * A deleted post must stay deleted — for good.
 *
 * The load-bearing bug this pins: the tombstone lived in localStorage but the
 * app kept its own React copy of the set, and that copy started EMPTY on every
 * launch. The feed projection filters by that copy, so a post deleted
 * yesterday reappeared on the profile the next morning ("I deleted it and it
 * is on my profile again"). The set must be re-read from durable storage at
 * boot, and every delete must land in BOTH copies.
 *
 * localStorage is stubbed (the repo convention — jsdom runs with an opaque
 * origin here, so there is no real one).
 */
function stubLocalStorage(): Map<string, string> {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  })
  return store
}

describe('deletedPosts (durable tombstones)', () => {
  let store: Map<string, string>

  beforeEach(() => {
    store = stubLocalStorage()
  })

  it('reads the tombstone set back after a reload', () => {
    tombstonePost('gone-1')
    // A reload is a fresh read of the same durable store: the set must still
    // carry the id, or the projection would render the post again.
    expect([...readDeletedPostIds()]).toEqual(['gone-1'])
    expect(isPostDeleted('gone-1')).toBe(true)
  })

  it('drops a tombstoned post from any row list', () => {
    tombstonePost('gone-1')
    expect(filterDeleted([{ id: 'gone-1' }, { id: 'here-1' }]).map((r) => r.id)).toEqual(['here-1'])
  })

  it('never tombstones an empty id', () => {
    tombstonePost('')
    expect(readDeletedPostIds().size).toBe(0)
  })

  it('survives a corrupt store instead of resurrecting rows', () => {
    store.set('gmatch_deleted_posts_v1', '{not json')
    expect(readDeletedPostIds().size).toBe(0)
    expect(filterDeleted([{ id: 'a' }]).map((r) => r.id)).toEqual(['a'])
  })
})
