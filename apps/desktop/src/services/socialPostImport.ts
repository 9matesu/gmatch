"use client";

import type { OrbitIdentityLike } from '../utils/api'
import { orbitFetch } from '../utils/api'
import { getLocalObject, registerLocalObject, sha256HexBlob } from '../utils/p2pSwarm'
import { isPostDeleted } from '../utils/deletedPosts'
import { projectPosts } from './socialFeedProjection'
import { publishSignedPostOperation, shouldEmitSocialOperation } from './socialPublish'
import type { SocialOperationLog } from './socialOperationLog'

/**
 * Import the player's OWN existing public posts into the signed operation log
 * (roadmap L4 — "old data remains visible/importable").
 *
 * A post published before the local-first path existed lives only as a NODE
 * row plus bytes on this machine (or in the node's blob store). Peers cannot
 * address it, because addressing happens through a signed `post.create` whose
 * manifest carries the sha256 of the bytes. This turns each such post into
 * exactly that operation, and seeds the bytes locally under both the object id
 * and the content hash first — so once the operation travels, a peer can fetch
 * the media from this machine rather than from a node.
 *
 * Rules (each one is a test):
 * - **Own public feed posts only.** Same gate as a fresh publish
 *   (`shouldEmitSocialOperation`): stories, avatars, chats and private rows are
 *   never re-published.
 * - **Idempotent by object id.** A post already in the log is skipped, so
 *   running it twice is harmless (and two runs cannot fork an actor chain).
 * - **Bytes or nothing.** A post whose bytes are neither local nor readable
 *   from this node is skipped: an operation with no servable media would show
 *   peers an empty frame.
 * - **The hash is verified, never assumed.** When the node row declares a
 *   `content_hash`, the bytes must hash to it; otherwise the bytes are refused
 *   and the post is skipped as a mismatch. When there is no declared hash, the
 *   computed one becomes the address (that is what the bytes ARE).
 * - **Additive only.** Nothing is deleted, rewritten or re-uploaded, and a
 *   tombstoned post is never resurrected.
 * - **Opt-in.** Nothing calls this at boot; re-publishing old content to peers
 *   is the player's explicit decision (Settings → Preferences).
 */

/** One row as the node describes it (already own-scoped by the query). */
export interface ImportablePost {
  id: string
  contentHash?: string | null
  mimeType?: string | null
  sizeBytes?: number | null
  caption?: string | null
  tags?: string | null
  isPublic?: boolean
  isStory?: boolean
  isAvatar?: boolean
  isChat?: boolean
}

export type ImportSkipReason =
  | 'not-public'
  | 'deleted'
  | 'already'
  | 'no-bytes'
  | 'hash-mismatch'
  | 'invalid'

export interface ImportSummary {
  /** operationIds committed to the log by this run. */
  imported: string[]
  /** Posts deliberately left alone, with the reason. */
  skipped: Array<{ id: string; reason: ImportSkipReason }>
  /** Local seeds written (bytes registered under id + content hash). */
  bytesSeeded: number
}

export interface ImportOwnPostsDeps {
  /** This player's own posts, newest first (the node scopes by author id). */
  listOwnPosts(limit: number): Promise<ImportablePost[]>
  /** Bytes already on this machine (vault/IndexedDB swarm store). */
  readLocal(id: string): Promise<Blob | null>
  /** Signed read of the node's copy, when the node still holds the bytes. */
  fetchFromNode(id: string): Promise<Blob | null>
  /** sha256 of bytes, lowercase hex. */
  hash(blob: Blob): Promise<string>
  /** Register verified bytes so this machine can serve them over the swarm. */
  seed(id: string, blob: Blob): void
  /** A tombstone outranks an import: never resurrect a deleted post. */
  isDeleted?(id: string): boolean
}

export interface ImportOwnPostsOptions {
  /** Candidates per run; bounded so one click cannot become a stampede. */
  limit?: number
  /** Test seam: replace one or more leaf operations. */
  deps?: Partial<ImportOwnPostsDeps>
}

export const MAX_IMPORT_PER_RUN = 100

const SHA256_HEX = /^[0-9a-f]{64}$/i
/** An object id must be a single path segment (never a descriptor/URL). */
const SAFE_OBJECT_ID = /^[A-Za-z0-9_-]{1,128}$/

function toImportable(row: Record<string, unknown>): ImportablePost {
  const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)
  const bool = (v: unknown): boolean => v === true || v === 1
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  return {
    id: String(row.id ?? ''),
    contentHash: str(row.content_hash),
    mimeType: str(row.mime_type),
    sizeBytes: num(row.size_bytes),
    caption: str(row.post_caption) ?? str(row.caption),
    tags: str(row.tags),
    // The serializer omits the flag for a normal public post.
    isPublic: row.is_public === undefined ? true : bool(row.is_public),
    isStory: bool(row.is_story),
    isAvatar: bool(row.is_avatar),
    isChat: bool(row.is_chat),
  }
}

