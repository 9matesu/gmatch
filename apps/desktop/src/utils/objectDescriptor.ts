/**
 * Descriptor rows: keeping a provider LINK separate from media BYTES.
 *
 * A swarm announcement carries a `content_url` (an http(s) URL, a `gmcache://`
 * vault address, or `/api/objects/<id>`). Older builds "saved" that by encoding
 * the URL string into the object's `data` field, so an IndexedDB row claimed to
 * hold media bytes while actually holding text. Everything downstream then
 * treated it as media: a blob URL of the URL string, a hash that never matches
 * the object id, a broken tile.
 *
 * This module is the single decision point for that shape:
 *
 *  - `mediaFlag` — one 3-valued normalisation (`1` / `0` / `null`) used by both
 *    the send and the receive path, which used to drift (one mapped `false` to
 *    `0`, the other wrote `null`, losing an explicit "private").
 *  - `descriptorUrlFromBytes` — is this ArrayBuffer a link, not bytes?
 *  - `recoverDescriptorRow` — idempotent, NON-destructive recovery of a legacy
 *    row: the row is kept (never deleted, never re-imported), it simply stops
 *    being treated as binary content and keeps the URL it was already carrying.
 *  - `resolveClaimedOwner` — the swarm envelope proves the SENDER; `owner_id` is
 *    only a claim and must never be allowed to impersonate a third party.
 */

/** Normalised media-kind flag: 1 = yes, 0 = explicit no, null = unknown. */
export type MediaFlag = 1 | 0 | null

/** Accepts every spelling seen on the wire and in IndexedDB. */
export function mediaFlag(v: unknown): MediaFlag {
  if (v === 1 || v === true || v === '1' || v === 'true') return 1
  if (v === 0 || v === false || v === '0' || v === 'false') return 0
  return null
}

/** A link is short; anything larger is content, whatever it decodes to. */
const DESCRIPTOR_MAX_BYTES = 4096

const DESCRIPTOR_URL_RE = /^(https?:\/\/|gmcache:\/\/|\/api\/objects\/)\S+$/i

/**
 * The provider URL a legacy row stored in place of media bytes, else null.
 * Decoding is strict UTF-8 and the whole payload must look like one URL, so
 * real media (binary) can never be mistaken for a descriptor.
 */
export function descriptorUrlFromBytes(data: unknown): string | null {
  if (typeof ArrayBuffer === 'undefined' || !(data instanceof ArrayBuffer)) return null
  if (data.byteLength === 0 || data.byteLength > DESCRIPTOR_MAX_BYTES) return null
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(data))
  } catch {
    return null
  }
  const trimmed = text.trim()
  if (!trimmed || /\s/.test(trimmed)) return null
  return DESCRIPTOR_URL_RE.test(trimmed) ? trimmed : null
}

export interface DescriptorRecovery<T> {
  /** The row to use from here on (a copy only when it actually changed). */
  row: T
  /** True when this row holds a link, not bytes. */
  descriptorOnly: boolean
  /** The provider URL to render this row from, when it is a descriptor. */
  sourceUrl: string | null
  /** True when `row` differs from the input (i.e. a legacy row was recovered). */
  changed: boolean
}

/**
 * Recover a row idempotently: a legacy descriptor gains `source_url` and is
 * flagged, an already-recovered row is returned untouched, and a real media row
 * passes through unchanged. Never deletes bytes and never re-imports.
 */
export function recoverDescriptorRow<T extends { data?: unknown; content_url?: unknown; source_url?: unknown }>(
  row: T,
): DescriptorRecovery<T> {
  const fromBytes = descriptorUrlFromBytes(row.data)
  if (!fromBytes) {
    const url = typeof row.content_url === 'string' && row.content_url ? row.content_url : null
    return { row, descriptorOnly: false, sourceUrl: url, changed: false }
  }
  const existing = typeof row.source_url === 'string' && row.source_url ? row.source_url : null
  const sourceUrl = existing || fromBytes
  if (existing) return { row, descriptorOnly: true, sourceUrl, changed: false }
  return { row: { ...row, source_url: sourceUrl }, descriptorOnly: true, sourceUrl, changed: true }
}

export interface OwnerClaim {
  owner_id: string
  /** False when the claimed owner contradicts the (proven) sender. */
  owner_verified: boolean
}

/**
 * Decide who a received object may be attributed to.
 *
 * `senderId` is proven by the swarm envelope; `claimedOwnerId` is payload text.
 * A sender may legitimately relay someone else's object, so a mismatch is not
 * rejected outright — it is recorded as UNVERIFIED, which keeps the attribution
 * out of the "render this under that user's name and avatar" path.
 */
export function resolveClaimedOwner(claimedOwnerId: unknown, senderId: unknown): OwnerClaim {
  const sender = typeof senderId === 'string' ? senderId.trim() : ''
  const claimed = typeof claimedOwnerId === 'string' ? claimedOwnerId.trim() : ''
  if (!claimed) return { owner_id: sender, owner_verified: !!sender }
  if (!sender) return { owner_id: claimed, owner_verified: false }
  return { owner_id: claimed, owner_verified: claimed === sender }
}
