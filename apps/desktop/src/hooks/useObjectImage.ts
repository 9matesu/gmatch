"use client";

import { useState, useEffect, useRef } from 'react'
import { orbitFetch } from '../utils/api'
import { getLocalObject, registerLocalObject, requestSwarmObject, PEER_ONLINE_EVENT, hasSwarmPeers } from '../utils/p2pSwarm'
import { vaultProbe } from '../services/vault'
import { resolveVideoMime, sniffFileHead } from '../utils/media'
import { normalizeObjectId, isRequestableObjectId, parseObjectRef } from '../utils/objectRef'
import { contentHashFromRef, isContentAddress, resolveContentAddressedMedia } from '../utils/contentAddressedMedia'
import { countMetric, timeMetric } from '../utils/metrics'

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
  /**
   * A definitive "no bytes anywhere" miss. Unlike a transient failure it does
   * NOT expire on a timer: replaying the same 5s swarm ask on every re-render
   * is exactly the "unavailable images load forever" symptom. Only a real
   * PEER_ONLINE_EVENT evicts it and re-resolves.
   */
  terminal?: boolean
  /** The content hash the terminal miss was judged against ('' for legacy). */
  terminalKey?: string
}

const EMPTY: ObjectImageResult = { url: null, failed: false, isVideo: false, isLink: false, linkUrl: null, awaitingSeeder: false }

/**
 * A bounded "bytes may have arrived" signal for a foreground reconcile (feed
 * refresh + pending-transfer resume). Distinct from PEER_ONLINE_EVENT: a peer
 * coming online is not the only reason a previously missing picture can now
 * resolve — a resumed swarm transfer or a node coming back can do it too.
 */
export const MEDIA_RETRY_EVENT = 'gmatch-media-retry'

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
/**
 * A failed resolution is cached for a SHORT time only. A definitive-looking
 * failure (404 with no seeder, a bad payload) used to sit in the LRU forever,
 * so a post whose bytes arrived later — or whose node came back — still showed
 * "No preview" until LRU eviction. After this window the tile retries once.
 */
const failedAt = new Map<string, number>()
const FAILED_TTL_MS = 30_000

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
  failedAt.clear()
  pinned.clear()
  inflight.clear()
  objectFetchQueue.length = 0
  activeObjectFetches = 0
}

function pinKey(cardId: string, source: string): string {
  // Normalize /api/objects/<id> and bare <id> to the same key so lookups,
  // saves, and pins always agree (split callers otherwise unpin/evict
  // entries each other still display).
  return `${source}::${normalizeCardId(cardId)}`
}

/**
 * Can this value be used as an object id in a request path?
 *
 * The rule lives in `utils/objectRef.ts` (ONE parser for every media
 * reference in the app). This stays as a re-export because the hook's public
 * surface is used by several components and tests.
 */
export { isRequestableObjectId };

/** Strip the `/api/objects/` mount so the bare id remains. */
export function normalizeCardId(cardId: string): string {
  return normalizeObjectId(cardId);
}

function cacheGet(rawCardId: string, source: string): ImageState | null {
  const cardId = normalizeCardId(rawCardId)
  const hit = objectCache.get(cardId)
  if (!hit) return null
  if (cacheSource.get(cardId) !== source) return null
  // Terminal misses stay cached until a peer comes online; the short TTL is
  // only for transient failures (a 404 that may be a waking node, a 5xx).
  if (hit.failed && !hit.terminal) {
    const at = failedAt.get(cardId) ?? 0
    if (Date.now() - at > FAILED_TTL_MS) {
      // Expired failure: drop it so the consumer re-resolves (the node may be
      // back, or a seeder may have arrived).
      countMetric('media.reload', cardId)
      objectCache.delete(cardId)
      cacheSource.delete(cardId)
      failedAt.delete(cardId)
      return null
    }
  }
  // refresh LRU position
  objectCache.delete(cardId)
  objectCache.set(cardId, hit)
  return hit
}

