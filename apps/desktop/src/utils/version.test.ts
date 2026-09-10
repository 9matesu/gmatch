import { describe, expect, it } from 'vitest'
import { isNewer } from './version'

describe('isNewer', () => {
  it('compares numerically, not as strings', () => {
    expect(isNewer('1.1.1', '1.1.0')).toBe(true)
    expect(isNewer('1.1.10', '1.1.9')).toBe(true)
    expect(isNewer('1.2.0', '1.10.0')).toBe(false)
    expect(isNewer('1.1.0', '1.1.0')).toBe(false)
    expect(isNewer('1.1', '1.1.0')).toBe(false)
    expect(isNewer('2', '1.9.9')).toBe(true)
    expect(isNewer('garbage', '1.0.0')).toBe(false)
  })
})
