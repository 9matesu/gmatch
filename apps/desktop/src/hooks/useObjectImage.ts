"use client";

import { useState, useEffect, useRef } from 'react'
import { orbitFetch } from '../utils/api'
import { getLocalObject, requestSwarmObject, PEER_ONLINE_EVENT } from '../utils/p2pSwarm'
import { vaultProbe } from '../services/vault'
import { resolveVideoMime, sniffFileHead } from '../utils/media'
import { isMagnetUri } from '../utils/magnet'

/**
 * Video detection for bytes in hand: trusts a concrete blob/stored MIME, but
 * when both are empty or generic (pre-1.4.7 rows registered as
 * application/octet-stream, typeless swarm blobs) sniffs the magic bytes so
 * video isn't rendered as a broken image.
 */
async function isVideoBlob(blob: Blob, storedMime: string): Promise<boolean> {
  const t = ((blob as Blob).type || storedMime || '').toLowerCase().split(';')[0].trim()
  if (t.startsWith('video/')) return true
  if (t && t !== 'application/octet-stream' && t !== 'binary/octet-stream') return false
  return resolveVideoMime({ type: t, bytes: await sniffFileHead(blob) }) !== null
}

interface IdentityLike {
  orbitId: string
  publicKeyHex: string
  privateKeyHex: string
}

export interface ObjectImageResult {
  url: string | null
  failed: boolean
  isVideo: boolean
  isLink: boolean
  linkUrl: string | null
  /** True when the server confirmed a P2P-only row but no seeder answered.
   *  The tile should read "waiting for poster", not "unavailable" — a peer
   *  coming online (PEER_ONLINE_EVENT) triggers an automatic retry. */
  awaitingSeeder: boolean
}

interface ImageState {
  cardId: string
  url: string
  failed: boolean
  isVideo: boolean
  isLink: boolean
  linkUrl: string | null
}

const EMPTY: ObjectImageResult = { url: null, failed: false, isVideo: false, isLink: false, linkUrl: null, awaitingSeeder: false }

function isProtectedObjectUrl(value: string): boolean {
  return value.startsWith('/api/objects/') || value.includes('/api/objects/')
}

// Bounded LRU cache of previously fetched objects keyed by cardId. Prevents
// repeat downloads/decrypts on every round change (the same card is re-requested
// as my-card, opponent-card and reveal card across rounds), keeping memory bounded.
// Cap 24 slots keeps GPU texture memory and RAM low on long timelines.
const CACHE_MAX = 24
const objectCache = new Map<string, ImageState>()
const cacheSource = new Map<string, string>()

// A mounted consumer's entry must never be evicted-and-revoked out from under
// it: the <img>/<video> keeps pointing at that blob URL and dies the moment it
// is revoked ("Image unavailable" for photos, empty src -> "No preview" for
// videos). Pin while mounted, unpin on unmount; eviction skips pinned keys.
const pinned = new Set<string>()

/** Test-only: clear the module-level media cache + pins so suites that share
 * the module don't pollute each other with stale blob URLs. */
export function __resetObjectImageCacheForTests(): void {
  objectCache.clear()
  cacheSource.clear()
  pinned.clear()
  inflight.clear()
}

function pinKey(cardId: string, source: string): string {
  // Normalize /api/objects/<id> and bare <id> to the same key so lookups,
  // saves, and pins always agree (split callers otherwise unpin/evict
  // entries each other still display).
  return `${source}::${normalizeCardId(cardId)}`
}