function cacheSet(rawCardId: string, source: string, img: ImageState): void {
  const cardId = normalizeCardId(rawCardId)
  cacheSource.set(cardId, source)
  if (img.failed) failedAt.set(cardId, Date.now())
  else failedAt.delete(cardId)
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
    countMetric('media.evict', `objectImage:${victim}`)
    objectCache.delete(victim)
    cacheSource.delete(victim)
    failedAt.delete(victim)
  }
}

/** Drop a specific object from the LRU and revoke its blob URL if present. */
export function evictObjectImage(rawCardId: string): void {
  const cardId = normalizeCardId(rawCardId)
  const hit = objectCache.get(cardId)
  if (!hit) return
  if (hit.url && hit.url.startsWith('blob:')) URL.revokeObjectURL(hit.url)
  countMetric('media.evict', `objectImage:${cardId}`)
  objectCache.delete(cardId)
  cacheSource.delete(cardId)
  failedAt.delete(cardId)
}

/**
 * The one read path for a cached image. A terminal miss is keyed by the hash
 * it was judged against: a row first seen without a content hash and later
 * re-rendered WITH one must not inherit the earlier "no bytes" verdict.
 */
function cachedFor(cardId: string, identity: IdentityLike, contentHash: string | null): ImageState | null {
  const cached = cacheGet(cardId, identity.orbitId)
  if (cached?.terminal && (cached.terminalKey || '') !== (contentHash || '')) return null
  return cached
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

const FAILED = (cardId: string, terminal = false, terminalKey = ''): ImageState =>
  ({ cardId, url: '', failed: true, isVideo: false, isLink: false, linkUrl: null, terminal, terminalKey })

/**
 * At most N signed object streams in flight at once.
 *
 * Chromium opens six connections per host. A grid that mounts dozens of tiles
 * (a profile with its posts, saved, likes and gallery) used to start a signed
 * GET for every one of them at the same time, and media keeps the long 120s
 * budget — so all six sockets sat on media and every other call (feed, lobby,
 * notifications, DELETE) queued behind them and died on its own 8s timeout.
 * The UI read that as "nothing loads and nothing deletes". Media is a
 * background job: give it a small budget and let the rest of the app breathe.
 */
const MAX_CONCURRENT_OBJECT_FETCHES = 3
let activeObjectFetches = 0
const objectFetchQueue: Array<() => void> = []

function withObjectFetchSlot<T>(run: (release: () => void) => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let released = false
    const release = () => {
      if (released) return
      released = true
      activeObjectFetches -= 1
      const next = objectFetchQueue.shift()
      if (next) next()
    }
    const start = () => {
      activeObjectFetches += 1
      run(release).then(
        (value) => { release(); resolve(value) },
        (err) => { release(); reject(err) },
      )
    }
    if (activeObjectFetches < MAX_CONCURRENT_OBJECT_FETCHES) start()
    else objectFetchQueue.push(start)
  })
}

/** Local (P2P/vault/IndexedDB) → signed GET → swarm. Never throws.
 *  One timing envelope around the whole ladder, so a stuck resolution is
 *  visible in the debug surface instead of looking like a hung tile. */
async function resolveObject(
  cleanId: string,
  identity: IdentityLike,
  contentHash?: string | null,
): Promise<ResolvedObject> {
  const started = Date.now()
  try {
    return await resolveObjectInner(cleanId, identity, contentHash)
  } finally {
    timeMetric('media.resolve', Date.now() - started, cleanId)
  }
}

