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
    expect(isRoutedView('rooms')).toBe(true) // courier rooms (plan P3.4)
    expect(isRoutedView('settings')).toBe(false)
  })

  it('does not route the admin modal (it is opened from the HUD)', () => {
    // Regression: 'admin' used to be a route with no render branch, so
    // '#/admin' painted a blank stage and persisted into orbit_main_view.
    expect(isRoutedView('admin')).toBe(false)
    expect(viewFromHash('#/admin')).toBeNull()
  })

  it('every nav view has a canonical hash', () => {
    expect(hashForView('grid')).toBe('#/grid')
    expect(hashForView('watch')).toBe('#/watch')
  })
})
