import { describe, expect, it } from 'vitest'
import { generateFallbackName } from '@orbit/shared'
import { mergeFollowIds, mergeFollowRows } from './followList'

/**
 * The profile's Followers/Following tabs used to render the node's JSON
 * verbatim. A follow is a signed operation, so a follow made while the node was
 * unreachable existed in the durable log and nowhere else — invisible on the
 * very profile that should show it — and an unfollow that stayed off-node left a
 * row that could not be masked.
 *
 * The merge rule is the same one the feed's `followingIds` already uses:
 * operations ADD what the node does not know and MASK what it still lists.
 */
const edges = (added: string[] = [], removed: string[] = []) => ({
  added: new Set(added),
  removed: new Set(removed),
})

describe('mergeFollowIds (local-first follower/following lists)', () => {
  it('keeps the node list, in the node order, when there are no operations', () => {
    expect(mergeFollowIds(['a', 'b', 'c'], edges())).toEqual(['a', 'b', 'c'])
  })

  it('appends a follow the node never received', () => {
    expect(mergeFollowIds(['a'], edges(['b']))).toEqual(['a', 'b'])
  })

  it('masks a stale row my own unfollow withdrew', () => {
    expect(mergeFollowIds(['a', 'b'], edges([], ['b']))).toEqual(['a'])
  })

  it('a live follow outranks a stale withdrawal (re-follow)', () => {
    expect(mergeFollowIds(['a'], edges(['b'], ['b']))).toEqual(['a', 'b'])
  })

  it('never duplicates an id present in both sources', () => {
    expect(mergeFollowIds(['a', 'b'], edges(['b', 'a']))).toEqual(['a', 'b'])
  })

  it('works with no node list at all (offline boot)', () => {
    expect(mergeFollowIds([], edges(['x', 'y']))).toEqual(['x', 'y'])
  })
})

describe('mergeFollowRows', () => {
  const alice = { id: 'alice', display_name: 'Alice', pfp_url: '/api/objects/a', online: true, score: 12, matches_won: 9, tags: ['cars'] }

  it('keeps the node row fields the renderer uses', () => {
    const [row] = mergeFollowRows([alice], ['alice'])
    expect(row).toMatchObject({
      id: 'alice',
      display_name: 'Alice',
      pfp_url: '/api/objects/a',
      online: true,
      score: 12,
      matches_won: 9,
      tags: ['cars'],
    })
  })

  it('names an operation-only id from the roster, with its avatar and presence', () => {
    const [row] = mergeFollowRows(
      [],
      ['peer-1'],
      [{ id: 'peer-1', display_name: 'Kenny', pfp_url: '/api/objects/k', online: true, tags: ['ducks'] }],
    )
    expect(row).toMatchObject({
      id: 'peer-1',
      display_name: 'Kenny',
      pfp_url: '/api/objects/k',
      online: true,
      tags: ['ducks'],
    })
  })

  it('falls back to a readable handle, never a truncated hash fragment', () => {
    const [row] = mergeFollowRows([], ['abcdef0123456789'])
    expect(row.display_name).toBe(generateFallbackName('abcdef0123456789'))
    expect(row.display_name).not.toContain('...')
  })

  it('never shows a server-minted placeholder name, even from the roster', () => {
    const [row] = mergeFollowRows([], ['abcdef0123456789'], [
      { id: 'abcdef0123456789', display_name: 'User_abcdef' },
    ])
    expect(row.display_name).toBe(generateFallbackName('abcdef0123456789'))
  })

  it('uses the cached profile picture when the row has none', () => {
    const [row] = mergeFollowRows([{ id: 'bob' }], ['bob'], [], { bob: 'blob:bob' })
    expect(row.pfp_url).toBe('blob:bob')
    expect(row.online).toBe(false)
  })

  it('renders ids in the merged order and drops duplicates and empties', () => {
    const rows = mergeFollowRows([alice], ['bob', 'alice', 'bob', ''])
    expect(rows.map((row) => row.id)).toEqual(['bob', 'alice'])
  })
})