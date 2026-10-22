"use client";

import type { SocialOperation } from '@orbit/protocol'
import type { LoggedOperation } from './socialOperationLog'

/**
 * Projection of social state that is not a post (roadmap L5.1): reactions and
 * comments.
 *
 * Pure and deterministic, derived only from ACCEPTED operations. Same rules as
 * the post projection: identity is the operation's own id, ordering never uses
 * a server clock, and a tombstone hides the thing it targets.
 *
 * Reaction semantics mirror the protocol's authorization rules: an add is
 * active until some removal references it. One actor holds at most one active
 * like per target (the authorizer refuses the duplicate), so counting active
 * adds is counting distinct actors.
 */

export interface ProjectedReaction {
  targetType: 'post' | 'comment'
  targetId: string
  count: number
  /** Actor ids with an active like, sorted for stable output. */
  actors: string[]
}

export interface ProjectedComment {
  id: string
  operationId: string
  postId: string
  parentCommentId: string | null
  body: string
  authorId: string
  createdAt: number
  replies: ProjectedComment[]
}

function operationsOf(entries: readonly LoggedOperation[]): SocialOperation[] {
  const out: SocialOperation[] = []
  for (const entry of entries) {
    const record = entry.record as Partial<SocialOperation> | null
    if (record && typeof record === 'object' && typeof record.type === 'string' &&
        typeof record.operationId === 'string' && record.payload && typeof record.payload === 'object') {
      out.push(record as SocialOperation)
    }
  }
  return out
}

export function reactionKey(targetType: string, targetId: string): string {
  return `${targetType}:${targetId}`
}

/** Active reactions per target, keyed by `type:id`. */
export function projectReactions(entries: readonly LoggedOperation[]): Map<string, ProjectedReaction> {
  const operations = operationsOf(entries)
  const removed = new Set<string>()
  for (const operation of operations) {
    if (operation.type !== 'reaction.remove') continue
    const ids = (operation.payload as { targetAddOperationIds?: unknown }).targetAddOperationIds
    if (Array.isArray(ids)) for (const id of ids) if (typeof id === 'string') removed.add(id)
  }
  const byTarget = new Map<string, Set<string>>()
  for (const operation of operations) {
    if (operation.type !== 'reaction.add') continue
    if (removed.has(operation.operationId)) continue
    const payload = operation.payload as { targetType?: unknown; targetId?: unknown }
    if (payload.targetType !== 'post' && payload.targetType !== 'comment') continue
    if (typeof payload.targetId !== 'string') continue
    const key = reactionKey(payload.targetType, payload.targetId)
    const actors = byTarget.get(key) ?? new Set<string>()
    actors.add(operation.actorId)
    byTarget.set(key, actors)
  }
  const out = new Map<string, ProjectedReaction>()
  for (const [key, actors] of byTarget) {
    const [targetType, ...rest] = key.split(':')
    out.set(key, {
      targetType: targetType as 'post' | 'comment',
      targetId: rest.join(':'),
      count: actors.size,
      actors: [...actors].sort(),
    })
  }
  return out
}

/**
 * The peer social graph: follower id -> the ids they follow.
 *
 * A follow is active until some removal references its add operation. Only
 * the follower's own operations count (an actor cannot follow somebody on
 * their behalf).
 */
export function projectFollows(entries: readonly LoggedOperation[]): Map<string, Set<string>> {
  const operations = operationsOf(entries)
  const removed = new Set<string>()
  for (const operation of operations) {
    if (operation.type !== 'follow.remove') continue
    const ids = (operation.payload as { targetAddOperationIds?: unknown }).targetAddOperationIds
    if (Array.isArray(ids)) for (const id of ids) if (typeof id === 'string') removed.add(id)
  }
  const out = new Map<string, Set<string>>()
  for (const operation of operations) {
    if (operation.type !== 'follow.add') continue
    if (removed.has(operation.operationId)) continue
    const targetId = (operation.payload as { targetId?: unknown }).targetId
    if (typeof targetId !== 'string') continue
    const followees = out.get(operation.actorId) ?? new Set<string>()
    followees.add(targetId)
    out.set(operation.actorId, followees)
  }
  return out
}

