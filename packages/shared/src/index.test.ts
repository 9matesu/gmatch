import { describe, expect, it } from 'vitest'
import { generateFallbackName, isDefaultPeerName } from './index'

/**
 * A machine-minted name is not a person's name. The name directory, the profile
 * gate and the chat resolver all rely on this one predicate: if a fallback ever
 * counts as "a real name", it gets persisted and shown forever as the user's
 * chosen handle (the `user_123hajds` symptom).
 */
describe('isDefaultPeerName', () => {
  it('rejects User_<hex> fallbacks, including the generator output', () => {
    expect(isDefaultPeerName(generateFallbackName('123hajdsdeadbeef'))).toBe(true)
    expect(isDefaultPeerName('user_123hajds')).toBe(true)
    expect(isDefaultPeerName('USER-DEADBEEF')).toBe(true)
    expect(isDefaultPeerName('User_abc123')).toBe(true)
  })

  it('accepts Player as a real chosen name — the feed rejects it on its own', () => {
    // `Player` is a feed-only placeholder. Rejecting it in this GLOBAL gate
    // also rejected a real account named Player at PATCH / onboarding, so the
    // gate is back to machine fallbacks only and the feed filters Player where
    // it actually renders authors (see feedProjection).
    expect(isDefaultPeerName('Player')).toBe(false)
    expect(isDefaultPeerName(' player ')).toBe(false)
    expect(isDefaultPeerName('PLAYER')).toBe(false)
  })

  it('keeps other defaults and real names distinct', () => {
    expect(isDefaultPeerName('')).toBe(true)
    expect(isDefaultPeerName('User')).toBe(true)
    expect(isDefaultPeerName('Unknown User')).toBe(true)
    expect(isDefaultPeerName('anonymous')).toBe(true)
    expect(isDefaultPeerName('Alice Wonder')).toBe(false)
    // Only the whole-value form is a fallback; a real name may contain it.
    expect(isDefaultPeerName('Player One')).toBe(false)
  })
})
