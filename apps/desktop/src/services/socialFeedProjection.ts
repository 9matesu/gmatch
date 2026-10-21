"use client";

import type { SocialOperation } from '@orbit/protocol'
import type { LoggedOperation, OperationLogStatus } from './socialOperationLog'
import { isTagBlocked } from '../game/tagFilter'

/**
 * Feed projection over the durable operation log (roadmap L4.1).
 *
 * The transport (socialOpTransport) accepts signed operations; nothing turned
 * them into something a user could see. This module derives the visible post
 * list from ACCEPTED operations only — pure, deterministic, and independent of
 * the network, so the same log always produces the same feed.
 *
 * Rules (matching the protocol's authorization rules, enforced at accept time):
 * - A post is identified by `objectId` (the content-addressed media object), so
 *   a row that also arrives from a server is the SAME post, not a second one.
 * - An edit supersedes exactly the current heads; the head is therefore the
 *   single create/edit that nothing supersedes. A malformed log that leaves two
 *   heads resolves deterministically (highest actorSequence, then operationId)
 *   instead of rendering twice.
 * - A delete tombstones the post by its create operation id; a tombstoned post
 *   is never projected.
 * - Ordering is createdAt desc with an operationId tiebreak — never a server
 *   clock, and stable across peers.
 * - Remote tags pass the client-side blocklist (SPEC §8) before they enter the
 *   feed or could be re-shared; a blocked tag is dropped, the post itself is
 *   not silently vanished.
 */

export interface ProjectedPost {
  /** Stable post identity: the media objectId (same key server rows use). */
  id: string
  authorId: string
  /** Current head operation (create or latest edit). */
  headOperationId: string
  contentCid: string
  manifestHash: string
  mimeType: string
  sizeBytes: number
  caption: string
  tags: string[]
  createdAt: number
  edited: boolean
  /** Local delivery state of the head operation. */
  status: OperationLogStatus
}

export interface ProjectionOptions {
  /** Defaults to the shared client-side blocklist (tagFilter.isTagBlocked). */
  isBlockedTag?: (tag: string) => boolean
}

function operationOf(entry: LoggedOperation): SocialOperation | null {
  const record = entry.record as Partial<SocialOperation> | null
  if (!record || typeof record !== 'object') return null
  if (typeof record.type !== 'string' || typeof record.operationId !== 'string') return null
  if (!record.payload || typeof record.payload !== 'object') return null
  return record as SocialOperation
}

function supersedes(operation: SocialOperation): string[] {
  const value = (operation.payload as { supersedes?: unknown }).supersedes
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
}

/** Deterministic head choice when a (should-be-impossible) double head exists. */
function newerHead(a: LoggedOperation, b: LoggedOperation): LoggedOperation {
  if (a.actorSequence !== b.actorSequence) return a.actorSequence > b.actorSequence ? a : b
  return a.operationId < b.operationId ? a : b
}

export function projectPosts(
  entries: readonly LoggedOperation[],
  options: ProjectionOptions = {},
): ProjectedPost[] {
  const blocked = options.isBlockedTag ?? isTagBlocked
  const operations = new Map<LoggedOperation, SocialOperation>()
  for (const entry of entries) {
    const operation = operationOf(entry)
    if (operation) operations.set(entry, operation)
  }

  const superseded = new Set<string>()
  const deletedCreateIds = new Set<string>()
  for (const operation of operations.values()) {
    if (operation.type === 'post.edit') {
      for (const id of supersedes(operation)) superseded.add(id)
    } else if (operation.type === 'post.delete') {
      const target = (operation.payload as { targetOperationId?: unknown }).targetOperationId
      if (typeof target === 'string') deletedCreateIds.add(target)
    }
  }

  const creates = [...operations.entries()].filter(([, operation]) => operation.type === 'post.create')
  const projected: ProjectedPost[] = []
  const seenObjects = new Set<string>()

  for (const [createEntry, create] of creates) {
    if (deletedCreateIds.has(create.operationId)) continue
    const objectId = create.objectId
    if (!objectId || seenObjects.has(objectId)) continue
    seenObjects.add(objectId)

    // Heads for this post: the create plus its edits, minus anything a newer
    // edit superseded.
    let head: LoggedOperation = createEntry
    for (const [entry, operation] of operations) {
      if (operation.type !== 'post.edit' || operation.objectId !== objectId) continue
      if (superseded.has(operation.operationId)) continue
      if (entry !== createEntry) head = head === createEntry ? entry : newerHead(head, entry)
    }
    const headOperation = head === createEntry ? create : operations.get(head) as SocialOperation

    const payload = headOperation.payload as {
      contentCid?: unknown
      manifestHash?: unknown
      mimeType?: unknown
      sizeBytes?: unknown
      caption?: unknown
      tags?: unknown
    }
    if (typeof payload.contentCid !== 'string' || typeof payload.mimeType !== 'string') continue
    const rawTags = Array.isArray(payload.tags)
      ? payload.tags.filter((tag): tag is string => typeof tag === 'string')
      : []
    projected.push({
      id: objectId,
      authorId: create.actorId,
      headOperationId: headOperation.operationId,
      contentCid: payload.contentCid,
      manifestHash: typeof payload.manifestHash === 'string' ? payload.manifestHash : '',
      mimeType: payload.mimeType,
      sizeBytes: typeof payload.sizeBytes === 'number' ? payload.sizeBytes : 0,
      caption: typeof payload.caption === 'string' ? payload.caption : '',
      tags: rawTags.filter((tag) => !blocked(tag)),
      createdAt: headOperation.createdAt,
      edited: head !== createEntry,
      status: (head === createEntry ? createEntry : head).status,
    })
  }

  return projected.sort((a, b) =>
    b.createdAt - a.createdAt || (a.headOperationId < b.headOperationId ? -1 : 1),
  )
}
