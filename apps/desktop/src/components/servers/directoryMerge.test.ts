import { describe, it, expect } from 'vitest'
import { mergeDirectory, dedupeServers, serverKey, type DirectoryServer } from './directoryMerge'

const s = (id: string, seen: string, hint?: string): DirectoryServer =>
  ({ id, name: id, owner_id: 'o', password_required: 0, last_seen: seen, ...(hint ? { endpoint_hint: hint } : {}) })

describe('mergeDirectory (D2)', () => {
  it('dedupes by id, newest last_seen wins', () => {
    const merged = mergeDirectory([s('a', '2026-01-01', 'h1')], [s('a', '2026-01-02'), s('b', '2026-01-01')])
    expect(merged.map((x) => x.id).sort()).toEqual(['a', 'b'])
    expect(merged.find((x) => x.id === 'a')!.last_seen).toBe('2026-01-02')
  })
  it('a fresh entry without a hint never erases a cached hint', () => {
    const merged = mergeDirectory([s('a', '2026-01-01', 'host:1')], [s('a', '2026-01-02')])
    expect(merged.find((x) => x.id === 'a')!.endpoint_hint).toBe('host:1')
  })
  it('sorted newest-first and capped', () => {
    const many = Array.from({ length: 250 }, (_, i) => s(`n${i}`, `2026-01-${String(i % 28 + 1).padStart(2, '0')}`))
    const merged = mergeDirectory([], many)
    expect(merged.length).toBe(200)
    expect((merged[0]?.last_seen || '') >= (merged[199]?.last_seen || '')).toBe(true)
  })
})

describe('server identity (one row per server)', () => {
  it('keys on the address, normalised; falls back to the id', () => {
    expect(serverKey(s('a', 'x', 'https://Host.TEST:8790/'))).toBe('host.test:8790')
    expect(serverKey(s('mask:host:1', 'x'))).toBe('mask:host:1')
  })

  it('collapses two directory ids for the same address, newest metadata wins', () => {
    const older = { ...s('aaa', '2026-01-01', 'world.test:8790'), name: 'Old name', user_count: 4 }
    const newer = { ...s('bbb', '2026-01-02', 'http://world.test:8790'), name: 'New name' }
    const rows = dedupeServers([older, newer])
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('New name')
    expect(rows[0].user_count).toBe(4)
  })

  it('never merges different servers that share a display name', () => {
    const a = { ...s('a', '2026-01-01', 'one.test:8790'), name: 'gmatch' }
    const b = { ...s('b', '2026-01-01', 'two.test:8790'), name: 'gmatch' }
    expect(dedupeServers([a, b]).map((x) => x.id)).toEqual(['a', 'b'])
  })

  it('unions a password flag and never loses a known count to a stale zero', () => {
    const locked = { ...s('a', '2026-01-02', 'w.test:8790'), password_required: 1, online_count: 3 }
    const open = { ...s('b', '2026-01-01', 'w.test:8790'), password_required: 0, online_count: 0 }
    const [row] = dedupeServers([locked, open])
    expect(row.password_required).toBe(1)
    expect(row.online_count).toBe(3)
  })
})
