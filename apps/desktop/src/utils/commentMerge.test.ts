import { describe, expect, it } from 'vitest'
import type { PostComment } from '../components/feed/GMatchFeed'
import { mergeCommentRows } from './commentMerge'

function row(id: string, text: string, extra: Partial<PostComment> = {}): PostComment {
  return {
    id,
    author_id: 'a1',
    author_name: 'A',
    text,
    created_at: '2026-10-21T00:00:00.000Z',
    like_count: 0,
    ...extra,
  }
}

describe('mergeCommentRows', () => {
  it('keeps the node rows when there are no peer rows', () => {
    const nodes = [row('n1', 'node')]
    expect(mergeCommentRows(nodes, [])).toEqual(nodes)
  })

  it('adds the peer rows the node never saw', () => {
    const merged = mergeCommentRows([row('n1', 'node')], [row('p1', 'peer')])
    expect(merged.map((r) => r.id)).toEqual(['n1', 'p1'])
  })

  it('never duplicates a row both sides know', () => {
    const merged = mergeCommentRows([row('c1', 'node copy')], [row('c1', 'peer copy')])
    expect(merged).toHaveLength(1)
    // The node row wins: it carries the display name.
    expect(merged[0].text).toBe('node copy')
  })
})
