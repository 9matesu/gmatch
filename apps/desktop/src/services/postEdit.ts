"use client";

import {
  SOCIAL_PROTOCOL,
  SOCIAL_PROTOCOL_VERSION,
  authorizeValidatedOperation,
  contentManifestHash,
  createSocialOperation,
  type SocialOperation,
} from '@orbit/protocol';
import { orbitFetch, type OrbitIdentityLike } from '../utils/api';
import type { SocialOperationLog } from './socialOperationLog';

/**
 * Editing a post's caption.
 *
 * Two routes, exactly like a like and a comment:
 *  - a NODE post is edited on the node (`PATCH /api/posts/:id`, owner-only);
 *  - a PEER-replicated post has no node row, so the edit is a signed
 *    `post.edit` operation in the durable log, replicated to peers like every
 *    other operation.
 *
 * The decision is a pure function so it can be tested without the shell.
 */
export type PostEditRoute = 'server' | 'peer-operation';

export function postEditRoute(
  post: { origin?: 'server' | 'peer' } | null | undefined,
): PostEditRoute {
  return post?.origin === 'peer' ? 'peer-operation' : 'server';
}

/** The protocol caps a post caption at 2000 chars; the client never sends more. */
export const MAX_POST_CAPTION = 2000;

export interface PostEditResult {
  ok: boolean;
  /** The caption as it now stands (null = cleared). */
  caption?: string | null;
  error?: string;
}

/** Edit the caption of a post that lives on a node. */
export async function editPostCaptionOnNode(
  identity: OrbitIdentityLike,
  postId: string,
  caption: string,
): Promise<PostEditResult> {
  const trimmed = caption.trim();
  if (trimmed.length > MAX_POST_CAPTION) {
    return { ok: false, error: `The caption is too long (max ${MAX_POST_CAPTION} characters).` };
  }
  try {
    const res = await orbitFetch(`/api/posts/${postId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caption: trimmed }),
    }, identity);
    if (res.status === 403) return { ok: false, error: 'Only the author can edit this post.' };
    if (res.status === 404) return { ok: false, error: 'That post is gone.' };
    if (!res.ok) return { ok: false, error: `The edit did not land (${res.status}).` };
    const data = await res.json().catch(() => null);
    const saved = typeof data?.caption === 'string' ? data.caption : trimmed;
    return { ok: true, caption: saved || null };
  } catch {
    return { ok: false, error: 'Could not reach the node. The post was not edited.' };
  }
}

/**
 * The current heads of a post in an accepted operation history: the create
 * plus every edit that no other edit superseded.
 *
 * This mirrors the authorizer's rule exactly (packages/protocol
 * social-operation.ts): an edit must supersede EXACTLY the heads, or the
 * authorizer refuses it. Computing it here keeps the client from guessing.
 */
export function postEditHeads(
  history: readonly SocialOperation[],
  objectId: string,
): SocialOperation[] {
  const related = history.filter(
    (entry) => entry.objectId === objectId && (entry.type === 'post.create' || entry.type === 'post.edit'),
  );
  const superseded = new Set<string>();
  for (const entry of related) {
    if (entry.type !== 'post.edit') continue;
    const supersedes = (entry.payload as { supersedes?: unknown }).supersedes;
    if (!Array.isArray(supersedes)) continue;
    for (const id of supersedes) if (typeof id === 'string') superseded.add(id);
  }
  return related.filter((entry) => !superseded.has(entry.operationId));
}

/**
 * Edit the caption of a peer-replicated post as a signed `post.edit`
 * operation.
 *
 * The manifest is unchanged (the caption is not part of it), so the edit
 * reuses the create's `contentCid` / `mimeType` / `sizeBytes` and the SAME
 * manifest hash — which is what `manifestMatches()` checks on ingest.
 */
export async function editPostCaptionAsOperation(
  identity: OrbitIdentityLike,
  postId: string,
  caption: string,
  log: SocialOperationLog,
): Promise<PostEditResult> {
  const trimmed = caption.trim();
  if (trimmed.length > MAX_POST_CAPTION) {
    return { ok: false, error: `The caption is too long (max ${MAX_POST_CAPTION} characters).` };
  }
  try {
    const entries = await log.listAllOperations();
    const history = entries.map((entry) => entry.record as unknown as SocialOperation);
    const create = history.find((entry) => entry.type === 'post.create' && entry.objectId === postId);
    if (!create) return { ok: false, error: 'That post is not in the local operation log.' };
    if (create.actorId !== identity.orbitId) {
      return { ok: false, error: 'Only the author can edit this post.' };
    }
    const heads = postEditHeads(history, postId);
    if (heads.length === 0) return { ok: false, error: 'That post is not in the local operation log.' };

    const source = create.payload as {
      contentCid?: unknown; manifestHash?: unknown; mimeType?: unknown; sizeBytes?: unknown;
    };
    if (typeof source.contentCid !== 'string' || typeof source.mimeType !== 'string' ||
        typeof source.sizeBytes !== 'number') {
      return { ok: false, error: 'That post has no editable manifest.' };
    }
    const manifest = {
      ownerId: identity.orbitId,
      contentCid: source.contentCid,
      mimeType: source.mimeType,
      sizeBytes: source.sizeBytes,
    };
    const manifestHash = contentManifestHash(manifest);

    const { actorSequence, previousOperationId } = await log.nextActorSlot(identity.orbitId);
    const payload: Record<string, unknown> = {
      supersedes: heads.map((head) => head.operationId),
      contentCid: manifest.contentCid,
      manifestHash,
      mimeType: manifest.mimeType,
      sizeBytes: manifest.sizeBytes,
    };
    // An empty caption is an explicit CLEAR: the payload must still name the
    // field, so it is sent as an empty string (the protocol allows it).
    payload.caption = trimmed;

    const operation = createSocialOperation({
      protocol: SOCIAL_PROTOCOL,
      version: SOCIAL_PROTOCOL_VERSION,
      type: 'post.edit',
      actorId: identity.orbitId,
      signingKey: identity.publicKeyHex,
      actorSequence,
      previousOperationId,
      createdAt: Date.now(),
      objectId: postId,
      payload,
    }, identity.privateKeyHex);

    const error = authorizeValidatedOperation(operation, history, {
      verifiedManifests: new Map([[manifestHash, manifest]]),
      trustedHistory: true,
    });
    if (error) return { ok: false, error };

    const { outcome } = await log.append({
      operationId: operation.operationId,
      actorId: operation.actorId,
      actorSequence: operation.actorSequence,
      createdAt: operation.createdAt,
      record: operation as unknown as Record<string, unknown>,
    });
    if (outcome === 'duplicate') return { ok: false, error: 'That edit was already committed.' };
    return { ok: true, caption: trimmed || null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'The edit could not be committed.' };
  }
}
