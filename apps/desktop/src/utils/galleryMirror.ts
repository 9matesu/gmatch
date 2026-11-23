import type { OrbitObject } from "@orbit/shared";
import type { StoredObject } from "./storage";

/**
 * A locally mirrored (IndexedDB) object row, as `buildMirrorRow` needs it.
 *
 * This is `StoredObject` minus the byte-level fields: the projection reads
 * metadata only, and the mirror row is exactly what the gallery keeps after a
 * restart. Deriving it (rather than re-listing the fields) means a new stored
 * field reaches the projection automatically instead of silently missing here.
 */
export type MirrorStoredRow = Pick<
  StoredObject,
  | "id"
  | "owner_id"
  | "size_bytes"
  | "mime_type"
  | "created_at"
  | "sender_pubkey"
  | "sender_enc_pubkey"
  | "is_public"
  | "is_story"
  | "is_chat"
  | "is_avatar"
  | "caption"
  | "post_caption"
  | "tags"
  | "location"
  | "author_name"
  | "author_avatar"
  | "comments"
  | "likes_count"
  | "like_count"
  | "comment_count"
>;

const FLAG_KEYS = ['is_public', 'is_story', 'is_chat', 'is_avatar'] as const

/**
 * Rebuild a gallery item from a locally mirrored row.
 *
 * Server-known flags are never fabricated: flags from the server item
 * (inbox) with the same id win by default, explicit flags stored on the
 * mirror row apply on top, and a row known by neither stays flag-less so
 * card surfaces exclude it instead of phantom-minting it.
 */
export function buildMirrorRow(
  dbObj: MirrorStoredRow,
  prev: OrbitObject | undefined,
  contentUrl: string,
  displayName: string,
): OrbitObject {
  const row = {
    ...(prev ?? {}),
    id: dbObj.id,
    owner_id: dbObj.owner_id || prev?.owner_id || '',
    size_bytes: dbObj.size_bytes,
    mime_type: dbObj.mime_type,
    created_at: dbObj.created_at,
    content_url: contentUrl,
    display_name: dbObj.author_name || prev?.display_name || displayName,
    sender_pubkey: dbObj.sender_pubkey,
    sender_enc_pubkey: dbObj.sender_enc_pubkey,
    caption: dbObj.caption || dbObj.post_caption || prev?.caption || '',
    ...(dbObj.tags ? { tags: dbObj.tags } : {}),
    ...(dbObj.location ? { location: dbObj.location } : {}),
    ...(dbObj.author_name ? { author_name: dbObj.author_name } : {}),
    ...(dbObj.author_avatar ? { author_avatar: dbObj.author_avatar } : {}),
    ...(dbObj.comments ? { comments: dbObj.comments } : {}),
    ...(typeof dbObj.likes_count === 'number' || typeof dbObj.like_count === 'number'
      ? { likes_count: dbObj.likes_count ?? dbObj.like_count ?? 0, like_count: dbObj.like_count ?? dbObj.likes_count ?? 0 }
      : {}),
    ...(typeof dbObj.comment_count === 'number' ? { comment_count: dbObj.comment_count } : {}),
  } as OrbitObject
  for (const flag of FLAG_KEYS) {
    const v = dbObj[flag]
    if (typeof v !== 'undefined' && v !== null) {
      ;(row as unknown as Record<string, unknown>)[flag] = v ? 1 : 0
    }
  }
  return row
}