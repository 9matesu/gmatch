"use client";

import { usePeerProjection } from './usePeerProjection'
import { projectFollowState } from '../services/socialInteractionProjection'

/**
 * My own follows, read from the peer operation log.
 *
 * A follow is a signed operation, so it is durable off-node — but nothing read
 * it back: `followingIds` came from `GET /api/users/:id/following` alone. A
 * follow made while the node was unreachable therefore looked applied (the
 * op committed, the UI was optimistic) and was GONE on the next launch, even
 * though the operation was sitting in the durable log: the feed re-suggested
 * people the player already follows and every followed profile showed
 * "Follow" again. This is the read half of the peer graph.
 */
export interface PeerFollowView {
  /** Ids I actively follow, per my own signed operations. */
  following: ReadonlySet<string>
  /**
   * Ids my own removal superseded. The node may still list such a follow (its
   * bookkeeping row lagged, or the unfollow happened off-node), so a merged
   * reader must drop these instead of trusting the node.
   */
  removed: ReadonlySet<string>
}

const EMPTY: PeerFollowView = { following: new Set(), removed: new Set() }

export function usePeerFollows(selfId?: string | null): PeerFollowView {
  return usePeerProjection<PeerFollowView>(
    (entries) => {
      if (!selfId) return EMPTY
      const state = projectFollowState(entries)
      // `following` and `removed` are disjoint by construction (a live follow
      // wins over a withdrawn one), so no extra reconciliation is needed here.
      return {
        following: state.following.get(selfId) ?? new Set(),
        removed: state.removed.get(selfId) ?? new Set(),
      }
    },
    selfId,
    EMPTY,
  )
}

/**
 * Merge the node's following list with my own operations. Pure, so the rule is
 * testable without a node or a log: the operation union ADDS what the node does
 * not know, and the operation removal MASKS what the node still lists.
 */
export function mergeFollowing(
  serverIds: readonly string[],
  peer: PeerFollowView,
): string[] {
  const merged = new Set(serverIds)
  // Order matters: mask what my own operations withdrew FIRST, then union what
  // they added. Even though the projection keeps the two sets disjoint, a live
  // follow must always win over a stale removal.
  for (const id of peer.removed) merged.delete(id)
  for (const id of peer.following) merged.add(id)
  return [...merged]
}