/** A report about content, as the author sees it. */
export interface ProjectedReport {
  operationId: string
  targetType: 'post' | 'comment'
  targetId: string
  reason: string
  reporterId: string
  createdAt: number
}

/**
 * The reports about the content of ONE author (their own view).
 *
 * The author of the reported content is the author of the operation that
 * created it — a report about somebody else's post is not shown to you.
 */
export function projectReportsFor(entries: readonly LoggedOperation[], authorId: string): ProjectedReport[] {
  const operations = operationsOf(entries)
  const authorOf = new Map<string, string>()
  for (const operation of operations) {
    if (operation.type !== 'post.create' && operation.type !== 'comment.create') continue
    if (!authorOf.has(operation.objectId)) authorOf.set(operation.objectId, operation.actorId)
  }
  const out: ProjectedReport[] = []
  for (const operation of operations) {
    if (operation.type !== 'report.create') continue
    const payload = operation.payload as { targetType?: unknown; targetId?: unknown; reason?: unknown }
    if (payload.targetType !== 'post' && payload.targetType !== 'comment') continue
    if (typeof payload.targetId !== 'string') continue
    if (authorOf.get(payload.targetId) !== authorId) continue
    out.push({
      operationId: operation.operationId,
      targetType: payload.targetType,
      targetId: payload.targetId,
      reason: typeof payload.reason === 'string' ? payload.reason : '',
      reporterId: operation.actorId,
      createdAt: operation.createdAt,
    })
  }
  return out.sort((a, b) => a.createdAt - b.createdAt)
}

/** Comment threads per post. Deleted comments are hidden; a reply whose
 *  parent is missing (gap) is kept as a top-level comment instead of vanishing. */
export function projectComments(entries: readonly LoggedOperation[]): Map<string, ProjectedComment[]> {
  const operations = operationsOf(entries)
  const deleted = new Set<string>()
  for (const operation of operations) {
    if (operation.type !== 'comment.delete') continue
    const target = (operation.payload as { targetOperationId?: unknown }).targetOperationId
    if (typeof target === 'string') deleted.add(target)
  }

  const byId = new Map<string, ProjectedComment>()
  for (const operation of operations) {
    if (operation.type !== 'comment.create') continue
    if (deleted.has(operation.operationId)) continue
    const payload = operation.payload as { postId?: unknown; parentCommentId?: unknown; body?: unknown }
    if (typeof payload.postId !== 'string' || typeof payload.body !== 'string') continue
    byId.set(operation.objectId, {
      id: operation.objectId,
      operationId: operation.operationId,
      postId: payload.postId,
      parentCommentId: typeof payload.parentCommentId === 'string' ? payload.parentCommentId : null,
      body: payload.body,
      authorId: operation.actorId,
      createdAt: operation.createdAt,
      replies: [],
    })
  }

  const byPost = new Map<string, ProjectedComment[]>()
  for (const comment of byId.values()) {
    const list = byPost.get(comment.postId) ?? []
    list.push(comment)
    byPost.set(comment.postId, list)
  }

  // Nest replies under their parent; orphans (missing parent) stay top-level.
  const rootsByPost = new Map<string, ProjectedComment[]>()
  for (const [postId, list] of byPost) {
    const parents = new Map(list.map((comment) => [comment.id, comment]))
    const roots: ProjectedComment[] = []
    for (const comment of list) {
      const parent = comment.parentCommentId ? parents.get(comment.parentCommentId) : undefined
      if (parent && parent.id !== comment.id) {
        parent.replies.push(comment)
      } else {
        roots.push(comment)
      }
    }
    const byTime = (a: ProjectedComment, b: ProjectedComment) =>
      a.createdAt - b.createdAt || (a.operationId < b.operationId ? -1 : 1)
    for (const comment of list) comment.replies.sort(byTime)
    roots.sort(byTime)
    rootsByPost.set(postId, roots)
  }
  return rootsByPost
}
