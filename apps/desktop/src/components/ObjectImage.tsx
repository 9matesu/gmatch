"use client";

import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { isMediaVideo, resolveMediaUrl } from '../utils/media'
import { resolveObjectRefId } from '../utils/objectRef'
import { isContentHash } from '../utils/contentAddressedMedia'
import { useObjectImage, evictObjectImage } from '../hooks/useObjectImage'
import { NativeVideoPlayer } from './media/NativeVideoPlayer'
import { useVaultLookup, useVaultHttpUrls, vaultOptIn } from '../services/vault'
import { resolveImage, devFetchable, cachedImageFor } from '../services/imageCache'
import { thumbUrl } from '../utils/thumb'
import { useMediaThumb } from '../hooks/useMediaThumb'

interface IdentityLike {
  orbitId: string
  publicKeyHex: string
  privateKeyHex: string
}

export interface ObjectImageProps {
  /** Direct renderable URL (data:, blob:, http(s):, /api/lobby/...) or a relative /api/objects/ path. */
  contentUrl?: string | null
  /** Object id, used for signed fetch when contentUrl points at the auth-protected object stream. */
  objectId?: string | null
  identity: IdentityLike | null
  /** Explicit media MIME type — authoritative for video detection when the URL has no extension. */
  mimeType?: string | null
  alt?: string
  className?: string
  videoClassName?: string
  /** Hug the media's own aspect ratio — no letterbox bars (see NativeVideoPlayer). */
  natural?: boolean
  loading?: 'lazy' | 'eager'
  fetchPriority?: 'high' | 'low' | 'auto'
  muted?: boolean
  autoPlay?: boolean
  loop?: boolean
  controls?: boolean
  alwaysShowControls?: boolean
  playsInline?: boolean
  preload?: 'auto' | 'metadata' | 'none'
  onExpand?: () => void
  onDoubleTapLike?: () => void
  onError?: () => void
  /** Invoked when media cannot be loaded / is unavailable */
  onMediaUnavailable?: () => void
  /** When true, hides the element cleanly on missing/failed media instead of placeholder box */
  hideUnavailable?: boolean
  /** Invoked when media successfully finishes loading */
  onLoad?: () => void
  /** Grid only: the rendered media's natural size, so a tile with no http URL
   *  (vault/magnet/p2p) can still be measured for the justified layout. */
  onLoadSize?: (w: number, h: number) => void
  /** Invoked whenever loading state changes */
  onLoadingChange?: (loading: boolean) => void
  /**
   * How long to wait for a signed object before declaring it unavailable.
   * Default 6s. Timeboxed surfaces (a 5s story) pass less, otherwise a dead
   * story keeps the stage spinning for longer than the story itself lasts.
   */
  unavailableTimeoutMs?: number
  /**
   * Dense-grid mode: render a BOUNDED thumbnail instead of decoding the
   * full-size original. The clicker's disk cache already has a native
   * thumbnailer (`gmcache://thumb/<key>`); `blob:` / `vault://` / loopback
   * media get a renderer-generated one (`utils/mediaThumb.ts`). The opened
   * post, the viewer and the single foe never pass this — they want the real
   * picture.
   */
  thumb?: boolean
  /**
   * The sha256 of this row's bytes, when the caller knows it. A
   * peer-replicated post carries it in its signed operation manifest; with it
   * the media resolves from its CONTENT (local verified bytes, then the swarm
   * with the hash attached) and the node's object route is never asked. The
   * feed tile and the shared post sheet pass it through from the feed row.
   */
  contentHash?: string | null
}

/** Default strict-availability budget for unbounded surfaces. */
const DEFAULT_UNAVAILABLE_TIMEOUT_MS = 6000
/** Absolute ceiling for a signed fetch still in flight: after this the tile
 *  gives up ("No preview") instead of loading forever behind the 3-slot pool. */
const HARD_UNAVAILABLE_CAP_MS = 30_000

