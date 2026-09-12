import { describe, expect, it } from 'vitest'
import { matchEndSummary } from './matchEndSummary'

describe('matchEndSummary', () => {
  it('mutual like at a tier says climb + shows g$', () => {
    expect(matchEndSummary('both_like', { gp: 50, reason: 'mutual_like' }, false)).toBe('Mutual like! Tier up · +50 g$')
  })
  it('final tier up', () => {
    expect(matchEndSummary('both_like', { gp: 200, reason: 'mutual_like' }, true)).toBe('Mutual like! Rank up · +200 g$')
  })
  it('no match pays the consolation', () => {
    expect(matchEndSummary('ended', { gp: 10, reason: 'no_match' }, false)).toBe('No match · +10 g$ consolation')
  })
  it('no payout info degrades gracefully', () => {
    expect(matchEndSummary('expired', null, false)).toBe('Match timed out.')
  })
})
