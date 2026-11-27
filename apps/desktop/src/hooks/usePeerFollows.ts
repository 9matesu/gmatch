"use client";

import { usePeerProjection } from './usePeerProjection'
import {
  projectFollowEdgesFor,
  projectFollowState,
  type ProjectedFollowEdges,
} from '../services/socialInteractionProjection'
import { mergeFollowIds } from '../utils/followList'

/**
 * The social graph, read from the peer operation log.
 *
 * A follow is a signed operation, so it is durable off-node — but nothing read
 * it back: `followingIds` came from `GET /api/users/:id/following` alone. A
 * follow made while the node was unreachable therefore looked applied (the
 * op committed, the UI was optimistic) and was GONE on the next launch, even
 * though the operation was sitting in the durable log: the feed re-suggested
 * people the player already follows and every followed profile showed
 * "Follow" again. This is the read half of the peer graph.
 *
 * Two views, one log: `usePeerFollows` is MY OWN list (the feed's
 * `followingIds`), and `usePeerFollowEdges` is the two tabs of ONE profile,
 * own or somebody else's.
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
  return mergeFollowIds(serverIds, { added: peer.following, removed: peer.removed })
}

const EMPTY_EDGES: ProjectedFollowEdges = {
  followers: new Set(),
  following: new Set(),
  withdrawnFollowers: new Set(),
  withdrawnFollowing: new Set(),
}

/**
 * The follow edges around ONE profile — its Followers and Following tabs — read
 * from the peer log.
 *
 * The modal rendered the node's two lists verbatim, so a follow made while the
 * node was unreachable never appeared on the profile that should show it, and an
 * unfollow that stayed off-node left a row that could not be removed. This is the
 * same local-first read the feed's `followingIds` already gets, scoped to the
 * profile being looked at (own or somebody else's).
 *
 * `targetId` doubles as the log-read gate: no id means no profile, so the hook
 * holds the empty value instead of flashing edges for nobody.
 */
export function usePeerFollowEdges(targetId?: string | null): ProjectedFollowEdges {
  return usePeerProjection<ProjectedFollowEdges>(
    (entries) => (targetId ? projectFollowEdgesFor(entries, targetId) : EMPTY_EDGES),
    targetId,
    EMPTY_EDGES,
  )
}