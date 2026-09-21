import type { OrbitObject } from "@orbit/shared";

/** A locally mirrored (IndexedDB) object row. Flag fields are present only
 * when the writer knew them (forge time / receive time); absent otherwise. */
export interface MirrorStoredRow {
  id: string
  owner_id: string
  size_bytes: number
  mime_type: string
  created_at: string
  sender_pubkey: string
  sender_enc_pubkey: string
  is_public?: number | null
  is_story?: number | null
  is_chat?: number | null
  is_avatar?: number | null
}

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
    display_name: displayName,
    sender_pubkey: dbObj.sender_pubkey,
    sender_enc_pubkey: dbObj.sender_enc_pubkey,
  } as OrbitObject
  for (const flag of FLAG_KEYS) {
    const v = dbObj[flag]
    if (typeof v !== 'undefined' && v !== null) {
      ;(row as unknown as Record<string, unknown>)[flag] = v ? 1 : 0
    }
  }
  return row
}
