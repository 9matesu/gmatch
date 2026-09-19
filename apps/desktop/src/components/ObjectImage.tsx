"use client";

import { useEffect, useRef, useState } from 'react'
import { isMediaVideo, resolveMediaUrl } from '../utils/media'
import { useObjectImage } from '../hooks/useObjectImage'
import { NativeVideoPlayer } from './media/NativeVideoPlayer'
import { useVaultUrl } from '../services/vault'

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
}

const OBJECT_PATH = '/api/objects/'

// A bare object id (uuid) is never a URL. resolveMediaUrl maps it to
// /api/objects/<id> for <img>, but that request carries no auth headers and
// 401s for anything not public. The signed fetch path must own it instead.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function extractObjectId(contentUrl: string | null | undefined, objectId: string | null | undefined): string | null {
  if (!contentUrl) return objectId || null
  const idx = contentUrl.indexOf(OBJECT_PATH)
  if (idx >= 0) return contentUrl.slice(idx + OBJECT_PATH.length).split(/[?#]/)[0] || null
  if (UUID_RE.test(contentUrl.trim())) return contentUrl.trim()
  return objectId || null
}

function needsSignedFetch(contentUrl: string | null | undefined, objectId: string | null | undefined): boolean {
  if (contentUrl) {
    const trimmed = contentUrl.trim()
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
}: ObjectImageProps) {
  const signed = needsSignedFetch(contentUrl, objectId)
  const effObjectId = extractObjectId(contentUrl, objectId)

  // Defer the authenticated fetch for signed images until the element is near
  // the viewport. Direct URLs rely on the browser's native `loading="lazy"`.
  const shouldDefer = signed && loading === 'lazy'
  const [inView, setInView] = useState(!shouldDefer)
  const [hasError, setHasError] = useState(false)
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

  const img = useObjectImage(signed ? effObjectId : null, identity, { enabled: signed ? inView : true })

  let src: string
  let isVideo: boolean
  if (signed) {
    src = img.url || ''
    isVideo = img.isVideo || Boolean(mimeType && mimeType.startsWith('video/'))
  } else {
    src = resolveMediaUrl(contentUrl)
    isVideo = Boolean(mimeType && mimeType.startsWith('video/')) || isMediaVideo(contentUrl) || false
  }

  // Local vault (opt-in): for direct http(s) content, prefer pinned bytes.
  const vaultSrc = useVaultUrl(!signed && /^https?:/i.test(src) ? src : null)
  if (vaultSrc) src = vaultSrc

  if (!src) {
    // While a signed image is deferred (off-screen) or still fetching, show a
    // blank placeholder instead of "No preview" to avoid a misleading flash.
    // A P2P-only row with no live seeder says so honestly and retries when a
    // peer comes online (see useObjectImage PEER_ONLINE_EVENT).
    const waiting = signed && !img.failed
    const seeding = signed && img.awaitingSeeder
    return (
      <div ref={placeholderRef} className={className || 'w-full aspect-[4/3] bg-retro-bg flex items-center justify-center text-[10px] text-retro-muted'}>
        {seeding ? 'Waiting for poster…' : waiting ? '' : 'No preview'}
      </div>
    )
  }

  // Fallback placeholder for failed loads

  if (hasError) {
    return (
      <div ref={placeholderRef} className={className || 'w-full aspect-[4/3] bg-retro-bg flex items-center justify-center text-[10px] text-retro-muted'}>
        Image unavailable
      </div>
    )
  }

  if (isVideo) {
    if (controls) {
      return (
        <NativeVideoPlayer
          src={src}
          className={videoClassName || className}
          videoClassName={videoClassName}
          muted={muted}
          autoPlay={autoPlay}
          loop={loop}
          playsInline={playsInline}
          alwaysShowControls={alwaysShowControls}
          onExpand={onExpand}
          onDoubleTapLike={onDoubleTapLike}
          onError={(_e) => {
            onError?.()
            setHasError(true)
          }}
        />
      )
    }

  return (
    <video
      src={src}
      className={videoClassName || className}
      muted={muted}
      autoPlay={autoPlay}
      loop={loop}
      controls={false}
      playsInline={playsInline}
      preload={preload}
      data-media-url={contentUrl || undefined}
      onError={(_e) => {
        onError?.()
        setHasError(true)
      }}
    />
  )
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading={loading}
      decoding="async"
      fetchPriority={fetchPriority}
      data-media-url={contentUrl || undefined}
      onError={(_e) => {
        onError?.()
        setHasError(true)
      }}
      draggable={false}
      crossOrigin={signed ? 'use-credentials' : 'anonymous'}
    />
  )
}
