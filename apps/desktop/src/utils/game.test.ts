import { describe, it, expect } from 'vitest'
import {
  shouldEnqueue,
  dedupeQueue,
  dismissFromQueue,
  spinPick,
  recordDecision,
  isNewMatch,
  mergeLocalDecisions,
  pruneDecisionMap,
  enqueueableItems,
} from './game'

describe('game queue helpers', () => {
  it('shouldEnqueue excludes stories, own items, and already-decided items (T-U6)', () => {
    const decisions: Record<string, 'like' | 'reject' | 'pass'> = { 'obj-1': 'like' }
    const own = { id: 'obj-own', owner_id: 'me' }
    const story = { id: 'obj-story', owner_id: 'them', is_story: 1 }
    const decided = { id: 'obj-1', owner_id: 'them' }
    const fresh = { id: 'obj-2', owner_id: 'them' }

    expect(shouldEnqueue(fresh, decisions, 'me')).toBe(true)
    expect(shouldEnqueue(own, decisions, 'me')).toBe(false)
    expect(shouldEnqueue(story, decisions, 'me')).toBe(false)
    expect(shouldEnqueue(decided, decisions, 'me')).toBe(false)
  })

  it('dedupeQueue never enqueues the same item twice (F-C1)', () => {
    const queue = [{ id: 'a', owner_id: 'x' }]
    const next = dedupeQueue(queue, { id: 'a', owner_id: 'x' })
    expect(next.length).toBe(1)
    expect(dedupeQueue(queue, { id: 'b', owner_id: 'y' }).length).toBe(2)
  })

  it('dismissFromQueue removes by id or shifts the head (T-U1)', () => {
    const queue = [{ id: 'a' }, { id: 'b' }]
    expect(dismissFromQueue(queue, 'a')).toEqual([{ id: 'b' }])
    expect(dismissFromQueue(queue)).toEqual([{ id: 'b' }])
  })

  it('isNewMatch only fires on a fresh pair match, not repeat likes (T-B1b)', () => {
    expect(isNewMatch(true, 1)).toBe(true)
    expect(isNewMatch(false, 0)).toBe(false)
    expect(isNewMatch(false, 1)).toBe(false)
  })
})

describe('spinPick', () => {
  const users: { id: string }[] = [
    { id: 'me' },
    { id: 'blocked' },
    { id: 'a' },
    { id: 'b' },
    { id: 'c' },
  ]

  it('excludes self and blocked users (T-U3)', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 200; i++) {
      const pick = spinPick(users, 'me', ['blocked']).target
      expect(pick).not.toBeNull()
      expect(pick!.id).not.toBe('me')
      expect(pick!.id).not.toBe('blocked')
      seen.add(pick!.id)
    }
    expect(seen.has('a')).toBe(true)
  })

  it('prefers unspun users and caps history at 10', () => {
    const history = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']
    const { target, nextHistory } = spinPick(users, 'me', [], history)
    expect(nextHistory.length).toBeLessThanOrEqual(10)
    expect(nextHistory[0]).toBe(target!.id)
    expect(nextHistory.includes(target!.id)).toBe(true)
  })

  it('returns null when no eligible candidates remain', () => {
    expect(spinPick([{ id: 'me' }], 'me', []).target).toBeNull()
    expect(spinPick([{ id: 'me' }, { id: 'blocked' }], 'me', ['blocked']).target).toBeNull()
  })
})

describe('recordDecision', () => {
  it('only records decisions confirmed by the server (T-U2)', () => {
    let map: Record<string, 'like' | 'reject' | 'pass'> = {}
    // confirmed (success response echoing the decision)
    map = recordDecision(map, 'obj-1', 'like', { decision: 'like' })
    expect(map).toEqual({ 'obj-1': 'like' })
    // unconfirmed failure -> no-op
    map = recordDecision(map, 'obj-2', 'like', null)
    expect(map).toEqual({ 'obj-1': 'like' })
    map = recordDecision(map, 'obj-3', 'reject', undefined)
    expect(map).toEqual({ 'obj-1': 'like' })
    // mock fallback echoes `decision: ''` -> NOT a confirmation
    map = recordDecision(map, 'obj-4', 'pass', { decision: '' })
    expect(map).toEqual({ 'obj-1': 'like' })
  })
})

describe('mergeLocalDecisions', () => {
  it('merges a decision map from another tab, preserving local decisions (F-C1)', () => {
    const local = { 'obj-1': 'like' as const }
    const incoming = { 'obj-2': 'reject' as const, 'obj-3': 'pass' as const }
    expect(mergeLocalDecisions(local, incoming)).toEqual({
      'obj-1': 'like',
      'obj-2': 'reject',
      'obj-3': 'pass',
    })
  })

  it('keeps local decisions when the incoming map is empty or missing (F-C1)', () => {
    const local = { 'obj-1': 'like' as const }
    expect(mergeLocalDecisions(local, {})).toEqual(local)
    expect(mergeLocalDecisions(local, null)).toEqual(local)
  })
})

describe('pruneDecisionMap', () => {
  it('caps the decision map to the most recent N entries (F-U8)', () => {
    const map: Record<string, 'like'> = {}
    for (let i = 0; i < 30; i++) map[`obj-${i}`] = 'like'
    const pruned = pruneDecisionMap(map, 10)
    const keys = Object.keys(pruned)
    expect(keys.length).toBe(10)
    // newest entries (obj-20..obj-29) survive, oldest pruned
    expect(pruned['obj-29']).toBe('like')
    expect(pruned['obj-21']).toBe('like')
    expect(pruned['obj-20']).toBe('like')
    expect(pruned['obj-19']).toBeUndefined()
    expect(pruned['obj-0']).toBeUndefined()
  })

  it('returns the map unchanged when under the cap (F-U8)', () => {
    const map = { 'a': 'like' as const, 'b': 'reject' as const }
    expect(pruneDecisionMap(map, 100)).toEqual(map)
  })
})

describe('enqueueableItems', () => {
  it('returns only new, non-story, non-self, undecided items not already enqueued (F-U7)', () => {
    const decisions = { 'obj-decided': 'like' as const }
    const items = [
      { id: 'obj-fresh', owner_id: 'them' },
      { id: 'obj-story', owner_id: 'them', is_story: 1 },
      { id: 'obj-self', owner_id: 'me' },
      { id: 'obj-decided', owner_id: 'them' },
      { id: 'obj-already', owner_id: 'them' },
    ]
    const result = enqueueableItems(items, decisions, 'me', new Set(['obj-already']))
    expect(result.map(i => i.id)).toEqual(['obj-fresh'])
  })
})
