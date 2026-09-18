"use client";

import { useState, useEffect } from 'react'
import { orbitFetch } from '../utils/api'
import { getLocalObject } from '../utils/p2pSwarm'

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
// Cap 24 slots keeps GPU texture memory and RAM low on long timelines.
const CACHE_MAX = 24
const objectCache = new Map<string, ImageState>()
const cacheSource = new Map<string, string>()

// A mounted consumer's entry must never be evicted-and-revoked out from under
// it: the <img>/<video> keeps pointing at that blob URL and dies the moment it
// is revoked ("Image unavailable" for photos, empty src -> "No preview" for
// videos). Pin while mounted, unpin on unmount; eviction skips pinned keys.
const pinned = new Set<string>()
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

    // Clean any accidental /api/objects/ prefix (normalized key story below)
    const cleanId = normalizeCardId(cardId)

    // Adopt a cached entry immediately if present
    if (cacheGet(cleanId, identity.orbitId)) return

    let cancelled = false
    let freshUrl: string | null = null

// P2P first, then network only if P2P misses. Concurrent fetches race
    // and the loser's blob URL gets orphaned into leaked RAM.
    getLocalObject(cleanId).then(async (localBlob) => {
      if (cancelled) return
      if (localBlob) {
        freshUrl = URL.createObjectURL(localBlob)
        const loaded: ImageState = {
          cardId: cleanId,
          url: freshUrl,
          failed: false,
          isVideo: localBlob.type.startsWith('video/'),
          isLink: false,
          linkUrl: null,
        }
        cacheSet(cleanId, identity.orbitId, loaded)
        setImg(loaded)
        return // P2P hit: skip network entirely
      }
      await fetchFromNetwork()
    }).catch(() => { fetchFromNetwork() })

    async function fetchFromNetwork() {
      if (cancelled) return
      try {
        const res = await orbitFetch(`/api/objects/${cleanId}`, { method: 'GET' }, identity)
        if (cancelled) return
        if (!res.ok) {
          if (res.status === 502 || res.status === 503 || res.status === 504) return
          const failedState: ImageState = { cardId: cleanId, url: '', failed: true, isVideo: false, isLink: false, linkUrl: null }
          cacheSet(cleanId, identity?.orbitId || '', failedState)
          setImg(failedState)
          if (res.status === 404 && typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('orbit-object-404', { detail: { cardId: cleanId } }))
          }
          return
        }

        const contentType = (res.headers.get('Content-Type') || '').toLowerCase()

        if (contentType.includes('json')) {
          const data = await res.json().catch(() => null)
          if (cancelled) return
          const linkState: ImageState = {
            cardId: cleanId,
            url: '',
            failed: false,
            isVideo: false,
            isLink: true,
            linkUrl: typeof data?.url === 'string' ? data.url : null,
          }
          cacheSet(cleanId, identity?.orbitId || '', linkState)
          setImg(linkState)
          return
        }

        const blob = await res.blob()
        if (cancelled) return
        freshUrl = URL.createObjectURL(blob)
        const loaded: ImageState = {
          cardId: cleanId,
          url: freshUrl,
          failed: false,
          isVideo: contentType.startsWith('video/'),
          isLink: false,
          linkUrl: null,
        }
        cacheSet(cleanId, identity?.orbitId || '', loaded)
        setImg(loaded)
      } catch {
        if (!cancelled) {
          const failedState: ImageState = { cardId: cleanId, url: '', failed: true, isVideo: false, isLink: false, linkUrl: null }
          cacheSet(cleanId, identity?.orbitId || '', failedState)
          setImg(failedState)
        }
      }
    }
    return () => {
      cancelled = true
      if (freshUrl && !objectCache.has(cleanId)) URL.revokeObjectURL(freshUrl)
    }
  }, [cardId, identity, enabled])

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
    return cached || EMPTY
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
  }
}
