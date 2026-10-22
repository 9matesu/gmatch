"use client";

import {
  authorizeValidatedOperation,
  createSocialOperation,
  type SocialOperation,
} from '@orbit/protocol'
import type { OrbitIdentityLike } from '../utils/api'
import type { SocialOperationLog } from './socialOperationLog'

/**
 * Signed social-state operations (roadmap L5.1): reactions and comments.
 *
 * These are the FIRST operations that are not a post. Same rules as the post
 * path: signed, chained onto the actor's sequence, appended to the DURABLE log
 * before any network call, and authorized against the accepted history.
 *
 * Honest constraint (not a bug, a design consequence): a reaction or comment
 * can only be authored against a target that EXISTS IN THE LOCAL OPERATION
 * LOG. A post that only lives on a central node has no `post.create` operation
 * here, and the protocol refuses a reaction whose target is unavailable — so
 * peer-replicated social state works on peer-replicated content, while posts
 * that exist only on a node keep using the node's own endpoints. There is no
 * hidden fallback in between.
 */

export type ReactionTargetType = 'post' | 'comment'

export interface ReactionTarget {
  targetType: ReactionTargetType
  targetId: string
}

/**
 * Where a like must be persisted: as a signed operation (the post came from a
 * peer, so no node owns it) or on the node (server content). The decision is
 * a pure function so it can be tested without the shell.
 */
export function likePersistenceRoute(
  post: { origin?: 'server' | 'peer' } | null | undefined,
): 'peer-operation' | 'server' {
  return post?.origin === 'peer' ? 'peer-operation' : 'server'
}

/**
 * Where a comment must be persisted. Same rule as a like: a peer-replicated
 * post has no node row to comment on, so the comment is a signed operation.
 */
export function commentPersistenceRoute(
  post: { origin?: 'server' | 'peer' } | null | undefined,
): 'peer-operation' | 'server' {
  return post?.origin === 'peer' ? 'peer-operation' : 'server'
}

/** Persist a like as a signed operation (peer-replicated posts). */
export async function persistPeerLike(
  identity: OrbitIdentityLike,
  target: ReactionTarget,
  liked: boolean,
  log: SocialOperationLog,
): Promise<void> {
  if (liked) await publishReactionAdd(identity, target, log)
  else await publishReactionRemove(identity, target, log)
}

/** Every accepted operation, in any order — the authorizer's history. */
async function acceptedHistory(log: SocialOperationLog): Promise<SocialOperation[]> {
  const entries = await log.listAllOperations()
  return entries.map((entry) => entry.record as unknown as SocialOperation)
}

async function signAndAppend(
  identity: OrbitIdentityLike,
  log: SocialOperationLog,
  operation: Omit<SocialOperation, 'operationId' | 'signature'>,
  history: SocialOperation[],
): Promise<SocialOperation> {
  // Sign first (the shape is validated by the signer), then authorize the
  // SIGNED operation against the accepted history — an unsigned draft cannot
  // be authorized (the authorizer verifies ids and signatures).
  const signed = createSocialOperation(operation, identity.privateKeyHex)
  // The log only holds operations that were validated on ingest.
  const error = authorizeValidatedOperation(signed, history, { verifiedManifests: new Map(), trustedHistory: true })
  if (error) throw new Error(error)
  const { outcome } = await log.append({
    operationId: signed.operationId,
    actorId: signed.actorId,
    actorSequence: signed.actorSequence,
    createdAt: signed.createdAt,
    record: signed as unknown as Record<string, unknown>,
  })
  if (outcome === 'duplicate') throw new Error('operation already committed to the durable log')
  return signed
}

/** Reaction operations get their own id namespace; the protocol's objectId
 *  charset is [A-Za-z0-9_-], so the target is folded in without separators
 *  that would break it. */
function reactionObjectId(target: ReactionTarget): string {
  const targetId = target.targetId.replace(/[^A-Za-z0-9_-]/g, '')
  return `reaction_${target.targetType}_${targetId}`
}

