"use client";

import {
  authorizeSocialOperation,
  contentManifestHash,
  validateSocialOperation,
  type SocialOperation,
} from '@orbit/protocol'
import type { SocialOperationLog } from './socialOperationLog'

/**
 * Social-operation transport (roadmap L4 seed).
 *
 * Carries signed v1 operations between peers over the existing swarm frame
 * channel. Everything here treats the transport as untrusted: an inbound
 * operation is re-validated (shape, signature, actor identity), its manifest
 * claim must be self-consistent (the claim derivable from the payload must
 * hash to payload.manifestHash — byte availability is proven separately, when
 * someone fetches the object by contentCid with expectedHash), and it must
 * authorize against the local log's retained history before it is appended
 * durably. Rejection is always silent-and-idempotent: the sender retries on
 * its next broadcast wave, and a duplicate is a no-op everywhere.
 *
 * Status honesty: broadcast is fire-and-forget, so it only advances an entry
 * to 'sending' — NEVER 'delivered', which stays reserved for proof-backed
 * confirmation (a future operation ack, mirroring the object receipts).
 */

export type InboundOperationOutcome = 'accepted' | 'duplicate' | 'rejected'

/** Peer acknowledgement that an operation was durably appended (L4.3). */
export interface OperationAck {
  operationId: string
  actorId: string
}

const HEX64 = /^[0-9a-f]{64}$/

export function validateOperationAck(value: unknown): OperationAck | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const ack = value as Record<string, unknown>
  if (typeof ack.operationId !== 'string' || !HEX64.test(ack.operationId)) return null
  if (typeof ack.actorId !== 'string' || !HEX64.test(ack.actorId)) return null
  return { operationId: ack.operationId, actorId: ack.actorId }
}

/**
 * Apply a peer's ack: the operation exists locally, its actor matches, and it
 * advances to 'delivered'.
 *
 * Honest scope: this is a connected peer REPORTING a durable append, not a
 * signed proof that the bytes will still be there tomorrow. It is deliberately
 * weaker than the media replication receipt (L2), where the attestation is
 * signed and challenge-bound. Unknown ids, actor mismatches, and downgrades are
 * refused so a stray or forged frame cannot mark our work delivered.
 */
export async function applyOperationAck(log: SocialOperationLog, value: unknown): Promise<boolean> {
  const ack = validateOperationAck(value)
  if (!ack) return false
  const entry = await log.getEntry(ack.operationId)
  if (!entry) return false
  if (entry.actorId !== ack.actorId) return false
  return log.advanceStatus(ack.operationId, 'delivered')
}

export async function acceptInboundOperation(
  log: SocialOperationLog,
  value: unknown,
): Promise<InboundOperationOutcome> {
  if (validateSocialOperation(value)) return 'rejected'
  const operation = value as SocialOperation

  // Authoritative dedupe first: a re-delivery of something we already hold is
  // a no-op, not a rejection (the authorizer would flag it as conflicting).
  if (await log.hasOperation(operation.operationId)) return 'duplicate'

  // Manifest self-consistency: the claim must be derivable from the payload
  // and hash to the claimed manifest hash. This proves payload integrity,
  // NOT that the bytes exist — the swarm fetch with expectedHash=contentCid
  // proves availability when someone actually pulls the media.
  const verifiedManifests = new Map<string, { ownerId: string; contentCid: string; mimeType: string; sizeBytes: number }>()
  if (operation.type === 'post.create' || operation.type === 'post.edit') {
    const claim = {
      ownerId: operation.actorId,
      contentCid: operation.payload.contentCid as string,
      mimeType: operation.payload.mimeType as string,
      sizeBytes: operation.payload.sizeBytes as number,
    }
    const hash = contentManifestHash(claim)
    if (hash !== operation.payload.manifestHash) return 'rejected'
    verifiedManifests.set(hash, claim)
  }

  const history = (await log.listOperationsByActor(operation.actorId))
    .map((entry) => entry.record as unknown as SocialOperation)
  if (authorizeSocialOperation(operation, history, { verifiedManifests })) return 'rejected'

  try {
    const { outcome } = await log.append({
      operationId: operation.operationId,
      actorId: operation.actorId,
      actorSequence: operation.actorSequence,
      createdAt: operation.createdAt,
      record: operation as unknown as Record<string, unknown>,
    })
    return outcome === 'appended' ? 'accepted' : 'duplicate'
  } catch {
    return 'rejected'
  }
}

/**
 * Hand every pending operation to the network. Fire-and-forget: entries move
 * to 'sending' (stuck there until proof-backed acks exist); the broadcast is
 * retried on every boot and peer-online wave, which is also how peers that
 * were offline eventually receive older operations.
 */
export async function broadcastPendingOperations(
  log: SocialOperationLog,
  sendOperation: (operation: Record<string, unknown>) => void,
): Promise<{ sent: number }> {
  const pending = await log.listPendingOperations()
  for (const entry of pending) {
    try {
      sendOperation(entry.record)
      await log.advanceStatus(entry.operationId, 'sending')
      await log.bumpAttempts(entry.operationId)
    } catch {
      /* transport hiccup: retried on the next wave */
    }
  }
  return { sent: pending.length }
}