export function normalizeCardId(cardId: string): string {
  if (!cardId) return cardId
  if (cardId.startsWith('/api/objects/')) return cardId.slice('/api/objects/'.length).split(/[?#]/)[0]
  return cardId
}

/**
 * Can this value be used as an object id in a request path?
 *
 * `Objects.id` is always a UUID or a short opaque token (`p2p-obj-…`,
 * `story-preload-1`, …). A `magnet:?…` or `urn:sha256:…` descriptor is what the
 * API *returns* for an object, never something you can ask for — and feeding
 * one back as an id is silent data loss: the literal `?` in `magnet:?xt=…`
 * terminates the path, so the browser requests `/api/objects/magnet:` and the
 * node 404s on the truncated id. That 404 then also fired `orbit-object-404`
 * (which tried to delete the story row) and cached a permanent failure that
 * evicted a real entry from the 24-slot LRU.
 *
 * Rejecting is the honest answer rather than encoding: these are not ids.
 */
export function isRequestableObjectId(raw: string | null | undefined): boolean {
  if (!raw) return false
  const id = normalizeCardId(raw.trim())
  if (!id) return false
  if (isMagnetUri(id)) return false
  // No path separators or terminators: a single path segment, nothing that can
  // split the URL. Catches magnets, urns, absolute URLs and file paths at once.
  return !/[/\\?#\s]/.test(id)
}

function cacheGet(rawCardId: string, source: string): ImageState | null {
  const cardId = normalizeCardId(rawCardId)
  const hit = objectCache.get(cardId)
  if (!hit) return null
  if (cacheSource.get(cardId) !== source) return null
  // refresh LRU position
  objectCache.delete(cardId)
  objectCache.set(cardId, hit)
  return hit
}

function cacheSet(rawCardId: string, source: string, img: ImageState): void {
  const cardId = normalizeCardId(rawCardId)
  cacheSource.set(cardId, source)
  objectCache.delete(cardId)
  objectCache.set(cardId, { ...img, cardId })
  // Evict oldest (front) entries beyond the cap, revoking their object URLs to
  // hand memory back to the browser. Skip entries a mounted consumer still
  // renders — revoking one blanks that element. If every entry is pinned we
  // simply let the cache grow past CACHE_MAX; RAM beats a blank screen, and it
  // self-corrects as consumers unmount.
  // ponytail: soft cap while fully pinned; weak-ref map if pressure ever shows.
  while (objectCache.size > CACHE_MAX) {
    const victim = [...objectCache.keys()].find(
      (k) => !pinned.has(pinKey(k, cacheSource.get(k) || '')),
    )
    if (!victim) break
    const evicted = objectCache.get(victim)
    if (evicted?.url) URL.revokeObjectURL(evicted.url)
    objectCache.delete(victim)
    cacheSource.delete(victim)
  }
}

/**
 * In-flight resolution, keyed like the LRU. Two consumers of the same
 * objectId (a feed tile and the post lightbox, or a story ring and the story
 * player) used to race: each issued its own signed fetch, and the loser's
 * object URL was orphaned into leaked RAM. Now the first caller starts the
 * work and the rest await the same promise.
 */
const inflight = new Map<string, Promise<ResolvedObject>>()

interface ResolvedObject {
  state: ImageState
  /** False for transient/seeder-offline states that must NOT poison the LRU. */
  cache: boolean
  /** Server confirmed a P2P-only row but no seeder answered. */
  awaitingSeeder: boolean
}

const FAILED = (cardId: string): ImageState =>
  ({ cardId, url: '', failed: true, isVideo: false, isLink: false, linkUrl: null })

/** Local (P2P/vault/IndexedDB) → signed GET → swarm. Never throws. */
async function resolveObject(cleanId: string, identity: IdentityLike): Promise<ResolvedObject> {
  // A descriptor (magnet/urn/absolute URL) is not an id. Fail without touching
  // the network: no request to 404 on, no orbit-object-404 to delete a live row,
  // and nothing cached to evict a warm entry on the next story.
  if (!isRequestableObjectId(cleanId)) {
    return { state: FAILED(cleanId), cache: false, awaitingSeeder: false }
  }

  const commit = (state: ImageState): ResolvedObject => {
    cacheSet(cleanId, identity.orbitId, state)
    return { state, cache: true, awaitingSeeder: false }
  }

  // P2P first; the network is only touched on a miss.
  // The encrypted vault is local storage too: a row that moved worlds keeps its
  // bytes on disk under the old node URL, so look the object id up there before
  // asking the node (which keeps no media) or a peer (which may not exist).
  try {
    const vault = await vaultProbe(cleanId)
    if (vault.state === 'local' && vault.local) {
      return commit({
        cardId: cleanId,
        url: vault.local,
        failed: false,
        isVideo: /^video\//i.test(vault.mime || ''),
        isLink: false,
        linkUrl: null,
      })
    }
  } catch {
    /* no vault bridge (browser dev) — fall through */
  }

  let localBlob: Blob | null = null
  try {
    localBlob = await getLocalObject(cleanId)
  } catch {
    localBlob = null
  }
  if (localBlob) {
    return commit({
      cardId: cleanId,
      url: URL.createObjectURL(localBlob),
      failed: false,
      isVideo: await isVideoBlob(localBlob, ''),
      isLink: false,
      linkUrl: null,
    })
  }

  let res: Response | null = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      res = await orbitFetch(`/api/objects/${cleanId}`, { method: 'GET' }, identity)
      if (![502, 503, 504].includes(res.status) || attempt === 2) break
    } catch {
      if (attempt === 2) return { state: FAILED(cleanId), cache: false, awaitingSeeder: false }
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)))
  }
  if (!res) return { state: FAILED(cleanId), cache: false, awaitingSeeder: false }

  if (!res.ok) {
    if (res.status === 404) {
      // The metadata row lives on the author's node, not necessarily on ours:
      // a DM attachment is registered only on the sender's world, and a post
      // from another world 404s here too. The bytes can still be seeded by a
      // peer that knows this object id, so ask the swarm before declaring the
      // tile dead (this is the difference between "their image never loads"
      // and a working DM attachment).
      let swarmBlob: Blob | null = null
      try {
        swarmBlob = await requestSwarmObject(cleanId, 5000)
      } catch {
        swarmBlob = null
      }
      if (swarmBlob) {
        try {
          const { registerLocalObject } = await import('../utils/p2pSwarm')
          registerLocalObject(cleanId, swarmBlob)
          void import('../utils/pendingTransfers')
            .then(({ removePendingTransfer }) => removePendingTransfer(cleanId))
            .catch(() => {})
        } catch {
          /* cache alias best-effort */
        }
        return commit({
          cardId: cleanId,
          url: URL.createObjectURL(swarmBlob),
          failed: false,
          isVideo: await isVideoBlob(swarmBlob, ''),
          isLink: false,
          linkUrl: null,
        })
      }
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('orbit-object-404', { detail: { cardId: cleanId } }))
      }
    }
    // 502/503/504 = the node is waking up / restarting. Caching that failure
    // blanks the tile until LRU eviction, so leave it out of the cache.
    return res.status === 502 || res.status === 503 || res.status === 504
      ? { state: FAILED(cleanId), cache: false, awaitingSeeder: false }
      : commit(FAILED(cleanId))
  }

  const contentType = (res.headers.get('Content-Type') || '').toLowerCase()

  if (contentType.includes('json')) {
    const data = await res.json().catch(() => null)
    if (data && data.type === 'p2p') {
      // Zero-media register-only row: bytes live on the swarm, not the server.
      // Resolve order: local store (also keyed by content_hash) -> swarm peers.
      const hash: string | null = typeof data.content_hash === 'string' ? data.content_hash : null
      const mime: string = typeof data.mime_type === 'string' ? data.mime_type : 'application/octet-stream'
      // Same world-less lookup by content hash: new uploads pin bytes under the
      // sha256, and that key survives a DB move even when the id key does not.
      if (hash) {
        try {
          const vault = await vaultProbe(hash)
          if (vault.state === 'local' && vault.local) {
            return commit({
              cardId: cleanId,
              url: vault.local,
              failed: false,
              isVideo: /^video\//i.test(mime),
              isLink: false,
              linkUrl: null,
            })
          }
        } catch {
          /* no vault bridge */
        }
      }
      let blob: Blob | null = null
      try {
        blob = (await getLocalObject(cleanId)) || (hash ? await getLocalObject(hash) : null)
      } catch {
        blob = null
      }
      if (!blob) {
        // Ask the swarm by object id, then by content_hash alias — 5s timeout.
        // expectedHash verifies the reassembled bytes (untrusted peers).
        try {
          blob = await requestSwarmObject(cleanId, 5000, { expectedHash: hash ?? undefined })
        } catch {
          if (!hash) blob = null
          else {
            try {
              blob = await requestSwarmObject(hash, 5000, { expectedHash: hash })
            } catch {
              blob = null
            }
          }
        }
      }
      if (blob) {
        try {
          const { registerLocalObject } = await import('../utils/p2pSwarm')
          registerLocalObject(cleanId, blob)
          if (hash && hash !== cleanId) registerLocalObject(hash, blob)
        } catch {
          /* cache alias best-effort */
        }
        void import('../utils/pendingTransfers')
          .then(({ removePendingTransfer }) => removePendingTransfer(cleanId))
          .catch(() => {})
        return commit({
          cardId: cleanId,
          url: URL.createObjectURL(blob),
          failed: false,
          isVideo: await isVideoBlob(blob, mime),
          isLink: false,
          linkUrl: null,
        })
      }
      // Terminal miss, not an endless "waiting for poster": the vault had no
      // bytes, the node keeps no media and the bounded swarm ask timed out.
      // Failed results are never cached, so an explicit remount (Show/Retry)
      // or an actual PEER_ONLINE_EVENT is the only thing that re-asks.
      // Persist the id (+ content hash) so the diagnostics can list it.
      void import('../utils/pendingTransfers')
        .then(({ enqueuePendingTransfer }) => enqueuePendingTransfer(cleanId, hash))
        .catch(() => {})
      return { state: FAILED(cleanId), cache: false, awaitingSeeder: false }
    }
    return commit({
      cardId: cleanId,
      url: '',
      failed: false,
      isVideo: false,
      isLink: true,
      linkUrl: typeof data?.url === 'string' ? data.url : null,
    })
  }

  const blob = await res.blob()
  return commit({
    cardId: cleanId,
    url: URL.createObjectURL(blob),
    failed: false,
    isVideo: await isVideoBlob(blob, contentType),
    isLink: false,
    linkUrl: null,
  })
}

