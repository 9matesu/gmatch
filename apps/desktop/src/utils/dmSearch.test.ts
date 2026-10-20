import { describe, expect, it } from 'vitest'
import {
  DM_SEARCH_MAX_INDEX,
  buildDmSearchIndex,
  searchDmIndex,
  searchThread,
  type SearchableMessage,
} from './dmSearch'

const msg = (id: string, text: string, ts: number, extra: Partial<SearchableMessage> = {}): SearchableMessage => ({
  id,
  text,
  ts,
  ...extra,
})

describe('buildDmSearchIndex', () => {
  it('orders every thread newest-first', () => {
    const { index } = buildDmSearchIndex({
      a: [msg('a1', 'one', 100), msg('a2', 'two', 300)],
      b: [msg('b1', 'three', 200)],
    })
    expect(index.map((e) => e.message.id)).toEqual(['a2', 'b1', 'a1'])
  })

  it('bounds the index and admits truncation instead of hiding the tail', () => {
    const thread = Array.from({ length: 10 }, (_, i) => msg(`m${i}`, `text ${i}`, i))
    const { index, truncated } = buildDmSearchIndex({ a: thread }, 4)
    expect(index).toHaveLength(4)
    expect(truncated).toBe(true)
  })

  it('reports no truncation at exactly the budget', () => {
    const thread = Array.from({ length: 4 }, (_, i) => msg(`m${i}`, `text ${i}`, i))
    expect(buildDmSearchIndex({ a: thread }, 4).truncated).toBe(false)
  })

  it('defaults to a bounded budget', () => {
    const thread = Array.from({ length: DM_SEARCH_MAX_INDEX + 5 }, (_, i) => msg(`m${i}`, `t${i}`, i))
    expect(buildDmSearchIndex({ a: thread }).index).toHaveLength(DM_SEARCH_MAX_INDEX)
  })
})

describe('searchDmIndex', () => {
  const { index } = buildDmSearchIndex({
    a: [msg('a1', 'Hello Kenny', 100), msg('a2', 'hello world', 400)],
    b: [msg('b1', 'nothing here', 200), msg('b2', 'HELLO again', 300)],
  })

  it('is case-insensitive and newest-first', () => {
    expect(searchDmIndex(index, 'hello').map((h) => h.messageId)).toEqual(['a2', 'b2', 'a1'])
  })

  it('requires two characters so a stray keystroke cannot scan everything', () => {
    expect(searchDmIndex(index, 'h')).toEqual([])
  })

  it('honours the result cap', () => {
    expect(searchDmIndex(index, 'hello', 2)).toHaveLength(2)
  })

  it('skips deleted tombstones', () => {
    const deleted = buildDmSearchIndex({ a: [msg('x', 'hello', 1, { deletedTs: 2 })] })
    expect(searchDmIndex(deleted.index, 'hello')).toEqual([])
  })

  it('returns the conversation for each hit', () => {
    expect(searchDmIndex(index, 'kenny')[0]).toMatchObject({ peerId: 'a', messageId: 'a1' })
  })
})

describe('searchThread', () => {
  it('searches one conversation without building a global index', () => {
    expect(searchThread([msg('m1', 'pizza tonight', 1)], 'pizza')[0].messageId).toBe('m1')
  })

  it('tolerates a missing thread', () => {
    expect(searchThread(undefined, 'pizza')).toEqual([])
  })
})
