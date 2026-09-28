import type { OrbitIdentity } from '@orbit/crypto'
import { signRequestHeaders, LEGACY_FLY_ORIGIN } from '../utils/api'
import { saveObject, getObject, type StoredObject } from '../utils/storage'
import { isMagnetUri } from '../utils/magnet'

export interface LegacyBackfillProgress {
  phase: 'idle' | 'checking' | 'downloading' | 'completed' | 'error'
  total: number
  current: number
  migratedCount: number
  message: string
}

export type ProgressCallback = (progress: LegacyBackfillProgress) => void

const KEY_COMPLETED = 'gmatch.fly_backfill_completed_v1'
const KEY_SAVED_IDS = 'gmatch.fly_backfill_saved_ids_v1'

export function isLegacyBackfillCompleted(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false
    return localStorage.getItem(KEY_COMPLETED) === 'true'
  } catch {
    return false
  }
}

export function resetLegacyBackfillState(): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.removeItem(KEY_COMPLETED)
  } catch { /* noop */ }
}

function getSavedIds(): Set<string> {
  try {
    if (typeof localStorage === 'undefined') return new Set()
    const raw = localStorage.getItem(KEY_SAVED_IDS)
    if (!raw) return new Set()
    const arr = JSON.parse(raw)
    return new Set(Array.isArray(arr) ? arr : [])
  } catch {
    return new Set()
  }
}

function persistSavedId(id: string, savedSet: Set<string>): void {
  try {
    savedSet.add(id)
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(KEY_SAVED_IDS, JSON.stringify(Array.from(savedSet)))
    }
  } catch { /* noop */ }
}

interface LegacyPostSummary {
  id: string
  author_id: string
  author_name?: string
  author_avatar?: string | null
  url: string
  mime_type?: string
  caption?: string | null
  location?: string | null
  tags?: string[]
  created_at: string
  like_count?: number
  comment_count?: number
  is_public?: number | boolean
  media?: Array<{ id: string; url: string; mime_type?: string }>
  comments?: Array<{
    id: string
    author_id: string
    author_name?: string
    author_avatar?: string | null
    text: string
    created_at?: string
    like_count?: number
  }>
}

function getLegacyFlyOrigin(): string {
  const isDev = Boolean(import.meta.env.DEV) ||
    (typeof window !== 'undefined' &&
      (window.location?.hostname === 'localhost' || window.location?.hostname === '127.0.0.1'))
  if (isDev && typeof window !== 'undefined' && !(window as unknown as { gmatch?: unknown }).gmatch) {
    return '/fly-api'
  }
  return LEGACY_FLY_ORIGIN
}

/**
 * Executes a signed GET request against gmatch.fly.dev
 */
async function legacyGet(
  pathnameWithQuery: string,
  identity: OrbitIdentity,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
  timeoutMs = 10000,
): Promise<Response> {
  const baseOrigin = getLegacyFlyOrigin()
  const url = `${baseOrigin}${pathnameWithQuery}`
  const pathname = pathnameWithQuery.split('?')[0]
  const headers = signRequestHeaders('GET', pathname, '', identity)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    })
    return res
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Downloads binary bytes for a post media object from gmatch.fly.dev
 */
