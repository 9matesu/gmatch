"use client";

import type { OrbitIdentityLike } from '../utils/api'
import type { SocialOperationLog } from './socialOperationLog'
import { publishSignedPostOperation } from './socialPublish'

/**
 * Import of the user's EXISTING local posts into the operation log
 * (roadmap L4/L5 migration).
 *
 * Without this, the local-first feed starts empty: posts the user made before
 * the operation log existed are never replicable. The import turns the
 * user's own public posts into `post.create` operations, one per post.
 *
 * Guardrails, all of them deliberate:
 * - **Own posts only.** Someone else's content is never re-published by us.
 * - **Idempotent by objectId.** A post that already has a `post.create` in the
 *   log is skipped, so running the import twice adds nothing (operation ids
 *   are sequence-bound and would otherwise differ every run).
 * - **Capped.** A bounded number of posts per run; the rest is picked up by
 *   a later run (the importer is incremental, not a one-shot migration).
 * - **Additive only.** It writes operations; it never touches the post, its
 *   bytes, or the vault. Operations are prunable, so this is reversible.
 * - **Opt-in.** Re-publishing old content to peers is a visible decision, so
 *   the caller decides when to run this — never silently at boot.
 */

/** The shape the importer needs from a local object row. */
export interface ImportablePost {
  id: string
  owner_id?: string | null
  content_hash?: string | null
  mime_type?: string | null
  size_bytes?: number | null
  caption?: string | null
  tags?: string[] | null
  is_public?: number | boolean | null
}

export const DEFAULT_IMPORT_LIMIT = 50

const HEX64 = /^[0-9a-f]{64}$/

/** objectIds that already have a post.create in the log. */
export async function importedObjectIds(log: SocialOperationLog): Promise<Set<string>> {
  const entries = await log.listAllOperations()
  const ids = new Set<string>()
  for (const entry of entries) {
    const record = entry.record as { type?: string; objectId?: string }
    if (record?.type === 'post.create' && typeof record.objectId === 'string') ids.add(record.objectId)
  }
  return ids
}

/**
 * Which local posts may be imported: own, public, with a content hash (the
 * operation's content CID) and a known size — and not already imported.
 */
export function selectImportCandidates(
  objects: readonly ImportablePost[],
  options: { selfId: string; alreadyImported?: ReadonlySet<string>; limit?: number },
): ImportablePost[] {
  const limit = options.limit ?? DEFAULT_IMPORT_LIMIT
  const out: ImportablePost[] = []
  for (const object of objects) {
    if (out.length >= limit) break
    if (!object?.id) continue
    if (object.owner_id && object.owner_id !== options.selfId) continue
    const isPublic = object.is_public === 1 || object.is_public === true
    if (!isPublic) continue
    if (!object.content_hash || !HEX64.test(object.content_hash)) continue
    if (!object.mime_type) continue
    if (!object.size_bytes || object.size_bytes < 1) continue
    if (options.alreadyImported?.has(object.id)) continue
    out.push(object)
  }
  return out
}

export interface ImportSummary {
  imported: number
  skipped: number
  failed: number
  /** Why a post was refused (the first few), so the UI can say something. */
  errors: string[]
}

/**
 * Import the selected posts as signed operations. A failure on one post never
 * stops the others: the summary says what happened.
 */
export async function importLocalPosts(
  identity: OrbitIdentityLike,
  candidates: readonly ImportablePost[],
  log: SocialOperationLog,
  options: { limit?: number } = {},
): Promise<ImportSummary> {
  const summary: ImportSummary = { imported: 0, skipped: 0, failed: 0, errors: [] }
  const already = await importedObjectIds(log)
  for (const object of candidates) {
    if (already.has(object.id)) {
      summary.skipped += 1
      continue
    }
    try {
      await publishSignedPostOperation(identity, {
        objectId: object.id,
        contentCid: object.content_hash as string,
        mimeType: object.mime_type as string,
        sizeBytes: object.size_bytes as number,
        caption: object.caption ?? undefined,
        tags: (object.tags ?? []).join(', '),
      }, log)
      already.add(object.id)
      summary.imported += 1
    } catch (error) {
      summary.failed += 1
      if (summary.errors.length < 5) {
        summary.errors.push(`${object.id}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    if (options.limit && summary.imported >= options.limit) break
  }
  return summary
}
