import { describe, expect, it } from 'vitest'
import { blockedPair, learnPurge, MAX_CO_RULES, type CoRule } from './tagCooccur'

const post = (...tags: string[]) => tags

describe('learnPurge', () => {
  it('pairs the top content tags of a purged post', () => {
    const rules = learnPurge(post('a', 'b', 'c'), [])
    expect(rules).toEqual([
      { a: 'a', b: 'b', count: 1 },
      { a: 'a', b: 'c', count: 1 },
      { a: 'b', b: 'c', count: 1 },
    ])
  })
  it('bumps existing pairs instead of duplicating', () => {
    let rules = learnPurge(post('a', 'b'), [])
    rules = learnPurge(post('a', 'b'), rules)
    expect(rules).toEqual([{ a: 'a', b: 'b', count: 2 }])
  })
  it('caps rules', () => {
    const many = Array.from({ length: 30 }, (_, i) => `t${i}`)
    const rules = learnPurge(many, [])
    expect(rules.length).toBeLessThanOrEqual(MAX_CO_RULES)
  })
})

describe('blockedPair (count>=2, intent-safe)', () => {
  const rules: CoRule[] = [{ a: 'furry', b: 'dog_ears', count: 2 }]
  it('blocks a post carrying the learned pair', () => {
    expect(blockedPair(post('furry', 'dog_ears', '1girl'), rules, new Set())).toBe(true)
  })
  it('stays silent while count is 1', () => {
    expect(blockedPair(post('furry', 'dog_ears'), [{ a: 'furry', b: 'dog_ears', count: 1 }], new Set())).toBe(false)
  })
  it('never blocks tags the player is actively feeding on', () => {
    expect(blockedPair(post('furry', 'dog_ears'), rules, new Set(['furry']))).toBe(false)
  })
})
