import { describe, expect, it } from 'vitest'
import { mergeFollowing, type PeerFollowView } from './usePeerFollows'

/**
 * Who you follow must survive a node that cannot answer.
 *
 * `followingIds` used to be `GET /api/users/:id/following` alone. A follow is a
 * signed operation and was committed durably, but nothing read it back: with
 * the node unreachable the list came back empty, so a follow made offline was
 * gone on the next launch, the feed re-suggested people you already follow, and
 * every followed profile offered "Follow" again.
 *
 * The merge rule is deliberately asymmetric:
 * - operations ADD what the node does not know (a fresh off-node follow);
 * - operations REMOVE what the node still lists (the node's row lags, or the
 *   unfollow happened off-node and never reached it).
 */
function view(following: string[], removed: string[] = []): PeerFollowView {
  return { following: new Set(following), removed: new Set(removed) }
}

describe('mergeFollowing (the local-first follow graph)', () => {
  it('keeps the node list when there are no operations', () => {
    expect(mergeFollowing(['a', 'b'], view([], []))).toEqual(['a', 'b'])
  })

  it('adds a follow the node does not know about', () => {
    // The node was unreachable when the follow was made: only the operation
    // knows it.
    expect(mergeFollowing(['a'], view(['b']))).toEqual(['a', 'b'])
  })

  it('masks a follow my own operation withdrew', () => {
    // The node still lists `b`; the operation is the newer intent.
    expect(mergeFollowing(['a', 'b'], view([], ['b']))).toEqual(['a'])
  })

  it('a live follow outranks a stale removal (re-follow)', () => {
    expect(mergeFollowing(['a', 'b'], view(['b'], ['b']))).toEqual(['a', 'b'])
  })

  it('never duplicates an id present in both sources', () => {
    expect(mergeFollowing(['a', 'b'], view(['b', 'a']))).toEqual(['a', 'b'])
  })

  it('works with no node list at all (offline boot)', () => {
    expect(mergeFollowing([], view(['x', 'y']))).toEqual(['x', 'y'])
  })
})