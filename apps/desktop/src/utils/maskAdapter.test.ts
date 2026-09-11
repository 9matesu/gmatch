import { describe, it, expect } from 'vitest'
import { handleMask, tokenFromMask } from './maskAdapter'

const TOKEN = 'a'.repeat(64)

describe('handle.gmatch.com mask adapter', () => {
  it('round-trips a delivery token', () => {
    expect(tokenFromMask(handleMask(TOKEN))).toBe(TOKEN)
  })
  it('rejects orbitIds, hosts and traversal', () => {
    expect(tokenFromMask('https://handle.gmatch.com/short')).toBeNull()
    expect(tokenFromMask('https://handle.gmatch.com/../etc')).toBeNull()
    expect(tokenFromMask('https://evil.com/' + TOKEN)).toBeNull()
    expect(tokenFromMask('203.0.113.7:8790')).toBeNull()
  })
  it('rejects non-tokens on encode', () => {
    expect(() => handleMask('nope')).toThrow('not a delivery token')
  })
})