async function resolveObjectInner(
  cleanId: string,
  identity: IdentityLike,
  contentHash?: string | null,
): Promise<ResolvedObject> {
  // A descriptor (magnet/urn/absolute URL) is not a node id. A magnet still
  // addresses bytes we may hold: its btih IS the content hash (legacy rows),
  // so resolve it LOCALLY and never fire a request with the descriptor as a
  // path (that 404s on the literal "?" and poisons the LRU).
  const parsed = parseObjectRef(cleanId)
  const localOnly = !isRequestableObjectId(cleanId)
  const lookupId = localOnly ? (parsed.kind === 'magnet' ? parsed.id : null) : cleanId
  if (!lookupId && !isContentAddress(contentHash)) {
    return { state: FAILED(cleanId), cache: false, awaitingSeeder: false }
  }

  const commit = (state: ImageState): ResolvedObject => {
    cacheSet(cleanId, identity.orbitId, state)
    return { state, cache: true, awaitingSeeder: false }
  }

  // A terminal miss is cached (the short failure TTL does NOT apply): a view
  // switch or a re-render must not restart the bounded swarm ask for bytes
  // nobody holds. PEER_ONLINE_EVENT evicts it, which is the only honest reason
  // to believe the answer could have changed.
  const terminalMiss = (): ResolvedObject => commit(FAILED(cleanId, true, contentHash || ''))

  // A row that names its own CONTENT (a peer-replicated post carries the
  // sha256 of its bytes) is resolved from that content: bytes held locally,
  // then the swarm with the hash attached, so nothing unverified is ever
  // rendered. The node's object route is deliberately not consulted — the row
  // addresses content, and media lives with the peers (SPEC §12b). A row with
  // no content hash keeps the entire legacy ladder below, unchanged.
  if (isContentAddress(contentHash)) {
    const expected = contentHash.toLowerCase()
    const blob = await resolveContentAddressedMedia(lookupId ?? null, expected, {
      // A seeder that is offline now can answer after a reboot or a peer comes
      // online: remember the address so the bounded resume wave re-asks instead
      // of leaving this row permanently failed after one 5 s timeout.
      onMiss: (id, hash) => {
        void import('../utils/pendingTransfers')
          .then(({ enqueuePendingTransfer }) => enqueuePendingTransfer(id, hash))
          .catch(() => {})
      },
    })
    if (!blob) return terminalMiss()
    // Cache the bytes under BOTH names the row may be asked for: the object id
    // alias (a remount by url is instant) and the content hash (the durable key
    // peers address). The resolver proved the hash, so neither registration
    // claims more than was verified.
    try {
      registerLocalObject(cleanId, blob)
      if (expected !== normalizeCardId(cleanId)) registerLocalObject(expected, blob)
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
      isVideo: await isVideoBlob(blob, ''),
      isLink: false,
      linkUrl: null,
    })
  }

  // No content hash: the legacy ladder needs a requestable id (a descriptor
  // with no id inside it has nothing to ask anyone for).
  if (!lookupId) return { state: FAILED(cleanId), cache: false, awaitingSeeder: false }

  // P2P first; the network is only touched on a miss.
  // The encrypted vault is local storage too: a row that moved worlds keeps its
  // bytes on disk under the old node URL, so look the object id up there before
  // asking the node (which keeps no media) or a peer (which may not exist).
  try {
    const vault = await vaultProbe(lookupId)
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
    localBlob = await getLocalObject(lookupId)
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

  // A descriptor has no node path: the local stores were the only honest shot.
  // Its btih can still be seeded later by a peer, so remember this as a terminal
  // miss rather than re-parsing/re-asking on every re-render.
  if (localOnly) return terminalMiss()

  // The signed object stream is the only long-held request in the app: run a
  // bounded number of them at a time (see MAX_CONCURRENT_OBJECT_FETCHES).
  return withObjectFetchSlot((release) =>
    resolveObjectNetwork(cleanId, identity, commit, terminalMiss, release))
}

/**
 * The network half of a resolution: the signed GET, the p2p descriptor / link
 * handling and the swarm fallback. Everything local already happened in
 * resolveObject; this is the part that must never monopolise the pool.
 */
async function resolveObjectNetwork(
  cleanId: string,
  identity: IdentityLike,
  commit: (state: ImageState) => ResolvedObject,
  terminalMiss: () => ResolvedObject,
  release: () => void,
): Promise<ResolvedObject> {
  const started = Date.now()
  try {
    return await resolveObjectNetworkInner(cleanId, identity, commit, terminalMiss, release)
  } finally {
    timeMetric('media.network', Date.now() - started, cleanId)
  }
}

