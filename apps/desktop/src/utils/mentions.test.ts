import { describe, expect, it } from 'vitest'
import { countMentions, createMentionMatcher } from './mentions'

const kenny = { displayName: 'Kenny', orbitId: 'abcdef1234567890' }

describe('createMentionMatcher', () => {
  const match = createMentionMatcher(kenny)

  it('matches the display name with a boundary', () => {
    expect(match('hey @Kenny look')).toBe(true)
    expect(match('@kenny')).toBe(true)
  })

  it('does not match a longer handle', () => {
    expect(match('@kenneth hi')).toBe(false)
  })

  it('does not match inside an email address', () => {
    expect(match('write to a@kenny.dev')).toBe(false)
  })

  it('matches underscored spaced names and the id prefix', () => {
    const spaced = createMentionMatcher({ displayName: 'Big Ken', orbitId: 'abcdef1234567890' })
    expect(spaced('yo @Big_Ken')).toBe(true)
    expect(spaced('yo @Big Ken')).toBe(true)
    expect(spaced('yo @abcdef12')).toBe(true)
    expect(spaced('yo @abcdef99')).toBe(false)
  })

  it('never matches when the viewer has no name or id', () => {
    const none = createMentionMatcher({})
    expect(none('@anything')).toBe(false)
  })

  it('escapes regex characters in names', () => {
    const dots = createMentionMatcher({ displayName: 'a.b' })
    expect(dots('@a.b')).toBe(true)
    expect(dots('@axb')).toBe(false)
  })
})

describe('countMentions', () => {
  const match = createMentionMatcher(kenny)

  it('counts only inbound messages newer than the seen stamp', () => {
    const messages = [
      { text: 'old @Kenny', ts: 10 },
      { text: 'new @Kenny', ts: 30 },
      { text: 'plain', ts: 40 },
      { text: '@Kenny from me', ts: 50, own: true },
    ]
    expect(countMentions(messages, match, 20)).toBe(1)
  })

  it('tolerates a missing thread', () => {
    expect(countMentions(undefined, match)).toBe(0)
  })
})
