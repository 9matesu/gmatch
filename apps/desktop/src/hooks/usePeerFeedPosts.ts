"use client";

import { useEffect, useState } from 'react'
import { generateFallbackName } from '@orbit/shared'
import type { FeedPost } from '../components/feed/GMatchFeed'
import {
  OPERATION_LOG_CHANGED_EVENT,
  sharedSocialOperationLog,
  type LoggedOperation,
} from '../services/socialOperationLog'
import { projectPosts, type ProjectedPost } from '../services/socialFeedProjection'
import { PEER_ONLINE_EVENT } from '../utils/p2pSwarm'

/**
 * Peer-replicated feed rows (roadmap L4.2): the visible half of the operation
 * log. Reads are local only — no node route is involved — so a post that
 * arrived from a peer stays visible when every stateful API route 404s.
 *
 * Honest status: `sync_state` reflects the LOCAL delivery state of our own
 * operation (committed/sending/delivered). A peer-authored post carries no
 * sync badge; its `origin` says where the row came from.
 */
export function projectedPostsToFeedPosts(posts: readonly ProjectedPost[], selfId?: string | null): FeedPost[] {
  return posts.map((post): FeedPost => {
    const mine = !!selfId && post.authorId === selfId
    return {
      id: post.id,
      author_id: post.authorId,
      author_name: generateFallbackName(post.authorId),
      author_avatar: null,
      url: `/api/objects/${post.id}`,
      mime_type: post.mimeType,
      caption: post.caption,
      tags: post.tags,
      created_at: new Date(post.createdAt).toISOString(),
      like_count: 0,
      comment_count: 0,
      is_liked: false,
      is_saved: false,
      origin: 'peer',
      ...(mine
        ? {
            sync_state: post.status === 'delivered'
              ? 'replicated' as const
              : post.status === 'sending' ? 'pending' as const : 'local' as const,
          }
        : {}),
    }
  })
}

async function readProjection(selfId?: string | null): Promise<FeedPost[]> {
  const log = sharedSocialOperationLog()
  const entries: LoggedOperation[] = await log.listAllOperations()
  return projectedPostsToFeedPosts(projectPosts(entries), selfId)
}

export function usePeerFeedPosts(selfId?: string | null): FeedPost[] {
  const [posts, setPosts] = useState<FeedPost[]>([])
  useEffect(() => {
    let alive = true
    const refresh = () => {
      void readProjection(selfId)
        .then((next) => { if (alive) setPosts(next) })
        .catch(() => { /* IndexedDB unavailable: the feed simply has no peer rows */ })
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
  return posts
}
