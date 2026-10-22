"use client";

import { useEffect, useState } from 'react'
import { generateFallbackName } from '@orbit/shared'
import type { PostComment } from '../components/feed/GMatchFeed'
import {
  OPERATION_LOG_CHANGED_EVENT,
  sharedSocialOperationLog,
  type LoggedOperation,
} from '../services/socialOperationLog'
import {
  projectComments,
  projectReactions,
  reactionKey,
  type ProjectedComment,
} from '../services/socialInteractionProjection'
import { PEER_ONLINE_EVENT } from '../utils/p2pSwarm'

/**
 * Peer-replicated comments (roadmap L5.2, read half).
 *
 * A comment that a peer authored on a peer-replicated post exists only as a
 * signed operation in the local durable log — there is no node row to fetch.
 * This projects those operations into the same shape the feed renders, so the
 * comment thread is complete without any stateful API route.
 *
 * Honest limit: the projection only knows about comments that came through
 * the operation log. A comment on a post that exists only on a node is still
 * served by that node, and the two lists are merged by id (never duplicated).
 */
export function peerCommentsByPost(
  entries: readonly LoggedOperation[],
  selfId?: string | null,
): Map<string, PostComment[]> {
  const threads = projectComments(entries)
  const reactions = projectReactions(entries)
  const out = new Map<string, PostComment[]>()
  for (const [postId, roots] of threads) {
    const flat: PostComment[] = []
    const push = (comment: ProjectedComment, parentId: string | null) => {
      const reaction = reactions.get(reactionKey('comment', comment.id))
      flat.push({
        id: comment.id,
        author_id: comment.authorId,
        author_name: generateFallbackName(comment.authorId),
        author_avatar: null,
        text: comment.body,
        created_at: new Date(comment.createdAt).toISOString(),
        like_count: reaction?.count ?? 0,
        is_liked: !!selfId && !!reaction?.actors.includes(selfId),
        ...(parentId ? { parent_comment_id: parentId } : {}),
      })
      for (const reply of comment.replies) push(reply, comment.id)
    }
    for (const root of roots) push(root, null)
    out.set(postId, flat)
  }
  return out
}

/** Peer comments per post id, refreshed whenever the operation log changes. */
export function usePeerCommentsByPost(selfId?: string | null): Map<string, PostComment[]> {
  const [comments, setComments] = useState<Map<string, PostComment[]>>(new Map())
  useEffect(() => {
    let alive = true
    const refresh = () => {
      void sharedSocialOperationLog()
        .listAllOperations()
        .then((entries) => {
          if (alive) setComments(peerCommentsByPost(entries, selfId))
        })
        .catch(() => { /* IndexedDB unavailable: no peer comments */ })
    }
    refresh()
    window.addEventListener(OPERATION_LOG_CHANGED_EVENT, refresh)
    window.addEventListener(PEER_ONLINE_EVENT, refresh)
    return () => {
      alive = false
      window.removeEventListener(OPERATION_LOG_CHANGED_EVENT, refresh)
      window.removeEventListener(PEER_ONLINE_EVENT, refresh)
    }
  }, [selfId])
  return comments
}