async function downloadMediaBytes(
  mediaUrl: string,
  identity: OrbitIdentity,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<ArrayBuffer | null> {
  try {
    const baseOrigin = getLegacyFlyOrigin()
    let fullUrl = mediaUrl
    if (mediaUrl.startsWith('/')) {
      fullUrl = `${baseOrigin}${mediaUrl}`
    } else if (!/^https?:\/\//i.test(mediaUrl) && !isMagnetUri(mediaUrl)) {
      // encodeURIComponent: a legacy mediaUrl can be a bare id OR a
      // descriptor (a magnet-registered post's content_url). An unencoded
      // magnet truncates the path at its `?` and 404s on "magnet:".
      fullUrl = `${baseOrigin}/api/objects/${encodeURIComponent(mediaUrl)}`
    } else if (isMagnetUri(mediaUrl)) {
      return null
    } else if (mediaUrl.startsWith(LEGACY_FLY_ORIGIN) && baseOrigin !== LEGACY_FLY_ORIGIN) {
      fullUrl = mediaUrl.replace(LEGACY_FLY_ORIGIN, baseOrigin)
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 20000)
    try {
      const isFly = fullUrl.startsWith(LEGACY_FLY_ORIGIN) || fullUrl.startsWith('/fly-api')
      let reqPath = fullUrl
      try {
        reqPath = new URL(fullUrl, 'http://localhost').pathname.replace(/^\/fly-api/, '')
      } catch { /* ignore */ }
      const headers = isFly
        ? signRequestHeaders('GET', reqPath, '', identity)
        : new Headers()
      const res = await fetchImpl(fullUrl, { headers, signal: controller.signal })
      if (!res.ok) return null
      return await res.arrayBuffer()
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return null
  }
}

/**
 * Backfills posts and media from gmatch.fly.dev into local IndexedDB storage.
 */
export async function runLegacyBackfill(
  identity: OrbitIdentity,
  onProgress?: ProgressCallback,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<{ migratedCount: number; error?: string }> {
  const savedIds = getSavedIds()

  onProgress?.({
    phase: 'checking',
    total: 0,
    current: 0,
    migratedCount: 0,
    message: 'Connecting to legacy server (gmatch.fly.dev)...',
  })

  // 1. Probe legacy server health
  try {
    const healthProbe = await legacyGet('/api/health', identity, fetchImpl, 5000)
    if (!healthProbe.ok) {
      onProgress?.({
        phase: 'idle',
        total: 0,
        current: 0,
        migratedCount: 0,
        message: 'Legacy server is currently offline or unreachable.',
      })
      return { migratedCount: 0 }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    onProgress?.({
      phase: 'idle',
      total: 0,
      current: 0,
      migratedCount: 0,
      message: `Legacy server unreachable: ${msg}`,
    })
    return { migratedCount: 0 }
  }

  // 2. Fetch posts list: first user's own posts, then public feed
  const postMap = new Map<string, LegacyPostSummary>()

  try {
    // A. User's own posts
    const ownRes = await legacyGet(`/api/posts?author_id=${encodeURIComponent(identity.orbitId)}&limit=100`, identity, fetchImpl)
    if (ownRes.ok) {
      const data = await ownRes.json().catch(() => ({}))
      if (Array.isArray(data.posts)) {
        for (const p of data.posts) {
          postMap.set(p.id, p)
        }
      }
    }
  } catch { /* proceed to public feed */ }

  try {
    // B. Public feed posts
    const feedRes = await legacyGet('/api/posts?limit=100&sort=latest', identity, fetchImpl)
    if (feedRes.ok) {
      const data = await feedRes.json().catch(() => ({}))
      if (Array.isArray(data.posts)) {
        for (const p of data.posts) {
          if (!postMap.has(p.id)) {
            postMap.set(p.id, p)
          }
        }
      }
    }
  } catch { /* continue with whatever was collected */ }

  const postsToProcess = Array.from(postMap.values())
  const total = postsToProcess.length

  if (total === 0) {
    onProgress?.({
      phase: 'completed',
      total: 0,
      current: 0,
      migratedCount: 0,
      message: 'No legacy posts found to backfill.',
    })
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(KEY_COMPLETED, 'true')
    } catch { /* noop */ }
    return { migratedCount: 0 }
  }

  onProgress?.({
    phase: 'downloading',
    total,
    current: 0,
    migratedCount: 0,
    message: `Found ${total} legacy posts. Preserving media...`,
  })

  let migratedCount = 0

  for (let i = 0; i < postsToProcess.length; i++) {
    const post = postsToProcess[i]

    onProgress?.({
      phase: 'downloading',
      total,
      current: i + 1,
      migratedCount,
      message: `Preserving post ${i + 1}/${total}: "${(post.caption || post.id).slice(0, 20)}..."`,
    })

    // Check if we already have the media binary locally
    const existing = await getObject(post.id).catch(() => null)
    let binaryData: ArrayBuffer | null = existing?.data || null

    // If missing from local DB, fetch comments and media
    let detailedPost: LegacyPostSummary = post
    if (post.comment_count && post.comment_count > 0) {
      try {
        const detailRes = await legacyGet(`/api/posts/${encodeURIComponent(post.id)}`, identity, fetchImpl)
        if (detailRes.ok) {
          const detail = await detailRes.json().catch(() => null)
          if (detail && detail.id) {
            detailedPost = { ...post, ...detail }
          }
        }
      } catch { /* keep post summary */ }
    }

    if (!binaryData || binaryData.byteLength === 0) {
      const mediaUrl = post.url || `/api/objects/${post.id}`
      binaryData = await downloadMediaBytes(mediaUrl, identity, fetchImpl)
    }

    if (!binaryData) {
      // Create empty placeholder buffer so post record still renders with metadata
      binaryData = new Uint8Array(0).buffer
    }

    const storedObj: StoredObject = {
      id: post.id,
      name: post.id,
      mime_type: post.mime_type || 'image/jpeg',
      size_bytes: binaryData.byteLength,
      owner_id: post.author_id,
      sender_pubkey: '',
      sender_enc_pubkey: '',
      created_at: post.created_at || new Date().toISOString(),
      data: binaryData,
      is_public: 1,
      caption: detailedPost.caption || '',
      post_caption: detailedPost.caption || '',
      tags: detailedPost.tags || [],
      location: detailedPost.location || '',
      author_name: detailedPost.author_name || 'Player',
      author_avatar: detailedPost.author_avatar || null,
      comments: detailedPost.comments || [],
      likes_count: detailedPost.like_count || 0,
      like_count: detailedPost.like_count || 0,
      comment_count: detailedPost.comment_count || 0,
    }

    await saveObject(storedObj).catch(() => {})
    persistSavedId(post.id, savedIds)
    migratedCount++

    // If multi-media siblings exist, download and preserve them too
    if (Array.isArray(detailedPost.media) && detailedPost.media.length > 0) {
      for (const sibling of detailedPost.media) {
        if (!sibling.id || sibling.id === post.id) continue
        const existingSib = await getObject(sibling.id).catch(() => null)
        if (!existingSib || !existingSib.data || existingSib.data.byteLength === 0) {
          const sibBytes = await downloadMediaBytes(sibling.url || `/api/objects/${sibling.id}`, identity, fetchImpl)
          if (sibBytes) {
            await saveObject({
              id: sibling.id,
              name: sibling.id,
              mime_type: sibling.mime_type || post.mime_type || 'image/jpeg',
              size_bytes: sibBytes.byteLength,
              owner_id: post.author_id,
              sender_pubkey: '',
              sender_enc_pubkey: '',
              created_at: post.created_at || new Date().toISOString(),
              data: sibBytes,
              is_public: 1,
              post_group: post.id,
            }).catch(() => {})
            persistSavedId(sibling.id, savedIds)
          }
        }
      }
    }
  }

  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY_COMPLETED, 'true')
  } catch { /* noop */ }

  onProgress?.({
    phase: 'completed',
    total,
    current: total,
    migratedCount,
    message: `Preserved ${migratedCount} posts and media files locally.`,
  })

  return { migratedCount }
}
