import { describe, it, expect } from 'vitest'
import { specialTabState, revealedCards } from './special'
import type { TierMatch } from '@orbit/shared'

function match(overrides: Partial<TierMatch> = {}): TierMatch {
  return {
    id: 'm1',
    user_a: 'self',
    user_b: 'them',
    status: 'active',
    tier: 1,
    card_a: null,
    card_b: null,
    decision_a: null,
    decision_b: null,
    last_result: null,
    last_card_a: null,
    last_card_b: null,
    opponent_id: 'them',
    opponent_name: 'Them',
    ...overrides,
  }
}

describe('specialTabState', () => {
  it('returns null when selfId is not in the match', () => {
    expect(specialTabState(match(), 'stranger')).toBeNull()
  })

  it('phase is pick until my card is played', () => {
    const st = specialTabState(match({ card_b: 'theirs' }), 'self')
    expect(st).not.toBeNull()
    expect(st!.phase).toBe('pick')
    expect(st!.myCardId).toBeNull()
    expect(st!.opponentCardId).toBe('theirs')
  })

  it('phase is pick when only my card is in', () => {
    const st = specialTabState(match({ card_a: 'mine' }), 'self')
    expect(st!.phase).toBe('pick')
    expect(st!.myCardId).toBe('mine')
  })

  it('phase is decide when both cards are in', () => {
    const st = specialTabState(match({ card_a: 'mine', card_b: 'theirs' }), 'self')
    expect(st!.phase).toBe('decide')
    expect(st!.myDecision).toBeNull()
  })

  it('maps slots correctly for the b side', () => {
    const st = specialTabState(match({ user_a: 'them', user_b: 'self', card_a: 'theirs', card_b: 'mine' }), 'self')
    expect(st!.mySlot).toBe('b')
    expect(st!.myCardId).toBe('mine')
    expect(st!.opponentCardId).toBe('theirs')
    expect(st!.opponentId).toBe('them')
  })

  it('phase is reveal after a mutual like (advanced to next tier)', () => {
    const st = specialTabState(match({ card_a: null, card_b: null, tier: 3, last_result: 'both_like', last_card_a: 'mine', last_card_b: 'theirs' }), 'self')
    expect(st!.phase).toBe('reveal')
    expect(st!.tier).toBe(3)
  })

  it('phase is ended when status is ended', () => {
    const st = specialTabState(match({ status: 'ended', last_result: 'ended', last_card_a: 'mine', last_card_b: 'theirs' }), 'self')
    expect(st!.phase).toBe('ended')
  })
})

describe('revealedCards', () => {
  it('uses live cards outside reveal/ended', () => {
    const st = specialTabState(match({ card_a: 'mine', card_b: 'theirs' }), 'self')!
    expect(revealedCards(st)).toEqual({ mine: 'mine', theirs: 'theirs' })
  })

  it('uses last cards during reveal', () => {
    const st = specialTabState(match({ last_result: 'both_like', last_card_a: 'mine', last_card_b: 'theirs' }), 'self')!
    expect(revealedCards(st)).toEqual({ mine: 'mine', theirs: 'theirs' })
  })

  it('flips last cards for the b side during reveal', () => {
    const st = specialTabState(match({ user_a: 'them', user_b: 'self', last_result: 'both_like', last_card_a: 'theirs', last_card_b: 'mine' }), 'self')!
    expect(revealedCards(st)).toEqual({ mine: 'mine', theirs: 'theirs' })
  })
})
