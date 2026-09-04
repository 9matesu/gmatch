"use client";

import { useState, useEffect } from 'react'
import { orbitFetch } from '../utils/api'

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
}

interface ImageState {
  cardId: string
  url: string
  failed: boolean
  isVideo: boolean
  isLink: boolean
  linkUrl: string | null
}

const EMPTY: ObjectImageResult = { url: null, failed: false, isVideo: false, isLink: false, linkUrl: null }

function isProtectedObjectUrl(value: string): boolean {
  return value.startsWith('/api/objects/') || value.includes('/api/objects/')
}

// Bounded LRU cache of previously fetched objects keyed by cardId. Prevents
// repeat downloads/decrypts on every round change (the same card is re-requested
// as my-card, opponent-card and reveal card across rounds), keeping memory bounded.
const CACHE_MAX = 24
const objectCache = new Map<string, ImageState>()
const cacheSource = new Map<string, string>()

function cacheGet(cardId: string, source: string): ImageState | null {
  const hit = objectCache.get(cardId)
  if (!hit) return null
  if (cacheSource.get(cardId) !== source) return null
  // refresh LRU position
  objectCache.delete(cardId)
  objectCache.set(cardId, hit)
  return hit
}

function cacheSet(cardId: string, source: string, img: ImageState): void {
  cacheSource.set(cardId, source)
  objectCache.delete(cardId)
  objectCache.set(cardId, img)
  // Evict oldest (front) entries beyond the cap, revoking their object URLs to
  // hand memory back to the browser.
  while (objectCache.size > CACHE_MAX) {
    const oldest = objectCache.keys().next().value as string | undefined
    if (!oldest) break
    const evicted = objectCache.get(oldest)
    if (evicted?.url) URL.revokeObjectURL(evicted.url)
    objectCache.delete(oldest)
    cacheSource.delete(oldest)
  }
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
  const isDirectUrl = Boolean(
      cardId && (
        cardId.startsWith('data:') ||
        cardId.startsWith('blob:') ||
        ((cardId.startsWith('http://') || cardId.startsWith('https://')) && !isProtectedObjectUrl(cardId)) ||
        (cardId.startsWith('/api/') && !cardId.startsWith('/api/objects/'))
      )
  )

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

  useEffect(() => {
    if (!cardId) return

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

    // Clean any accidental /api/objects/ prefix
    const cleanId = cardId.startsWith('/api/objects/') ? cardId.slice('/api/objects/'.length).split(/[?#]/)[0] : cardId

    // Adopt a cached entry immediately if present
    if (cacheGet(cleanId, identity.orbitId)) return

    let cancelled = false
    let freshUrl: string | null = null
    orbitFetch(`/api/objects/${cleanId}`, { method: 'GET' }, identity)
      .then(async (res) => {
        if (cancelled) return
        if (!res.ok) {
          const failedState: ImageState = { cardId, url: '', failed: true, isVideo: false, isLink: false, linkUrl: null }
          cacheSet(cardId, identity?.orbitId || '', failedState)
          setImg(failedState)
          if (res.status === 404 && typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('orbit-object-404', { detail: { cardId } }))
          }
          return
        }

        const contentType = (res.headers.get('Content-Type') || '').toLowerCase()

        // Link-type objects return JSON { type: 'link', url }
        if (contentType.includes('json')) {
          const data = await res.json().catch(() => null)
          if (cancelled) return
          const linkState: ImageState = {
            cardId,
            url: '',
            failed: false,
            isVideo: false,
            isLink: true,
            linkUrl: typeof data?.url === 'string' ? data.url : null,
          }
          cacheSet(cardId, identity?.orbitId || '', linkState)
          setImg(linkState)
          return
        }

        const blob = await res.blob()
        if (cancelled) return
        freshUrl = URL.createObjectURL(blob)
        const loaded: ImageState = {
          cardId,
          url: freshUrl,
          failed: false,
          isVideo: contentType.startsWith('video/'),
          isLink: false,
          linkUrl: null,
        }
        cacheSet(cardId, identity?.orbitId || '', loaded)
        setImg(loaded)
      })
      .catch(() => {
        if (!cancelled) {
          const failedState: ImageState = { cardId, url: '', failed: true, isVideo: false, isLink: false, linkUrl: null }
          cacheSet(cardId, identity?.orbitId || '', failedState)
          setImg(failedState)
        }
      })
    return () => {
      cancelled = true
      if (freshUrl && !objectCache.has(cardId)) URL.revokeObjectURL(freshUrl)
    }
  }, [cardId, identity, enabled])

  if (!img || img.cardId !== cardId) {
    const cached = cardId && identity ? cacheGet(cardId, identity.orbitId) : null
    return cached || EMPTY
  }
  // Keep the displayed card fresh in the LRU so eviction never reclaims it
  // while it is on screen.
  if (cardId && identity) cacheGet(cardId, identity.orbitId)
  return {
    url: img.url || null,
    failed: img.failed,
    isVideo: img.isVideo,
    isLink: img.isLink,
    linkUrl: img.linkUrl,
  }
}
