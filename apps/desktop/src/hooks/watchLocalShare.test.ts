import { describe, expect, it } from 'vitest'
import { markVerified, isVerified } from './watchLocalShare'

describe('verified ids: bounded (plan B1)', () => {
  it('remembers verified ids', () => {
    markVerified('v-1', 'v-2')
    expect(isVerified('v-1')).toBe(true)
    expect(isVerified('nope')).toBe(false)
  })

  it('evicts the oldest ids past the cap so the set cannot grow forever', () => {
    for (let i = 0; i < 400; i++) markVerified(`bulk-${i}`)
    // The first bulk ids fell out of the bounded ring...
    expect(isVerified('bulk-0')).toBe(false)
    expect(isVerified('bulk-5')).toBe(false)
    // ...and the recent ones survive.
    expect(isVerified('bulk-399')).toBe(true)
    // Re-verification re-marks, so a still-live room id can always come back.
    markVerified('bulk-0')
    expect(isVerified('bulk-0')).toBe(true)
  })

  it('ignores empty ids', () => {
    markVerified(undefined, '')
    expect(isVerified('')).toBe(false)
  })
})
