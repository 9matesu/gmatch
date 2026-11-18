import type { OrbitObject } from '@orbit/shared'
import { generateFallbackName } from '@orbit/shared'
import { buildMirrorRow } from '../../utils/galleryMirror'
import { recoverDescriptorRow } from '../../utils/objectDescriptor'
import { localObjectBlobUrl } from '../../utils/mediaData'
import { areItemsStructurallyEqual } from '../../utils/compare'
import type { StoredObject } from '../../utils/storage'

/**
 * Gallery merge: the PURE half of `loadGallery()`.
 *
 * `loadGallery` in `App.tsx` used to combine the inbox, IndexedDB, descriptor
 * recovery, local blob URLs, orphan deletion and p2p memory in one closure.
 * Everything that decides what a row IS lives here; the function only decides
 * what to fetch. That makes the legacy-row and orphan paths unit-testable
 * without mounting the app.
 */

/** The IndexedDB shape the gallery reads (`getAllObjects()`). */
export type StoredObjectRow = StoredObject

export interface GalleryMergeInput {
  /** Rows the node listed (inbox). */
  inbox: OrbitObject[]
  /** Rows in IndexedDB (bytes we hold locally). */
  dbObjects: StoredObject[]
  /** Rows held in the swarm (memory). */
  p2pItems: OrbitObject[]
  /** Ids of objects referenced by a card; a `p2p-obj-` row not referenced is an orphan. */
  canonicalCardMediaIds: ReadonlySet<string>
  /** The current identity, to resolve display names. */
  selfId: string | null
  /** The current display name ("You"). */
  selfDisplayName: string
  /** The directory, to resolve a peer's display name. */
  directory: readonly { id: string; display_name?: string | null }[]
}

export interface GalleryMergeResult {
  items: OrbitObject[]
  /** Rows this call decided to delete (orphans). The caller owns the actual delete. */
  orphanIds: string[]
  /** Rows whose legacy descriptor was recovered; the caller persists them. */
  recoveredRows: StoredObject[]
}

function createdMs(row: { created_at?: string | null }): number {
  const t = row.created_at ? Date.parse(row.created_at) : 0
  return Number.isFinite(t) ? t : 0
}

/** Newest first. */
export function sortGalleryRows(rows: OrbitObject[]): OrbitObject[] {
  return [...rows].sort((a, b) => createdMs(b) - createdMs(a))
}

/**
 * Fold the three sources into one list, newest first.
 *
 * Rules kept from the original closure:
 *  - a server (inbox) row wins over a mirror row with the same id;
 *  - a `p2p-obj-` row that no card references is an ORPHAN: reported, not kept;
 *  - a legacy row whose `data` is a URL is a DESCRIPTOR: recovered idempotently
 *    (nothing deleted, bytes left alone) and rendered from the link;
 *  - an explicit `content_url` on a swarm row fills a gap, never overwrites;
 *  - a mirror row's flags are rebuilt through `buildMirrorRow` (server flags
 *    win, explicit mirror flags apply, unknown rows stay flag-less).
 */
export function mergeGalleryRows(input: GalleryMergeInput): GalleryMergeResult {
  const { inbox, dbObjects, p2pItems, canonicalCardMediaIds, selfId, selfDisplayName, directory } = input
  const itemMap = new Map<string, OrbitObject>()
  const orphanIds: string[] = []
  const recoveredRows: StoredObject[] = []

  // 1. Server inbox rows.
  for (const item of inbox) itemMap.set(item.id, item)

  // 2. IndexedDB rows.
  for (const dbObj of dbObjects) {
    if (dbObj.id.startsWith('p2p-obj-') && !canonicalCardMediaIds.has(dbObj.id)) {
      orphanIds.push(dbObj.id)
      continue
    }
    const recovered = recoverDescriptorRow(dbObj as unknown as OrbitObject & { data?: unknown })
    if (recovered.changed) recoveredRows.push(recovered.row as unknown as StoredObject)
    const contentUrl = recovered.descriptorOnly
      ? (recovered.sourceUrl || `/api/objects/${dbObj.id}`)
      : localObjectBlobUrl(dbObj.id, dbObj.data, dbObj.mime_type)
    const prev = itemMap.get(dbObj.id)
    const display = dbObj.owner_id === selfId
      ? (selfDisplayName || 'You')
      : (prev?.display_name
        || directory.find((u) => u.id === dbObj.owner_id)?.display_name?.trim()
        || generateFallbackName(dbObj.owner_id))
    itemMap.set(dbObj.id, buildMirrorRow(dbObj as never, prev, contentUrl, display))
  }

  // 3. Swarm (memory) rows: fill gaps, never overwrite.
  for (const item of p2pItems) {
    const existing = itemMap.get(item.id)
    if (!existing) {
      itemMap.set(item.id, item)
    } else if (item.content_url && !existing.content_url) {
      itemMap.set(item.id, { ...existing, content_url: item.content_url })
    }
  }

  return {
    items: sortGalleryRows(Array.from(itemMap.values())),
    orphanIds,
    recoveredRows,
  }
}

/**
 * The p2p-only merge used when the network read fails: the gallery still shows
 * what the swarm holds instead of going empty.
 */
export function mergeP2pOnly(current: OrbitObject[], incoming: OrbitObject[]): OrbitObject[] {
  const map = new Map<string, OrbitObject>()
  for (const item of current) map.set(item.id, item)
  for (const item of incoming) {
    const existing = map.get(item.id)
    if (!existing) map.set(item.id, item)
    else if (item.content_url && !existing.content_url) map.set(item.id, { ...existing, content_url: item.content_url })
  }
  const merged = sortGalleryRows(Array.from(map.values()))
  return areItemsStructurallyEqual(current, merged) ? current : merged
}