const OBJECT_PATH = '/api/objects/'

// A bare object id (uuid) is never a URL. resolveMediaUrl maps it to
// /api/objects/<id> for <img>, but that request carries no auth headers and
// 401s for anything not public. The signed fetch path must own it instead.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function extractObjectId(contentUrl: string | null | undefined, objectId: string | null | undefined): string | null {
  if (!contentUrl) return objectId || null
  // A `urn:sha256:<…>` descriptor carries the canonical object id INSIDE it:
  // that id is what the node stores the bytes under, so the signed fetch
  // addresses the node's local copy. The raw urn is NOT an id — useObjectImage
  // rejects it. ONE parser owns that rule (utils/objectRef.ts).
  const idx = contentUrl.indexOf(OBJECT_PATH);
  if (idx >= 0) return contentUrl.slice(idx + OBJECT_PATH.length).split(/[?#]/)[0] || null
  const trimmed = contentUrl.trim()
  if (UUID_RE.test(trimmed)) return trimmed
  const urnId = resolveObjectRefId(trimmed);
  if (urnId) return urnId
  return objectId || null
}

function needsSignedFetch(contentUrl: string | null | undefined, objectId: string | null | undefined): boolean {
  if (contentUrl) {
    const trimmed = contentUrl.trim()
    // Privileged local schemes render directly — never route them through the
    // signed /api/objects fetch, even when an objectId/postId is also set
    // (legacy vault:// repost rows carry both; signing them 404s and blanks
    // every surface). vault:// is resolved to localhost http below.
    if (/^(vault|gmcache|idle-file):/i.test(trimmed)) return false
    // Zero-media register rows: bytes live on the swarm. Resolve them through
    // the signed fetch path (which handles the p2p JSON descriptor) instead
    // of handing a magnet:/urn: URL to <img>.
    if (trimmed.startsWith('magnet:') || trimmed.startsWith('urn:sha256:')) return true
    if (contentUrl.startsWith(OBJECT_PATH) || contentUrl.includes(OBJECT_PATH)) {
      const id = extractObjectId(contentUrl, objectId)
      return Boolean(id && !id.startsWith('p2p-'))
    }
    if (UUID_RE.test(contentUrl.trim())) {
      return Boolean(objectId ? !objectId.startsWith('p2p-') : true)
    }
    if (contentUrl.startsWith('data:') || contentUrl.startsWith('http://') || contentUrl.startsWith('https://')) {
      return false
    }
    // Stale `blob:` or local `file:`/`about:` content cannot be rendered
    // directly — fall back to the signed object stream when we have an id.
    if (objectId && !objectId.startsWith('p2p-')) {
      return true
    }
    return false
  }
  return Boolean(objectId && !objectId.startsWith('p2p-'))
}

/**
 * Renders media (image or video) that may live behind the auth-protected
 * `/api/objects/:id` stream. Raw `<img src="/api/objects/:id">` cannot carry the
 * signed request headers, so object-backed content is fetched via the signed
 * `useObjectImage` hook and rendered from a blob URL. Direct URLs (data:, blob:,
 * http(s):, lobby endpoints) render straight through `resolveMediaUrl`.
 */
export function ObjectImage({
  contentUrl,
  objectId,
  identity,
  mimeType,
  alt = '',
  className = '',
  videoClassName = '',
  natural = false,
  loading = 'lazy',
  fetchPriority = 'auto',
  muted = true,
  autoPlay = false,
  loop = false,
  controls = false,
  alwaysShowControls = false,
  playsInline = true,
  preload = 'metadata',
  onExpand,
  onDoubleTapLike,
  onError,
  onMediaUnavailable,
  hideUnavailable = false,
  onLoad,
  onLoadSize,
  onLoadingChange,
  unavailableTimeoutMs = DEFAULT_UNAVAILABLE_TIMEOUT_MS,
  thumb = false,
  contentHash = null,
}: ObjectImageProps) {
  const signed = needsSignedFetch(contentUrl, objectId)
  const effObjectId = extractObjectId(contentUrl, objectId)
  // A descriptor with no id at all (a bare `magnet:`) has NOTHING to request:
  // the hook can never resolve it, so the tile must say "No preview" instead
  // of spinning on "Loading media..." forever. The post stays visible. A row
  // that names its content is still addressable by that hash.
  const unresolvable = signed && !effObjectId && !isContentHash(contentHash)

  // Defer the authenticated fetch for signed images until the element is near
  // the viewport. Direct URLs rely on the browser's native `loading="lazy"`.
  const shouldDefer = signed && loading === 'lazy'
  const [inView, setInView] = useState(!shouldDefer)
  const [hasError, setHasError] = useState(false)
  // Warm from the SYNC session cache on the first render. Without this a warm
  // picture starts on the remote URL (slow / timeout) and only swaps to the
  // cached bytes after an effect — the "doesn't load right away" symptom. The
  // GoonPanel already does exactly this; every media surface should too.
  const [cachedDirectUrl, setCachedDirectUrl] = useState<string | null>(() => {
    if (signed || !contentUrl) return null
    return cachedImageFor(resolveMediaUrl(contentUrl)) ?? null
  })
  const placeholderRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!shouldDefer || inView) return
    const el = placeholderRef.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true)
          observer.disconnect()
        }
      },
      { rootMargin: '400px 0px' }
    )
    observer.observe(el)
    return () => {
      observer.disconnect()
    }
  }, [shouldDefer, inView])

  const img = useObjectImage(signed ? effObjectId : null, identity, {
    enabled: signed ? inView : true,
    contentHash,
  })

  // vault:// has no in-browser form: prefer the localhost http URL (Range
  // capable, so <video> seeks) and fall back to the raw scheme URL the
  // Electron handler may still serve.
  const vaultHttpMap = useVaultHttpUrls([contentUrl])
  const vaultHttp = contentUrl && vaultHttpMap[contentUrl] ? vaultHttpMap[contentUrl] : null

  let baseSrc: string
  let isVideo: boolean
  if (signed) {
    baseSrc = img.url || (img.isLink && img.linkUrl ? img.linkUrl : '')
    isVideo = img.isVideo || Boolean(mimeType && mimeType.startsWith('video/')) || isMediaVideo(baseSrc)
  } else {
    baseSrc = vaultHttp || resolveMediaUrl(contentUrl)
    isVideo = Boolean(mimeType && mimeType.startsWith('video/')) || isMediaVideo(contentUrl) || false
  }

  // Local vault (opt-in): for direct http(s) content, prefer pinned bytes.
  //
  // ONE lookup drives BOTH the URL and the reveal gate. They used to be two
  // independent `vaultGet` calls (one for the URL, one for "is it settled?"),
  // and the two promises resolve in any order — so the gate could open while
  // `src` was still the remote URL: the remote frame flashed and the media
  // then reloaded from the local copy. One promise, one answer: the URL and
  // the settled flag can never disagree.
  const vaultEligible = !signed && /^https?:/i.test(baseSrc) && vaultOptIn()
  const vault = useVaultLookup(vaultEligible ? baseSrc : null)
  const vaultSrc = vault.local

  // Resolve direct remote images through disk cache (gmcache://) when offline/available
  useEffect(() => {
    if (signed || !baseSrc || /^(gmcache|idle-file|vault|blob|data):/i.test(baseSrc)) {
      setCachedDirectUrl(null)
      return
    }
    let live = true
    resolveImage(baseSrc)
      .then((local) => {
        if (live && local && local !== baseSrc) setCachedDirectUrl(local)
      })
      .catch(() => {})
    return () => { live = false }
  }, [baseSrc, signed])

  const proxied = devFetchable(baseSrc)
  const src = vaultSrc || cachedDirectUrl || proxied || baseSrc

  // Vault/cached swaps used to blank the tile for a frame (the <img> reloaded
  // from the remote URL to the local one). Keep showing the last loaded source
  // until the new one actually loads, so opening a post never blinks.
  const [shownSrc, setShownSrc] = useState<string | null>(null)
  useEffect(() => { setShownSrc(null) }, [objectId, contentUrl])
  const renderSrc = shownSrc || src

  // ---- Thumbnail ladder (dense grids only) --------------------------------
  // 1. `gmcache://<key>` -> the main process's native resize, synchronously.
  // 2. `blob:` / `vault://` / loopback http -> a bounded renderer thumbnail.
  // 3. anything else (a remote provider url) -> untouched: thumbnailing it
  //    would download the bytes twice to save memory already spent.
  const thumbCandidate = thumb && !isVideo
  const gmcacheThumb = thumbCandidate && src.startsWith('gmcache://') ? thumbUrl(src) : null
  const rendererThumb = useMediaThumb(src, thumbCandidate)
  const thumbSrc = gmcacheThumb || rendererThumb.url
  const [thumbFailed, setThumbFailed] = useState(false)
  useEffect(() => { setThumbFailed(false) }, [src])
  // While an eligible thumbnail is still owed, paint NOTHING: rendering the
  // full-size original would decode the very bitmap this mode exists to avoid,
  // and then swap it a frame later.
  const thumbPending = Boolean(thumbCandidate && !thumbFailed && !thumbSrc && rendererThumb.pending)
  const paintSrc = thumbPending
    ? null
    : thumbCandidate && !thumbFailed && thumbSrc
      ? thumbSrc
      : renderSrc

  // Vault flicker guard: for an opted-in http(s) source, hold the media
  // invisible until the local vault lookup settles, so a remote frame never
  // flashes before the local copy swaps in. The element stays mounted (its
  // layout is reserved); only opacity is gated, and only for the few ms the
  // local IPC takes — a no-copy image reveals as soon as the lookup returns.
  const vaultPending = vaultEligible && !vault.settled

  // A direct provider URL may fail while its IPC/vault copy is still being
  // resolved. When that resolution swaps `src` to the local copy, clear the
  // previous URL's error instead of leaving a good cached image hidden.
  useEffect(() => {
    setHasError(false)
  }, [src])

  useEffect(() => {
    if ((signed && img.failed) || hasError) {
      onMediaUnavailable?.()
      onLoadingChange?.(false)
    }
  }, [signed, img.failed, hasError, onMediaUnavailable, onLoadingChange])

  // Strict availability timeout: if media cannot be resolved or fails to load,
  // treat as unavailable so broken/loading containers collapse to 0 space.
  // A signed fetch that is still RUNNING is not "unavailable": the bytes can
  // still arrive, and the hook owns that deadline. But it must not spin
  // forever: a stuck/queued fetch (the 3-slot pool behind dozens of rows) gets a
  // HARD CAP, after which the tile says "No preview" instead of "Loading…" for
  // the life of the session. An explicit budget (a 5s story) still wins.
  const waitingForBytes = signed && !img.failed && !unresolvable
  const explicitBudget = unavailableTimeoutMs !== DEFAULT_UNAVAILABLE_TIMEOUT_MS
  const budgetMs = explicitBudget
    ? unavailableTimeoutMs
    : waitingForBytes
      ? Math.max(unavailableTimeoutMs, HARD_UNAVAILABLE_CAP_MS)
      : unavailableTimeoutMs
  useEffect(() => {
    if (src || hasError) return
    onLoadingChange?.(true)
    const timer = setTimeout(() => {
      setHasError(true)
      onMediaUnavailable?.()
      onLoadingChange?.(false)
    }, budgetMs)
    return () => clearTimeout(timer)
  }, [src, hasError, budgetMs, onMediaUnavailable, onLoadingChange])

  if (!src) {
    if (hideUnavailable && (signed ? img.failed || unresolvable : hasError)) return null
    // Hide-until-available: a row with no bytes yet takes NO space and shows
    // nothing, but the element stays mounted (ref) so the deferred signed
    // fetch's IntersectionObserver still fires and the row promotes on load.
    if (hideUnavailable) return <div ref={placeholderRef} className="h-0 w-full" />
    const waiting = waitingForBytes
    const seeding = signed && img.awaitingSeeder
    return (
      <div
        ref={placeholderRef}
        className="w-full py-3.5 px-3 flex items-center justify-center gap-1.5 text-2xs font-mono text-retro-muted bg-surface-canvas/40"
      >
        {waiting && !seeding ? (
          <>
            <Loader2 className="w-3 h-3 animate-spin text-retro-muted shrink-0" aria-label="Loading media" />
            <span>Loading media...</span>
          </>
        ) : seeding ? (
          <>
            <Loader2 className="w-3 h-3 animate-spin text-retro-muted shrink-0" />
            <span>Waiting for poster…</span>
          </>
        ) : (
          <span>No preview</span>
        )}
      </div>
    )
  }

  // Fallback placeholder for failed loads

  if (hasError) {
    if (hideUnavailable) return null
    return (
      <div
        ref={placeholderRef}
        className="w-full py-3.5 px-3 flex items-center justify-center gap-1.5 text-2xs font-mono text-retro-muted bg-surface-canvas/40"
      >
        <span>Image unavailable</span>
      </div>
    )
  }

  if (isVideo) {
    if (controls) {
      return (
        <NativeVideoPlayer
          src={renderSrc}
          className={videoClassName || className}
          videoClassName={videoClassName}
          natural={natural}
          muted={muted}
          autoPlay={autoPlay}
          loop={loop}
          playsInline={playsInline}
          alwaysShowControls={alwaysShowControls}
          onExpand={onExpand}
          onDoubleTapLike={onDoubleTapLike}
          onLoadedData={() => {
            onLoad?.()
            setShownSrc(src)
            onLoadingChange?.(false)
          }}
          onError={(_e) => {
            onError?.()
            setHasError(true)
            if (signed && effObjectId) evictObjectImage(effObjectId)
            onMediaUnavailable?.()
            onLoadingChange?.(false)
          }}
        />
      )
    }

  return (
    <video
      src={renderSrc}
      className={videoClassName || className}
      muted={muted}
      autoPlay={autoPlay}
      loop={loop}
      controls={false}
      playsInline={playsInline}
      preload={preload}
      style={vaultPending ? { opacity: 0 } : undefined}
      data-media-url={contentUrl || undefined}
      onLoadedData={(e) => {
        onLoad?.()
        onLoadSize?.(e.currentTarget.videoWidth, e.currentTarget.videoHeight)
        setShownSrc(src)
        onLoadingChange?.(false)
      }}
      onError={(_e) => {
        onError?.()
        setHasError(true)
        if (signed && effObjectId) evictObjectImage(effObjectId)
        onMediaUnavailable?.()
        onLoadingChange?.(false)
      }}
    />
  )
  }

  return (
    <img
      src={paintSrc ?? undefined}
      alt={alt}
      className={className}
      loading={loading}
      decoding="async"
      fetchPriority={fetchPriority}
      style={vaultPending ? { opacity: 0 } : undefined}
      data-media-url={contentUrl || undefined}
      onLoad={(e) => {
        onLoad?.()
        onLoadSize?.(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)
        setShownSrc(paintSrc)
        onLoadingChange?.(false)
      }}
      onError={(_e) => {
        // A failed THUMBNAIL is not a failed picture: drop to the full original
        // instead of declaring the media unavailable.
        if (thumbSrc && !thumbFailed) {
          setThumbFailed(true)
          return
        }
        onError?.()
        setHasError(true)
        if (signed && effObjectId) evictObjectImage(effObjectId)
        onMediaUnavailable?.()
        onLoadingChange?.(false)
      }}
      draggable={false}
    />
  )
}