/** Like a post or comment (reaction.add). */
export async function publishReactionAdd(
  identity: OrbitIdentityLike,
  target: ReactionTarget,
  log: SocialOperationLog,
): Promise<SocialOperation> {
  const { actorSequence, previousOperationId } = await log.nextActorSlot(identity.orbitId)
  const history = await acceptedHistory(log)
  return signAndAppend(identity, log, {
    protocol: 'gmatch-social',
    version: 1,
    type: 'reaction.add',
    actorId: identity.orbitId,
    signingKey: identity.publicKeyHex,
    actorSequence,
    previousOperationId,
    createdAt: Date.now(),
    objectId: reactionObjectId(target),
    payload: { targetType: target.targetType, targetId: target.targetId, reaction: 'like' },
  }, history)
}

/**
 * Undo a like. The operation references the actor's own `reaction.add`
 * operations (that is how a removal is authorized and how a peer can see
 * exactly which likes were withdrawn).
 */
export async function publishReactionRemove(
  identity: OrbitIdentityLike,
  target: ReactionTarget,
  log: SocialOperationLog,
): Promise<SocialOperation> {
  const history = await acceptedHistory(log)
  const removed = new Set(history
    .filter((entry) => entry.type === 'reaction.remove')
    .flatMap((entry) => (entry.payload as { targetAddOperationIds?: string[] }).targetAddOperationIds ?? []))
  const adds = history
    .filter((entry) => entry.type === 'reaction.add' && entry.actorId === identity.orbitId)
    .filter((entry) => (entry.payload as { targetType?: string }).targetType === target.targetType)
    .filter((entry) => (entry.payload as { targetId?: string }).targetId === target.targetId)
    .filter((entry) => !removed.has(entry.operationId))
    .map((entry) => entry.operationId)
  if (adds.length === 0) throw new Error('no active reaction to remove')
  const { actorSequence, previousOperationId } = await log.nextActorSlot(identity.orbitId)
  return signAndAppend(identity, log, {
    protocol: 'gmatch-social',
    version: 1,
    type: 'reaction.remove',
    actorId: identity.orbitId,
    signingKey: identity.publicKeyHex,
    actorSequence,
    previousOperationId,
    createdAt: Date.now(),
    objectId: reactionObjectId(target),
    payload: { targetAddOperationIds: adds },
  }, history)
}

export interface CommentInput {
  /** The post's objectId — it must exist in the local operation log. */
  postId: string
  /** Parent comment objectId, or null for a top-level comment. */
  parentCommentId: string | null
  body: string
  /** Stable id for this comment (unique per comment). */
  commentId: string
}

/**
 * Persist a comment as a signed operation (peer-replicated posts). The caller
 * owns the id it wants the comment to carry, so the optimistic row and the
 * projected row agree.
 */
export async function persistPeerComment(
  identity: OrbitIdentityLike,
  input: CommentInput,
  log: SocialOperationLog,
): Promise<SocialOperation> {
  return publishComment(identity, input, log)
}

export async function publishComment(
  identity: OrbitIdentityLike,
  input: CommentInput,
  log: SocialOperationLog,
): Promise<SocialOperation> {
  const { actorSequence, previousOperationId } = await log.nextActorSlot(identity.orbitId)
  const history = await acceptedHistory(log)
  return signAndAppend(identity, log, {
    protocol: 'gmatch-social',
    version: 1,
    type: 'comment.create',
    actorId: identity.orbitId,
    signingKey: identity.publicKeyHex,
    actorSequence,
    previousOperationId,
    createdAt: Date.now(),
    objectId: input.commentId,
    payload: { postId: input.postId, parentCommentId: input.parentCommentId, body: input.body },
  }, history)
}

export async function publishCommentDelete(
  identity: OrbitIdentityLike,
  commentOperationId: string,
  log: SocialOperationLog,
): Promise<SocialOperation> {
  const history = await acceptedHistory(log)
  const target = history.find((entry) => entry.operationId === commentOperationId)
  if (!target || target.type !== 'comment.create') throw new Error('comment not found in the local log')
  if (target.actorId !== identity.orbitId) throw new Error('only the comment author may delete it')
  const { actorSequence, previousOperationId } = await log.nextActorSlot(identity.orbitId)
  return signAndAppend(identity, log, {
    protocol: 'gmatch-social',
    version: 1,
    type: 'comment.delete',
    actorId: identity.orbitId,
    signingKey: identity.publicKeyHex,
    actorSequence,
    previousOperationId,
    createdAt: Date.now(),
    objectId: target.objectId,
    payload: { targetOperationId: commentOperationId },
  }, history)
}