/** Dedupe entry point: concurrent callers share one resolution. */
function resolveObjectOnce(cleanId: string, identity: IdentityLike): Promise<ResolvedObject> {
  const key = pinKey(cleanId, identity.orbitId)
  const running = inflight.get(key)
  if (running) return running
  const p = resolveObject(cleanId, identity).finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

/**
 * Warm the cache for an object the user is about to see (next story in the
 * tray, next feed tile). Uses the exact same resolution + LRU path as a real
 * mount, so a prefetched object costs zero extra work when it renders. Safe to
 * call repeatedly and for objects already cached.
 */
export function prefetchObject(cardId: string | null, identity: IdentityLike | null): void {
  if (!cardId || !identity) return
  if (isDirectUrlLike(cardId)) return
  if (!isRequestableObjectId(cardId)) return
  const cleanId = normalizeCardId(cardId)
  if (!cleanId || cacheGet(cleanId, identity.orbitId)) return
  void resolveObjectOnce(cleanId, identity).catch(() => { /* prefetch is best-effort */ })
}

function isDirectUrlLike(cardId: string): boolean {
  return cardId.startsWith('data:') ||
    cardId.startsWith('blob:') ||
    ((cardId.startsWith('http://') || cardId.startsWith('https://')) && !isProtectedObjectUrl(cardId)) ||
    (cardId.startsWith('/api/') && !cardId.startsWith('/api/objects/'))
}

/**
 * Fetch an object from the API and expose it as a revokable object URL.
 *
 * - The prior image stays visible while the next one loads (no placeholder
 *   flash between rounds).
 * - Results are cached by cardId (LRU, capped) so repeat views of the same
 *   card do not re-download/re-decrypt the payload.
 */
export function useObjectImage(
  cardId: string | null,
  identity: IdentityLike | null,
  options?: { enabled?: boolean }
): ObjectImageResult {
  const enabled = options?.enabled !== false
  // If cardId is already a direct URL (http, https, data, blob, or static endpoint)
  const isDirectUrl = Boolean(cardId && isDirectUrlLike(cardId))

  const [img, setImg] = useState<ImageState | null>(() => {
    if (!cardId) return null
    if (isDirectUrl) {
      return {
        cardId,
        url: cardId,
        failed: false,
        isVideo: cardId.includes('.mp4') || cardId.includes('.webm') || cardId.includes('video/'),
        isLink: false,
        linkUrl: null,
      }
    }
    return cacheGet(cardId, identity?.orbitId || '')
  })

  // Retry wave for offline seeders: a failed P2P tile re-resolves when any
  // peer comes online (PEER_ONLINE_EVENT from useP2P). Stale closures are
  // avoided via imgRef — the listener only bumps the nonce while failed.
  const [retryNonce, setRetryNonce] = useState(0)
  const imgRef = useRef(img)
  imgRef.current = img
  const awaitingSeederRef = useRef(false)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onPeerOnline = () => {
      const cur = imgRef.current
      if (cur && cur.failed) setRetryNonce((n) => n + 1)
    }
    window.addEventListener(PEER_ONLINE_EVENT, onPeerOnline)
    return () => window.removeEventListener(PEER_ONLINE_EVENT, onPeerOnline)
  }, [])

  useEffect(() => {
    if (!cardId) return
    awaitingSeederRef.current = false

    if (isDirectUrl) {
      setImg({
        cardId,
        url: cardId,
        failed: false,
        isVideo: cardId.includes('.mp4') || cardId.includes('.webm') || cardId.includes('video/'),
        isLink: false,
        linkUrl: null,
      })
      return
    }

    if (!identity) return

    // Viewport/deferred gating: when disabled, do not issue the authenticated
    // fetch yet. The component will flip `enabled` once the element scrolls
    // near the viewport, at which point this effect re-runs and fetches.
    if (!enabled) return

    // Clean any accidental /api/objects/ prefix (normalized key story below)
    const cleanId = normalizeCardId(cardId)

    // A seeder retry must not adopt a poisoned failure entry cached by an
    // earlier attempt — evict so this wave fetches honestly.
    if (retryNonce > 0) {
      objectCache.delete(cleanId)
      cacheSource.delete(cleanId)
    }

    // Adopt a cached entry immediately if present
    if (cacheGet(cleanId, identity.orbitId)) return

    let cancelled = false

    // Shared, deduped resolution: concurrent consumers of the same object id
    // await one fetch instead of racing (and orphaning blob URLs). The result
    // is committed to the LRU inside resolveObject, so a cancelled consumer
    // leaves a warm entry behind rather than a leak.
    void resolveObjectOnce(cleanId, identity).then(({ state, awaitingSeeder }) => {
      if (cancelled) return
      awaitingSeederRef.current = awaitingSeeder
      setImg(state)
    }).catch(() => {
      if (!cancelled) setImg(FAILED(cleanId))
    })
    return () => { cancelled = true }
  }, [cardId, identity, enabled, retryNonce])

  // Hold a pin for as long as this consumer is mounted, so the LRU can never
  // revoke the URL we are currently rendering.
  useEffect(() => {
    if (!cardId || !identity) return
    const k = pinKey(cardId, identity.orbitId)
    pinned.add(k)
    return () => { pinned.delete(k) }
  }, [cardId, identity])

  const normalized = normalizeCardId(cardId || '')
  if (!img || img.cardId !== normalized) {
    const cached = cardId && identity ? cacheGet(normalized, identity.orbitId) : null
    if (!cached) return EMPTY
    return { ...cached, url: cached.url || null, awaitingSeeder: false }
  }
  // Keep the displayed card fresh in the LRU so eviction never reclaims it
  // while it is on screen.
  if (cardId && identity) cacheGet(normalized, identity.orbitId)
  return {
    url: img.url || null,
    failed: img.failed,
    isVideo: img.isVideo,
    isLink: img.isLink,
    linkUrl: img.linkUrl,
    awaitingSeeder: awaitingSeederRef.current && img.failed,
  }
}
