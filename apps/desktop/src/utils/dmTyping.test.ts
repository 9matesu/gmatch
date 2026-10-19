import { describe, expect, it } from 'vitest'
import {
  TYPING_THROTTLE_MS,
  TYPING_TTL_MS,
  activeTypists,
  isTypingFresh,
  pruneTypingState,
  shouldEmitTyping,
} from './dmTyping'

describe('shouldEmitTyping', () => {
  it('emits the first event of a burst', () => {
    expect(shouldEmitTyping(0, 1_000)).toBe(true)
  })

  it('throttles a continuous typist to one event per window', () => {
    expect(shouldEmitTyping(1_000, 1_000 + TYPING_THROTTLE_MS - 1)).toBe(false)
    expect(shouldEmitTyping(1_000, 1_000 + TYPING_THROTTLE_MS)).toBe(true)
  })

  it('refuses to emit with a broken clock', () => {
    expect(shouldEmitTyping(0, Number.NaN)).toBe(false)
  })
})

describe('isTypingFresh', () => {
  it('stays fresh inside the TTL and expires at it', () => {
    expect(isTypingFresh(1_000, 1_000 + TYPING_TTL_MS - 1)).toBe(true)
    expect(isTypingFresh(1_000, 1_000 + TYPING_TTL_MS)).toBe(false)
  })

  it('treats a future stamp as stale instead of pinning the indicator on', () => {
    expect(isTypingFresh(5_000, 1_000)).toBe(false)
  })

  it('ignores a missing stamp', () => {
    expect(isTypingFresh(0, 1_000)).toBe(false)
    expect(isTypingFresh(Number.NaN, 1_000)).toBe(false)
  })
})

describe('activeTypists / pruneTypingState', () => {
  it('keeps only peers inside their TTL', () => {
    const state = { a: 10_000, b: 1_000 }
    expect(activeTypists(state, 10_500)).toEqual(['a'])
  })

  it('returns the same map object when nothing expired', () => {
    const state = { a: 10_000 }
    expect(pruneTypingState(state, 10_500)).toBe(state)
  })

  it('drops expired peers', () => {
    const state = { a: 10_000, b: 1_000 }
    expect(pruneTypingState(state, 10_500)).toEqual({ a: 10_000 })
  })
})
