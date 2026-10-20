"use client";

import { normalizeTagShape } from '@orbit/shared'
import {
  authorizeSocialOperation,
  contentManifestHash,
  createSocialOperation,
  type SocialOperation,
} from '@orbit/protocol'
import type { OrbitIdentityLike } from '../utils/api'
import type { SocialOperationLog } from './socialOperationLog'

/**
 * Signed social-operation publish adapter (roadmap L1 slice 3).
 *
 * Takes an already-forged local media object (bytes are persisted by the
 * swarm/vault path before this runs) and commits a signed `post.create`
 * operation into the DURABLE operation log — before any network call, with
 * the actor's sequence chained onto the log's retained head.
 *
 * Status (honest): until the v1 proposal is accepted and a peer transport
 * exists (roadmap L4), this append is additive local bookkeeping. The
 * legacy localStorage outbox remains the product's delivery path; the
 * operation stays `committed` and never claims remote replication.
 */

/** Gate mirrored from mediaForge: public feed posts on the durable path. */
export function shouldEmitSocialOperation(options: {
  isPublic?: boolean
  isStory?: boolean
  isAvatar?: boolean
  isChat?: boolean
  durable?: boolean
}): boolean {
  return (options.isPublic ?? true) && !options.isStory && !options.isAvatar &&
    !options.isChat && options.durable === true
}

export interface SocialPostPublishInput {
  objectId: string
  contentCid: string
  mimeType: string
  sizeBytes: number
  caption?: string
  /** Raw comma-separated tags (same string the legacy register path stores). */
  tags?: string
}

export async function publishSignedPostOperation(
  identity: OrbitIdentityLike,
  input: SocialPostPublishInput,
  log: SocialOperationLog,
): Promise<SocialOperation> {
  const manifest = {
    ownerId: identity.orbitId,
    contentCid: input.contentCid,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
  }
  const manifestHash = contentManifestHash(manifest)
  const tags = input.tags ? normalizeTagShape([input.tags]) : []
  const { actorSequence, previousOperationId } = await log.nextActorSlot(identity.orbitId)
  const payload: Record<string, unknown> = {
    contentCid: input.contentCid,
    manifestHash,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
  }
  if (input.caption) payload.caption = input.caption
  if (tags.length > 0) payload.tags = tags

  const operation = createSocialOperation({
    protocol: 'gmatch-social',
    version: 1,
    type: 'post.create',
    actorId: identity.orbitId,
    signingKey: identity.publicKeyHex,
    actorSequence,
    previousOperationId,
    createdAt: Date.now(),
    objectId: input.objectId,
    payload,
  }, identity.privateKeyHex)

  // Self-authorization: our own manifest is author-produced here (the bytes
  // were content-addressed by the forge step), and our own log supplies the
  // actor's retained history. Any inconsistency (duplicate objectId, chain
  // fork, payload drift) refuses the publish instead of writing it.
  // (History entries carry the signed operation in `record` — the log's own
  // bookkeeping fields must not leak into the protocol view.)
  const history = (await log.listOperationsByActor(identity.orbitId))
    .map((entry) => entry.record as unknown as SocialOperation)
  const error = authorizeSocialOperation(operation, history, {
    verifiedManifests: new Map([[manifestHash, manifest]]),
  })
  if (error) throw new Error(error)

  const { outcome } = await log.append({
    operationId: operation.operationId,
    actorId: operation.actorId,
    actorSequence: operation.actorSequence,
    createdAt: operation.createdAt,
    record: operation as unknown as Record<string, unknown>,
  })
  if (outcome === 'duplicate') throw new Error('operation already committed to the durable log')
  return operation
}
