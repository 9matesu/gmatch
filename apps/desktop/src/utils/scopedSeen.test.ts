import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  scopedStorageKey,
  readScopedJson,
  writeScopedJson,
  sanitizeSeen,
  loadSeen,
  saveSeen,
} from './scopedSeen'

/**
 * Conversation state must not leak between accounts on one install. These tests
 * pin the scoping and the one-time legacy migration.
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

describe('scopedSeen', () => {
  let store: Map<string, string>

  beforeEach(() => {
    store = stubLocalStorage()
  })

  it('namespaces the key by identity', () => {
    expect(scopedStorageKey('gmatch_dm_seen_v1', 'abc')).toBe('gmatch_dm_seen_v1:abc')
    expect(scopedStorageKey('gmatch_dm_seen_v1', null)).toBe('gmatch_dm_seen_v1')
  })

  it('keeps two accounts independent', () => {
    saveSeen('k', 'alice', { peer: 111 })
    saveSeen('k', 'bob', { peer: 222 })
    expect(loadSeen('k', 'alice')).toEqual({ peer: 111 })
    expect(loadSeen('k', 'bob')).toEqual({ peer: 222 })
  })

  it('migrates a legacy unscoped value once, into the first identity', () => {
    store.set('k', JSON.stringify({ peer: 999 }))
    expect(loadSeen('k', 'alice')).toEqual({ peer: 999 })
    // Legacy key is gone, so a second identity cannot inherit alice's stamps.
    expect(store.has('k')).toBe(false)
    expect(loadSeen('k', 'bob')).toEqual({})
    expect(store.get('k:alice')).toBe(JSON.stringify({ peer: 999 }))
  })

  it('does not clobber an existing scoped value with legacy data', () => {
    store.set('k', JSON.stringify({ peer: 1 }))
    saveSeen('k', 'alice', { peer: 2 })
    expect(loadSeen('k', 'alice')).toEqual({ peer: 2 })
    // Legacy survives untouched for whoever has not migrated yet.
    expect(store.get('k')).toBe(JSON.stringify({ peer: 1 }))
  })

  it('returns the fallback for corrupt JSON instead of throwing', () => {
    store.set('k:alice', '{nope')
    expect(readScopedJson('k', 'alice', { safe: true })).toEqual({ safe: true })
    expect(loadSeen('k', 'alice')).toEqual({})
  })

  it('drops non-numeric and non-positive stamps', () => {
    expect(sanitizeSeen({ a: 1, b: '2', c: 0, d: -5, e: 'x', f: null })).toEqual({ a: 1, b: 2 })
    expect(sanitizeSeen(null)).toEqual({})
  })

  it('round-trips an arbitrary JSON blob', () => {
    writeScopedJson('last', 'alice', { id: 'peer', name: 'Kenny' })
    expect(readScopedJson('last', 'alice', null)).toEqual({ id: 'peer', name: 'Kenny' })
  })
})
