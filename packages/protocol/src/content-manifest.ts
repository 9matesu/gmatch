import { sha256Hex } from './hash'
import { stableStringify } from '@orbit/shared'

/**
 * Content manifest hash (protocol proposal v1).
 *
 * The manifest bound into a `post.create`/`post.edit` operation payload is the
 * minimal claim the operation's authorization checks against:
 *   { ownerId, contentCid, mimeType, sizeBytes }
 * `contentManifestHash` is the canonical, domain-separated digest of that
 * claim. A serving peer or applying host re-derives it from the manifest it
 * verified (author signature + CID of the actual bytes) and compares against
 * `payload.manifestHash` — mismatch means the operation describes different
 * content than the manifest proves and must be rejected.
 *
 * Trust note: the hash alone proves nothing. It only becomes evidence when the
 * verifier has independently checked the manifest's author signature and the
 * content CID against real bytes; the pure operation authorizer takes that
 * verified manifest as caller input for exactly that reason.
 */

export const MANIFEST_DOMAIN = 'gmatch-social|1|manifest|'

export interface ContentManifestClaim {
  ownerId: string
  contentCid: string
  mimeType: string
  sizeBytes: number
}

export function contentManifestHash(claim: ContentManifestClaim): string {
  return sha256Hex(new TextEncoder().encode(MANIFEST_DOMAIN + stableStringify(claim)))
}