function defaultDeps(identity: OrbitIdentityLike): ImportOwnPostsDeps {
  return {
    async listOwnPosts(limit) {
      const res = await orbitFetch(
        `/api/posts?author_id=${encodeURIComponent(identity.orbitId)}&limit=${limit}&sort=latest`,
        {},
        identity,
      )
      if (!res.ok) return []
      const data = await res.json().catch(() => null)
      const rows = Array.isArray(data?.posts) ? data.posts : []
      return rows
        .filter((row: unknown): row is Record<string, unknown> => !!row && typeof row === 'object')
        .map(toImportable)
    },
    readLocal: (id) => getLocalObject(id),
    async fetchFromNode(id) {
      try {
        const res = await orbitFetch(`/api/objects/${encodeURIComponent(id)}`, {}, identity)
        if (!res.ok) return null
        // A row the node does not hold answers with a `p2p` DESCRIPTOR
        // (JSON), not bytes. Reading that as media would import the
        // descriptor text as a picture, so it is refused here.
        const type = (res.headers.get('content-type') || '').toLowerCase()
        if (type.includes('application/json')) return null
        const blob = await res.blob()
        return blob.size > 0 ? blob : null
      } catch {
        return null
      }
    },
    hash: (blob) => sha256HexBlob(blob),
    seed: (id, blob) => registerLocalObject(id, blob),
    isDeleted: (id) => isPostDeleted(id),
  }
}

/**
 * Commit one signed `post.create` per importable post. Returns what happened,
 * never throwing for a single bad row: one unreadable post must not abort the
 * rest of the player's history.
 */
export async function importOwnPosts(
  identity: OrbitIdentityLike,
  log: SocialOperationLog,
  options: ImportOwnPostsOptions = {},
): Promise<ImportSummary> {
  const deps: ImportOwnPostsDeps = { ...defaultDeps(identity), ...options.deps }
  const limit = Math.max(1, Math.min(options.limit ?? MAX_IMPORT_PER_RUN, MAX_IMPORT_PER_RUN))
  const summary: ImportSummary = { imported: [], skipped: [], bytesSeeded: 0 }

  let candidates: ImportablePost[]
  try {
    candidates = await deps.listOwnPosts(limit)
  } catch {
    return summary
  }

  // What the log already carries (including tombstones, so a deleted post is
  // not re-created by an import either).
  const known = new Set<string>()
  try {
    for (const post of projectPosts(await log.listAllOperations())) known.add(post.id)
  } catch {
    /* an unreadable log imports nothing new today; publish will refuse forks */
  }

  for (const candidate of candidates) {
    const id = candidate.id
    const skip = (reason: ImportSkipReason) => summary.skipped.push({ id, reason })

    if (!SAFE_OBJECT_ID.test(id)) { skip('invalid'); continue }
    if (!shouldEmitSocialOperation({
      isPublic: candidate.isPublic,
      isStory: candidate.isStory,
      isAvatar: candidate.isAvatar,
      isChat: candidate.isChat,
      durable: true,
    })) { skip('not-public'); continue }
    // A tombstone outranks an import, and a storage hiccup must not abort the
    // whole run: treat an unreadable tombstone index as "not deleted".
    let tombstoned = false
    try {
      tombstoned = !!deps.isDeleted?.(id)
    } catch {
      tombstoned = false
    }
    if (tombstoned) { skip('deleted'); continue }
    if (known.has(id)) { skip('already'); continue }

    let bytes: Blob | null = null
    try {
      bytes = await deps.readLocal(id)
    } catch {
      bytes = null
    }
    if (!bytes) {
      try {
        bytes = await deps.fetchFromNode(id)
      } catch {
        bytes = null
      }
    }
    if (!bytes || bytes.size === 0) { skip('no-bytes'); continue }

    let hash: string
    try {
      hash = (await deps.hash(bytes)).toLowerCase()
    } catch {
      skip('invalid')
      continue
    }
    if (!SHA256_HEX.test(hash)) { skip('invalid'); continue }

    const declared = candidate.contentHash
    // A declared address that the bytes do not match means these are NOT the
    // bytes the original post described. Refuse them; never re-address them.
    if (declared && SHA256_HEX.test(declared) && declared.toLowerCase() !== hash) {
      skip('hash-mismatch')
      continue
    }

    // Seed BEFORE publishing: an operation a peer can receive but whose media
    // nobody serves would show them an empty frame.
    try {
      deps.seed(id, bytes)
      deps.seed(hash, bytes)
      summary.bytesSeeded += 1
    } catch {
      /* seeding is best-effort; the local vault copy still resolves for us */
    }

    try {
      const operation = await publishSignedPostOperation(identity, {
        objectId: id,
        contentCid: hash,
        mimeType: candidate.mimeType || bytes.type || 'application/octet-stream',
        sizeBytes: bytes.size,
        caption: candidate.caption ?? undefined,
        tags: candidate.tags ?? undefined,
      }, log)
      summary.imported.push(operation.operationId)
      known.add(id)
    } catch (error) {
      // "post already created" is the race against a concurrent run, not a
      // failure; everything else is reported as invalid so the caller can say
      // how many rows were left behind.
      const message = error instanceof Error ? error.message : ''
      skip(/already created/i.test(message) ? 'already' : 'invalid')
    }
  }

  return summary
}