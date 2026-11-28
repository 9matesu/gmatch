// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mergeDirectory, dedupeServers, serverKey, readDirectoryCache, writeDirectoryCache, isDroppedDirectoryRow, OFFICIAL_NODE_NAME, type DirectoryServer } from './directoryMerge'

const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  } as Storage)
})
afterEach(() => vi.unstubAllGlobals())

const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString()
const s = (id: string, seen: string, hint?: string): DirectoryServer =>
  ({ id, name: id, owner_id: 'o', password_required: 0, last_seen: seen, ...(hint ? { endpoint_hint: hint } : {}) })

describe('mergeDirectory (D2)', () => {
  it('dedupes by id, newest last_seen wins', () => {
    const newer = ago(1)
    const merged = mergeDirectory([s('a', ago(2), 'h1')], [s('a', newer), s('b', ago(2))])
    expect(merged.map((x) => x.id).sort()).toEqual(['a', 'b'])
    expect(merged.find((x) => x.id === 'a')!.last_seen).toBe(newer)
  })
  it('a fresh entry without a hint never erases a cached hint', () => {
    const merged = mergeDirectory([s('a', ago(2), 'host:1')], [s('a', ago(1))])
    expect(merged.find((x) => x.id === 'a')!.endpoint_hint).toBe('host:1')
  })
  it('sorted newest-first and capped', () => {
    const many = Array.from({ length: 250 }, (_, i) => s(`n${i}`, ago((i % 28 + 1) / 60)))
    const merged = mergeDirectory([], many)
    expect(merged.length).toBe(200)
    expect((merged[0]?.last_seen || '') >= (merged[199]?.last_seen || '')).toBe(true)
  })
})

describe('directory cache (one mirror per world)', () => {
  it('does not replay the previous node\'s directory after a switch', () => {
    writeDirectoryCache([s('old-world', ago(2), 'old.test:8790')], 'http://old-node:8790')
    expect(readDirectoryCache('http://new-node:8790')).toEqual([])
    expect(readDirectoryCache('http://old-node:8790').map((x) => x.id)).toEqual(['old-world'])
    writeDirectoryCache([s('new-world', ago(1), 'new.test:8790')], 'http://new-node:8790')
    expect(readDirectoryCache('http://old-node:8790').map((x) => x.id)).toEqual(['old-world'])
    expect(readDirectoryCache('http://new-node:8790').map((x) => x.id)).toEqual(['new-world'])
  })
})

describe('server identity (one row per server)', () => {
  it('keys on the address, normalised; falls back to the id', () => {
    expect(serverKey(s('a', 'x', 'https://Host.TEST:8790/'))).toBe('host.test:8790')
    expect(serverKey(s('mask:host:1', 'x'))).toBe('mask:host:1')
  })

  it('collapses two directory ids for the same address, newest metadata wins', () => {
    const older = { ...s('aaa', ago(2), 'world.test:8790'), name: 'Old name', user_count: 4 }
    const newer = { ...s('bbb', ago(1), 'http://world.test:8790'), name: 'New name' }
    const rows = dedupeServers([older, newer])
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('New name')
    expect(rows[0].user_count).toBe(4)
  })

  it('never merges different servers that share a display name', () => {
    const a = { ...s('a', ago(0.1), 'one.test:8790'), name: 'gmatch' }
    const b = { ...s('b', ago(0.1), 'two.test:8790'), name: 'gmatch' }
    expect(dedupeServers([a, b]).map((x) => x.id)).toEqual(['a', 'b'])
  })

  it('unions a password flag and never loses a known count to a stale zero', () => {
    const locked = { ...s('a', ago(1), 'w.test:8790'), password_required: 1, online_count: 3 }
    const open = { ...s('b', ago(2), 'w.test:8790'), password_required: 0, online_count: 0 }
    const [row] = dedupeServers([locked, open])
    expect(row.password_required).toBe(1)
    expect(row.online_count).toBe(3)
  })
})

describe('stale and official-brand rows (one canonical official)', () => {
  it('drops a listing 14d old from a fresh directory answer', () => {
    const stale = { ...s('ghost', ago(14 * 24), 'ghost.test:8790'), name: 'gMatch' }
    const friend = { ...s('friend', ago(0.1), 'friend.test:8790'), name: 'Friend World' }
    expect(mergeDirectory([], [stale, friend]).map((x) => x.id)).toEqual(['friend'])
    expect(isDroppedDirectoryRow(stale)).toBe(true)
    expect(isDroppedDirectoryRow(friend)).toBe(false)
  })

  it('a gmatch row 23h old is gone: within the 24h TTL, but its 15min heartbeat stopped', () => {
    const staleBrand = { ...s('brand', ago(23), 'brand.test:8790'), name: 'gMatch' }
    const freshBrand = { ...s('fresh-brand', ago(0.1), 'fresh.test:8790'), name: 'gMatch' }
    expect(isDroppedDirectoryRow(staleBrand)).toBe(true)
    expect(isDroppedDirectoryRow(freshBrand)).toBe(false)
    expect(mergeDirectory([], [staleBrand, freshBrand]).map((x) => x.id)).toEqual(['fresh-brand'])
  })

  it('a signed fresh friend node stays; a remote official-name claim never does', () => {
    const friend = { ...s('signed', ago(0.1), 'signed.test:8790'), name: 'Friend World' }
    const impostor = { ...s('impostor', ago(0.1), 'other.test:8790'), name: OFFICIAL_NODE_NAME }
    expect(isDroppedDirectoryRow(friend)).toBe(false)
    expect(isDroppedDirectoryRow(impostor)).toBe(true)
    expect(mergeDirectory([], [friend, impostor]).map((x) => x.id)).toEqual(['signed'])
  })

  it('a stale or impersonating row is purged on cache read, never just hidden at render', () => {
    const stale = { ...s('old-brand', ago(14 * 24), 'old.test:8790'), name: 'gMatch' }
    const impostor = { ...s('fake-official', ago(0.1), 'fake.test:8790'), name: OFFICIAL_NODE_NAME }
    const friend = { ...s('kept', 'x', 'kept.test:8790'), name: 'Friend World' }
    writeDirectoryCache([stale, impostor, friend])
    expect(readDirectoryCache().map((x) => x.id)).toEqual(['kept'])
  })

  it('keeps a self row even when its stamp is old', () => {
    const own = { ...s('self:local:8790', ago(14 * 24), 'local:8790'), name: OFFICIAL_NODE_NAME }
    expect(isDroppedDirectoryRow(own)).toBe(false)
  })
})
