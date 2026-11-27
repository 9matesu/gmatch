"use client";

import {
  SOCIAL_PROTOCOL,
  SOCIAL_PROTOCOL_VERSION,
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

/**
 * Where a save must be persisted.
 *
 * Same split as a like, but the peer half is a LOCAL durable store, not a
 * signed operation: a bookmark is private intent with no shared signal, so
 * unlike a like it is never gossiped. A peer-replicated post has no node row,
 * so `POST /api/posts/:id/save` 404s it; the id lands in `utils/peerSaves.ts`
 * instead and the Saved tab merges it back.
 */
export function savePersistenceRoute(
  post: { origin?: 'server' | 'peer' } | null | undefined,
): 'local-store' | 'server' {
  return post?.origin === 'peer' ? 'local-store' : 'server'
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

/**
 * Append one signed social operation.
 *
 * The envelope fields every operation shares (protocol, version, actorId,
 * signingKey, createdAt) used to be spelled out by hand in EIGHT publish
 * functions below — including the protocol strings as bare literals, so a
 * protocol bump could silently disagree with what the signer validates. They
 * come from the protocol package now, and the actor fields come from the one
 * identity the caller already holds.
 */
async function appendSocial(
  identity: OrbitIdentityLike,
  log: SocialOperationLog,
  type: string,
  objectId: string,
  payload: Record<string, unknown>,
  history: SocialOperation[],
): Promise<SocialOperation> {
  const { actorSequence, previousOperationId } = await log.nextActorSlot(identity.orbitId)
  const operation: Omit<SocialOperation, 'operationId' | 'signature'> = {
    protocol: SOCIAL_PROTOCOL,
    version: SOCIAL_PROTOCOL_VERSION,
    type,
    actorId: identity.orbitId,
    signingKey: identity.publicKeyHex,
    actorSequence,
    previousOperationId,
    createdAt: Date.now(),
    objectId,
    payload,
  }
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
  return appendSocial(identity, log, 'reaction.add', reactionObjectId(target),
    { targetType: target.targetType, targetId: target.targetId, reaction: 'like' },
    await acceptedHistory(log))
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
  return appendSocial(identity, log, 'reaction.remove', reactionObjectId(target),
    { targetAddOperationIds: adds }, history)
}

/**
 * The social graph and the reports, as signed operations (roadmap L5/L7).
 *
 * A follow targets a USER, not a post: the followed account may never post
 * here, so it needs no local operation to exist. The removal references the
 * author's own add operation, exactly like a reaction removal.
 */
export async function publishFollow(
  identity: OrbitIdentityLike,
  targetId: string,
  log: SocialOperationLog,
): Promise<SocialOperation> {
  return appendSocial(identity, log, 'follow.add', `follow_${targetId}`, { targetId },
    await acceptedHistory(log))
}

/**
 * The operation id of MY active follow of this user (the undo needs it), or
 * null when there is none.
 */
export function activeFollowOperationId(
  entries: readonly { record: unknown }[],
  selfId: string,
  targetId: string,
): string | null {
  const removed = new Set<string>()
  const operations = entries
    .map((entry) => entry.record as { type?: string; operationId?: string; actorId?: string; payload?: { targetId?: unknown; targetAddOperationIds?: unknown } } | null)
    .filter((record): record is NonNullable<typeof record> => !!record && typeof record === 'object')
  for (const record of operations) {
    if (record.type !== 'follow.remove') continue
    const ids = record.payload?.targetAddOperationIds
    if (Array.isArray(ids)) for (const id of ids) if (typeof id === 'string') removed.add(id)
  }
  for (const record of operations) {
    if (record.type !== 'follow.add') continue
    if (record.actorId !== selfId) continue
    if (record.payload?.targetId !== targetId) continue
    if (!record.operationId) continue
    if (removed.has(record.operationId)) continue
    return record.operationId
  }
  return null
}

/**
 * Unfollow: the removal names the author's own accepted follow operation.
 * Without it there is nothing to undo, and the authorizer refuses.
 */
export async function publishUnfollow(
  identity: OrbitIdentityLike,
  followOperationId: string,
  log: SocialOperationLog,
): Promise<SocialOperation> {
  const history = await acceptedHistory(log)
  const target = history.find((entry) => entry.operationId === followOperationId)
  if (!target || target.type !== 'follow.add') throw new Error('follow not found in the local log')
  if (target.actorId !== identity.orbitId) throw new Error('only the follower may remove the follow')
  return appendSocial(identity, log, 'follow.remove', target.objectId,
    { targetAddOperationIds: [followOperationId] }, history)
}

/**
 * A report about content (a post or a comment). It travels as a signed
 * operation, so it reaches the author of the content through the mesh: in a
 * mesh there is no central moderator, and the author is the one who can act.
 */
export async function publishReport(
  identity: OrbitIdentityLike,
  target: { targetType: 'post' | 'comment'; targetId: string },
  reason: string,
  log: SocialOperationLog,
): Promise<SocialOperation> {
  return appendSocial(identity, log, 'report.create', `report_${target.targetId}`,
    { targetType: target.targetType, targetId: target.targetId, reason: reason.trim() },
    await acceptedHistory(log))
}

export interface ProfileFields {
  displayName?: string
  bio?: string
}

/**
 * Profile FIELDS as a versioned replicated operation (roadmap P1): the
 * display name and bio are the actor's last signed statement, not a row on a
 * node. Replication = everyone replaying the log converges to the same
 * answer, because the per-actor resolution (below) is deterministic.
 *
 * Deletion semantics: an EMPTY string is an explicit clear ("remove this
 * field"); an omitted key means "unchanged". There is no op that removes the
 * profile itself — the actor identity cannot be hotter-deleted, its presence
 * is what anchors the ops.
 */
export async function publishProfileUpdate(
  identity: OrbitIdentityLike,
  fields: ProfileFields,
  log: SocialOperationLog,
): Promise<SocialOperation> {
  const payload: Record<string, string> = {}
  if (fields.displayName !== undefined) payload.displayName = fields.displayName.trim()
  if (fields.bio !== undefined) payload.bio = fields.bio
  if (Object.keys(payload).length === 0) throw new Error('profile update must name at least one field')
  return appendSocial(identity, log, 'profile.update', identity.orbitId, payload,
    await acceptedHistory(log))
}

/**
 * Deterministic profile projection (roadmap P1): replay the accepted log and
 * fold, per actor, each profile.update in actorSequence order, carrying
 * forward fields the newer operation did not name. That total order is
 * clock-free (the actor's own chain is unique per sequence in an accepted
 * history — equivocation is refused by the authorizer), so every replica
 * converges to the same fields no matter the arrival order. Two actors can
 * never claim the same profile: each profile is keyed by the actor's own id.
 */
export function projectProfiles(
  entries: readonly { record: unknown }[],
): Map<string, { displayName?: string; bio?: string; operationId: string; actorSequence: number }> {
  const byActor = new Map<string, SocialOperation[]>()
  for (const entry of entries) {
    const record = entry.record as Partial<SocialOperation> | null
    if (!record || typeof record !== 'object' || record.type !== 'profile.update' || typeof record.actorId !== 'string') continue
    const list = byActor.get(record.actorId) ?? []
    list.push(record as SocialOperation)
    byActor.set(record.actorId, list)
  }
  const projected = new Map<string, { displayName?: string; bio?: string; operationId: string; actorSequence: number }>()
  for (const [actorId, ops] of byActor) {
    ops.sort((a, b) => a.actorSequence - b.actorSequence)
    const fields: { displayName?: string; bio?: string } = {}
    for (const op of ops) {
      const payload = op.payload as { displayName?: unknown; bio?: unknown }
      if (typeof payload.displayName === 'string') fields.displayName = payload.displayName
      if (typeof payload.bio === 'string') fields.bio = payload.bio
    }
    const last = ops[ops.length - 1]
    projected.set(actorId, { ...fields, operationId: last.operationId, actorSequence: last.actorSequence })
  }
  return projected
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
  return appendSocial(identity, log, 'comment.create', input.commentId,
    { postId: input.postId, parentCommentId: input.parentCommentId, body: input.body },
    await acceptedHistory(log))
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
  return appendSocial(identity, log, 'comment.delete', target.objectId,
    { targetOperationId: commentOperationId }, history)
}
