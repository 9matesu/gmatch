/**
 * Permanent media vault vs. the expendable picture cache.
 *
 * The encrypted image LRU is a CACHE: bytes there may be evicted at any time.
 * The vault is PERMANENT: bytes are written once, keyed by content hash, and
 * survive a restart. This module owns the one-time decision — look in the
 * vault FIRST (by the 40/64-hex address inside a legacy urn/magnet, or by the
 * source url), and only fetch+persist when nothing durable holds the bytes.
 * It never uploads, never overwrites bytes already held, and reports a failed
 * write as a failure rather than calling it saved.
 */

import { vaultGet } from '../services/vault'
import { contentRefFromText } from './objectDescriptor'
import { isContentAddress } from './contentAddressedMedia'
import { isMediaVideo } from './media'
import { getObject } from './storage'
import type { GalleryImage } from '../game/types'

export type PermanentMediaResult =
  | {
      state: 'permanent'
      /** Content hash the bytes are addressed by. */
      ref: string
      via: 'vault' | 'idb'
      /** True when the bytes were already held (nothing was fetched). */
      reused: boolean
    }
  | { state: 'failed'; reason: string }

export interface PermanentMediaDeps {
  /** Read-only vault lookup; null means no local copy. */
  probe(key: string): Promise<string | null>
  /** Fetch + verify + write. Called AT MOST once per url per session. */
  persist(
    url: string,
    kind?: 'image' | 'video',
  ): Promise<{
    status: 'local' | 'failed'
    ref?: string
    bytes?: number
    via?: string
    reason?: string
  }>
}

const defaultDeps: PermanentMediaDeps = {
  probe: (key) => vaultGet(key),
  persist: async (url, kind) => {
    const { persistKeepsake } = await import('../services/keepsake')
    return persistKeepsake(url, {}, kind)
  },
}

/** One successful write per url per session — repeat views cost no fetch. */
const settled = new Map<string, PermanentMediaResult>()

function permanent(
  ref: string,
  via: 'vault' | 'idb',
  reused: boolean,
): Extract<PermanentMediaResult, { state: 'permanent' }> {
  return { state: 'permanent', ref, via, reused }
}

function failed(reason: string): PermanentMediaResult {
  return { state: 'failed', reason }
}

function validRef(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const ref = value.trim().toLowerCase()
  return isContentAddress(ref) ? ref : null
}

/**
 * Address this keep already has: a bare 40/64-hex ref, or the id carried by a
 * `urn:sha256:` / `magnet:?xt=urn:btih:` descriptor. A provider URL has no
 * content address and is probed by source url instead.
 */
export function permanentRefFor(raw: string | null | undefined): string | null {
  const value = String(raw || '').trim()
  return contentRefFromText(value) || validRef(value)
}

/** A keep is permanently saved only when it has verified local bytes. */
export function isPermanentlySaved(keep: {
  saveState?: string
  localRef?: string
}): boolean {
  return keep.saveState === 'persisted' && !!keep.localRef
}

/**
 * Ensure one keep's bytes are in the permanent vault. Already-held bytes win
 * over any write: a re-cache or a second view never re-downloads them.
 */
export async function ensurePermanentMedia(
  url: string,
  kind: 'image' | 'video' = 'image',
  deps: Partial<PermanentMediaDeps> = {},
): Promise<PermanentMediaResult> {
  const key = String(url || '').trim()
  if (!key) return failed('no-url')
  const known = settled.get(key)
  if (known) return known
  const d = { ...defaultDeps, ...deps }

  const ref = permanentRefFor(key)
  for (const probeKey of ref ? [ref, key] : [key]) {
    try {
      const local = await d.probe(probeKey)
      // A url-only key has no content address: a local path found under it
      // cannot be stamped as `localRef` (the gallery builds vault://f/<ref>
      // from that and renders a blank tile). Wait for a hash-bearing probe.
      if (ref && local && local !== probeKey) {
        const out = permanent(ref, 'vault', true)
        settled.set(key, out)
        return out
      }
    } catch {
      /* an unreadable/failed probe is not proof of absence: try the next key */
    }
  }

  let res: Awaited<ReturnType<PermanentMediaDeps['persist']>>
  try {
    res = await d.persist(key, kind)
  } catch (err) {
    return failed(err instanceof Error ? err.message : 'persist')
  }
  const savedRef = validRef(res?.ref)
  if (res?.status !== 'local' || !savedRef) {
    return failed(res?.reason || 'not-saved')
  }
  const out = permanent(savedRef, res.via === 'idb' ? 'idb' : 'vault', false)
  settled.set(key, out)
  return out
}

/** Test seam: forget the session's one-time decisions. */
export function _resetPermanentMedia(): void {
  settled.clear()
}

/**
 * An upload is a post / chat attachment, never a card. `forgeMediaLocally`
 * already sealed its bytes into the vault (or the browser's durable object
 * store) under the content hash; this records ONE keepsake for the Vault and
 * the profile media grid so the same bytes are visible in both surfaces.
 *
 * It never mints a card, never re-downloads a bare hash as a provider URL, and
 * never claims a keep when neither durable store can be read back.
 */
export async function rememberUploadedMediaKeep(
  forged: { id: string; contentHash: string; mimeType?: string | null },
  opts: {
    tags?: string[]
    deps?: Partial<PermanentMediaDeps>
  } = {},
): Promise<GalleryImage | null> {
  const ref = String(forged.contentHash || '').trim().toLowerCase()
  if (!isContentAddress(ref)) return null
  const kind = isMediaVideo(forged.mimeType || undefined) ? 'video' : 'image'
  // The upload's bytes are already durable; a bare hash is not fetchable as a
  // URL, so the fallback probe below reads the local store instead of guessing.
  const result = await ensurePermanentMedia(ref, kind, {
    persist: async () => ({ status: 'failed', reason: 'upload-bytes-only' }),
    ...opts.deps,
  })
  let pinned: Extract<PermanentMediaResult, { state: 'permanent' }> | null =
    result.state === 'permanent' ? result : null
  if (!pinned) {
    const hasBridge = typeof window !== 'undefined' && typeof window.gmatch?.vaultGet === 'function'
    if (hasBridge) {
      // A second probe covers a forge whose fire-and-forget vault write landed
      // just after the first lookup. An IndexedDB row here holds only a
      // descriptor, so it is NOT proof of bytes.
      if (await vaultGet(ref).catch(() => null)) pinned = permanent(ref, 'vault', true)
    } else {
      // Browser dev has no vault bridge: IndexedDB holds the real bytes.
      const row = await getObject(ref).catch(() => null)
      if (row?.data) pinned = permanent(ref, 'idb', true)
    }
  }
  if (!pinned) return null

  const keep: GalleryImage = {
    id: `upload:${forged.id}`,
    // A content address is a stable local URL: the Vault resolves it from the
    // verified bytes, unlike a session-only blob: URL.
    url: ref,
    tags: (opts.tags || []).slice(0, 24),
    rarityBase: 0,
    clicks: 0,
    rarity: 'Common',
    boughtAt: Date.now(),
    kind,
    localRef: pinned.ref,
    saveState: 'persisted',
  }
  const { useGame } = await import('../game/store')
  const existing = useGame.getState().gallery.find((g) => g.id === keep.id || g.url === ref)
  if (existing) return existing
  useGame.setState((s) => ({
    gallery: [...s.gallery, keep],
    totalGallerySaved: s.totalGallerySaved + 1,
  }))
  useGame.getState().save()
  return keep
}
