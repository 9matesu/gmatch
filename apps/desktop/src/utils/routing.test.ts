import { describe, expect, it } from 'vitest'
import { ROUTE_VIEWS, hashForView, isRoutedView, viewFromHash } from './routing'

describe('view routing (hash <-> view)', () => {
  it('parses canonical hashes for every routed view', () => {
    for (const v of ROUTE_VIEWS) {
      expect(viewFromHash(hashForView(v))).toBe(v)
    }
  })

  it('accepts aliases and case-insensitive input', () => {
    expect(viewFromHash('#/home')).toBe('feed')
    expect(viewFromHash('#/DUELS')).toBe('games')
    expect(viewFromHash('#/idle')).toBe('grid')
    expect(viewFromHash('#/cards')).toBe('gallery')
    expect(viewFromHash('#/dm')).toBe('messages')
  })

  it('strips query params from the hash', () => {
    expect(viewFromHash('#/grid?x=1')).toBe('grid')
  })

  it('returns null for empty or unknown hashes', () => {
    expect(viewFromHash('')).toBeNull()
    expect(viewFromHash('#/')).toBeNull()
    expect(viewFromHash('#/nonsense')).toBeNull()
  })

  it('isRoutedView guards the union', () => {
    expect(isRoutedView('admin')).toBe(true)
    expect(isRoutedView('settings')).toBe(false)
  })

  it('every nav view has a canonical hash', () => {
    expect(hashForView('grid')).toBe('#/grid')
    expect(hashForView('admin')).toBe('#/admin')
  })
})
