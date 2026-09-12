import { describe, it, expect } from 'vitest'
import { mergeDirectory, type DirectoryServer } from './directoryMerge'

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
