import { describe, expect, it } from 'vitest'
import {
  RECENT_PUSH_LIMIT,
  RECENT_PUSH_TTL_MS,
  mergeRecentPushes,
  rememberPushed,
  type PushedEntry,
} from './feedMerge'

type P = { id: string; created_at: string }

function post(id: string, at = '2026-10-18T10:00:00.000Z'): P {
  return { id, created_at: at }
}

function fresh(): Map<string, PushedEntry<P>> {
  return new Map()
}

describe('rememberPushed', () => {
  it('ignores posts without an id', () => {
    const store = fresh()
    rememberPushed(store, null)
    rememberPushed(store, { created_at: '' } as P)
    expect(store.size).toBe(0)
  })

  it('keeps the newest copy without duplicating the id', () => {
    const store = fresh()
    rememberPushed(store, post('a', '2026-10-18T09:00:00.000Z'), 1)
    rememberPushed(store, post('a', '2026-10-18T11:00:00.000Z'), 2)
    expect(store.size).toBe(1)
    expect(store.get('a')?.post.created_at).toBe('2026-10-18T11:00:00.000Z')
  })

  it('is bounded', () => {
    const store = fresh()
    for (let i = 0; i < RECENT_PUSH_LIMIT + 8; i++) {
      rememberPushed(store, post(`p${i}`), i)
    }
    expect(store.size).toBe(RECENT_PUSH_LIMIT)
    // The oldest pushes were evicted, the newest survived.
    expect(store.has('p0')).toBe(false)
    expect(store.has(`p${RECENT_PUSH_LIMIT + 7}`)).toBe(true)
  })
})

describe('mergeRecentPushes', () => {
  it('returns the snapshot untouched when nothing was pushed', () => {
    const snapshot = [post('a'), post('b')]
    expect(mergeRecentPushes(snapshot, fresh())).toBe(snapshot)
  })

  it('keeps a pushed post the older snapshot does not list yet', () => {
    const store = fresh()
    rememberPushed(store, post('new', '2026-10-18T12:00:00.000Z'), 1000)
    const merged = mergeRecentPushes([post('old')], store, 2000)
    expect(merged.map((p) => p.id)).toEqual(['new', 'old'])
    // Still remembered: the snapshot may simply predate the insert.
    expect(store.has('new')).toBe(true)
  })

  it('retires a pushed post once the snapshot lists it', () => {
    const store = fresh()
    rememberPushed(store, post('a'), 1000)
    const merged = mergeRecentPushes([post('a'), post('b')], store, 2000)
    expect(merged.map((p) => p.id)).toEqual(['a', 'b'])
    expect(store.has('a')).toBe(false)
  })

  it('never duplicates an id that lands in both', () => {
    const store = fresh()
    rememberPushed(store, post('a'), 1000)
    const merged = mergeRecentPushes([post('a')], store, 1000)
    expect(merged.filter((p) => p.id === 'a')).toHaveLength(1)
  })

  it('drops a push that the snapshot never lists past the TTL', () => {
    const store = fresh()
    rememberPushed(store, post('ghost'), 1000)
    const snapshot = [post('a')]
    expect(mergeRecentPushes(snapshot, store, 1000 + RECENT_PUSH_TTL_MS + 1)).toBe(snapshot)
    expect(store.size).toBe(0)
  })

  it('orders retained pushes newest first above the snapshot', () => {
    const store = fresh()
    rememberPushed(store, post('older', '2026-10-18T09:00:00.000Z'), 1000)
    rememberPushed(store, post('newer', '2026-10-18T11:00:00.000Z'), 1000)
    const merged = mergeRecentPushes([post('snap', '2026-10-18T08:00:00.000Z')], store, 1000)
    expect(merged.map((p) => p.id)).toEqual(['newer', 'older', 'snap'])
  })
})