async function resolveObjectNetworkInner(
  cleanId: string,
  identity: IdentityLike,
  commit: (state: ImageState) => ResolvedObject,
  terminalMiss: () => ResolvedObject,
  release: () => void,
): Promise<ResolvedObject> {
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
      countMetric('http.404', cleanId)
      // The metadata row lives on the author's node, not necessarily on ours:
      // a DM attachment is registered only on the sender's world, and a post
      // from another world 404s here too. The bytes can still be seeded by a
      // peer that knows this object id, so ask the swarm before declaring the
      // tile dead (this is the difference between "their image never loads"
      // and a working DM attachment).
      // The signed HTTP stream is done; free the pool slot BEFORE the swarm ask
      // (WebRTC/relay, not the node's socket pool) so live rows are not starved.
      release()
      let swarmBlob: Blob | null = null
      if (hasSwarmPeers()) {
        try {
          swarmBlob = await requestSwarmObject(cleanId, 5000)
        } catch {
          swarmBlob = null
        }
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
    // Body read: free the slot before any swarm fallback.
    release()
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
      if (!blob && hasSwarmPeers()) {
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
      // Persist the id (+ content hash) so the diagnostics can list it.
      void import('../utils/pendingTransfers')
        .then(({ enqueuePendingTransfer }) => enqueuePendingTransfer(cleanId, hash))
        .catch(() => {})
      // Cached as TERMINAL: a view switch or a re-render must not re-run the
      // 5s swarm ask for bytes nobody has. Only PEER_ONLINE_EVENT evicts it.
      return terminalMiss()
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
  release()
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
function resolveObjectOnce(
  cleanId: string,
  identity: IdentityLike,
  contentHash?: string | null,
): Promise<ResolvedObject> {
  const key = pinKey(cleanId, identity.orbitId)
  const running = inflight.get(key)
  if (running) return running
  // One miss = one resolution, even when many tiles share the promise.
  countMetric('media.miss', cleanId)
  const p = resolveObject(cleanId, identity, contentHash).finally(() => inflight.delete(key))
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
  options?: {
    enabled?: boolean
    /**
     * The sha256 of this row's bytes, when the caller knows it (a
     * peer-replicated post carries it in the signed operation manifest). With
     * a hash the row resolves from its CONTENT — local verified bytes, then
     * the swarm with the hash attached — and never asks the node for media.
     * Without one, the legacy ladder is unchanged.
     */
    contentHash?: string | null
  }
): ObjectImageResult {
  const enabled = options?.enabled !== false
  // A caller that hands us a hash-bearing ref (`urn:sha256:`, magnet btih, a
  // bare digest) should NOT also have to pass contentHash: the address is IN
  // the ref. Deriving it here is the root-cause fix for every media surface —
  // without it a hash-bearing descriptor hit the legacy ladder and asked
  // nobody for the bytes, even when a peer was seeding them.
  const contentHash =
    (isContentAddress(options?.contentHash) ? options!.contentHash!.toLowerCase() : null) ??
    contentHashFromRef(cardId) ??
    null
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
    return identity ? cachedFor(cardId, identity, contentHash) : cacheGet(cardId, '')
  })

  // Retry wave for offline seeders: a failed P2P tile re-resolves when any
  // peer comes online (PEER_ONLINE_EVENT from useP2P). Stale closures are
  // avoided via imgRef — the listener only bumps the nonce while failed.
  const [retryNonce, setRetryNonce] = useState(0)
  const imgRef = useRef(img)
  imgRef.current = img
  const awaitingSeederRef = useRef(false)
  // The exact inputs this hook instance resolved for. A resolved object must
  // never be re-parsed or re-fetched just because the caller re-rendered with
  // an equivalent (but freshly allocated) identity/options object.
  const resolvedKeyRef = useRef<string | null>(null)
  const retrySeenRef = useRef(0)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onPeerOnline = () => {
      const cur = imgRef.current
      if (cur && cur.failed) setRetryNonce((n) => n + 1)
    }
    window.addEventListener(PEER_ONLINE_EVENT, onPeerOnline)
    window.addEventListener(MEDIA_RETRY_EVENT, onPeerOnline)
    return () => {
      window.removeEventListener(PEER_ONLINE_EVENT, onPeerOnline)
      window.removeEventListener(MEDIA_RETRY_EVENT, onPeerOnline)
    }
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

    const resolvedKey = `${identity.orbitId}|${cleanId}|${contentHash || ''}`

    // A resolved object stays resolved across re-renders: the inputs that
    // could change the answer are all in this key (and in the effect deps).
    if (
      resolvedKeyRef.current === resolvedKey &&
      imgRef.current?.cardId === cleanId &&
      imgRef.current?.url
    ) return

    // A seeder retry must not adopt a poisoned failure entry cached by an
    // earlier attempt — evict so this wave fetches honestly. A terminal miss
    // survives every OTHER re-render, which is the whole point of caching it.
    if (retryNonce > 0) {
      if (retrySeenRef.current !== retryNonce) {
        countMetric('media.reload', cleanId)
        retrySeenRef.current = retryNonce
      }
      evictObjectImage(cleanId)
    }

    // Adopt a cached entry immediately if present.
    //
    // This used to `return` on a cache hit WITHOUT setting state, so a warm
    // object only rendered on the FIRST mount (where the useState initialiser
    // reads the cache). Change the cardId on a mounted consumer — a feed tile
    // recycled by the window, a story tray advance — and `img` still pointed
    // at the previous id, the `img.cardId !== normalized` branch below fell
    // through to EMPTY, and the tile sat on "Loading media..." until an
    // unrelated retry. Adopting the value is the whole point of the cache.
    const cached = cachedFor(cleanId, identity, contentHash)
    if (cached) {
      countMetric('media.hit', cleanId)
      if (!cached.failed) resolvedKeyRef.current = resolvedKey
      setImg(cached)
      return
    }

    let cancelled = false

    // Shared, deduped resolution: concurrent consumers of the same object id
    // await one fetch instead of racing (and orphaning blob URLs). The result
    // is committed to the LRU inside resolveObject, so a cancelled consumer
    // leaves a warm entry behind rather than a leak.
    void resolveObjectOnce(cleanId, identity, contentHash).then(({ state, awaitingSeeder }) => {
      if (cancelled) return
      awaitingSeederRef.current = awaitingSeeder
      if (!state.failed) resolvedKeyRef.current = resolvedKey
      setImg(state)
    }).catch(() => {
      if (!cancelled) setImg(FAILED(cleanId))
    })
    return () => { cancelled = true }
    // `identity?.orbitId` (a string), not the identity object: an unstable
    // object from a caller re-ran this effect on every render, and each run
    // re-asked the vault over IPC. The id is all the cache key needs.
  }, [cardId, identity?.orbitId, enabled, retryNonce, contentHash])

  // Hold a pin for as long as this consumer is mounted, so the LRU can never
  // revoke the URL we are currently rendering. Keyed by the ID, not the object:
  // a caller that rebuilds `identity` on every render must not unpin/repin the
  // live URL (an eviction in that window reloads the image under the user).
  useEffect(() => {
    if (!cardId || !identity) return
    const k = pinKey(cardId, identity.orbitId)
    pinned.add(k)
    return () => { pinned.delete(k) }
  }, [cardId, identity?.orbitId])

  const normalized = normalizeCardId(cardId || '')
  if (!img || img.cardId !== normalized) {
    const cached = cardId && identity ? cachedFor(normalized, identity, contentHash) : null
    if (!cached) return EMPTY
    return { ...cached, url: cached.url || null, awaitingSeeder: false }
  }
  // Keep the displayed card fresh in the LRU so eviction never reclaims it
  // while it is on screen.
  if (cardId && identity) cachedFor(normalized, identity, contentHash)
  return {
    url: img.url || null,
    failed: img.failed,
    isVideo: img.isVideo,
    isLink: img.isLink,
    linkUrl: img.linkUrl,
    awaitingSeeder: awaitingSeederRef.current && img.failed,
  }
}
