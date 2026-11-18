import { useState, useMemo, useEffect, useRef } from 'react'
import { useGame } from '../../game/store'
import type { GalleryImage } from '../../game/types'
import { IconTrash, IconWallpaper, IconX, IconChevronL, IconChevronR } from '../../ui/icons'
import { DND_KEEPSAKE } from '../DropZone'
import { offlineSvg } from '../../services/offlineSvg'
import { redgifsPlayable } from '../../services/redgifs'
import { GALLERY_ACTION_EVENT, type GalleryActionDetail } from '../../utils/galleryActions'
import CachedImg from '../../ui/CachedImg'
import MediaViewerModal from '../../ui/MediaViewerModal'
import { EmptyState } from '../EmptyState'
import { Button, Tabs, Title } from '../../ui/kit'
import { useVaultUrls, useVaultUrl, useVaultHttpUrls, vaultLookupSettled, vaultForgetFailure } from '../../services/vault'
import { resolveKeepsakeLocal, resolveLocalMedia, retainLocalUrl, releaseLocalUrl, markLocalLookupSettled, keepsakeLocalSettled, type KeepsakeLocal } from '../../services/keepsake'
import { SlideshowPlayer, type ResolvedItem } from '../slideshows/SlideshowPlayer'
import { NativeVideoPlayer } from '../media/NativeVideoPlayer'
import {
  Image as ImageIcon,
  Search,
  Tag,
  Download,
  Trash2,
  CheckSquare,
  Square,
  Film,
  Repeat,
  Sparkles,
  ImagePlus,
  ExternalLink,
} from 'lucide-react'
import { MUTED } from '../../ui/styles'

const RARITY_ORDER: Record<string, number> = {
  Common: 1,
  Copper: 2,
  Silver: 3,
  Gold: 4,
  Diamond: 5,
}

/**
 * Local-only download for keepsakes: fetches verified local bytes
 * (vault://, blob:, same-origin) into a download. There is deliberately NO
 * remote-href/_blank fallback — a keepsake download must never silently
 * become a provider navigation. Returns false when there is nothing local.
 */
async function downloadMedia(url: string, filename: string): Promise<boolean> {
  try {
    if (!url || /^(https?:)?\/\//i.test(url)) return false
    const res = await fetch(url)
    if (!res.ok) return false
    const blob = await res.blob()
    if (!blob || blob.size === 0) return false
    const blobUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(blobUrl)
    return true
  } catch {
    return false
  }
}

/**
 * Slideshow plays verified local bytes only. Items without local bytes are
 * skipped (counted); a show with nothing local does not start.
 */
function toLocalSlideshowItems(
  images: GalleryImage[],
  vaultUrls: Record<string, string>,
  localUrls: Record<string, string>,
): { items: ResolvedItem[]; skipped: number } {
  const items: ResolvedItem[] = []
  let skipped = 0
  for (const img of images) {
    const r = resolveKeepsakeLocal(img, vaultUrls, localUrls)
    if (r.kind !== 'local') {
      skipped += 1
      continue
    }
    items.push({
      object_id: img.localRef || null,
      url: r.url,
      caption: img.tags.slice(0, 5).join(' ') || 'Keepsake',
      mime_type: img.kind === 'video' ? 'video/mp4' : 'image/jpeg',
    })
  }
  return { items, skipped }
}

/**
 * Fast thumbnail resolution for gallery grid tiles:
 * 1. Pinned local vault SSD URL if ready (vault://)
 * 2. Pre-computed preview thumbnail if available
 * 3. Inferred thumbnail for known hosts (booru.org, realbooru) to avoid multi-MB full PNG/JPEG stalls
 * 4. Full image URL fallback — legacy records (no localStatus) and explicitly
 *    failed saves only; a keep verified `local` never falls back here, because
 *    its bytes are supposed to be on disk and a hotlink would hide a broken or
 *    evicted local entry.
 */
export function resolveGalleryTileUrl(img: GalleryImage, vaultUrl?: string): string {
  if (vaultUrl) return vaultUrl
  // A keep verified persisted points at its content hash: render from the
  // vault, never hotlink the provider. If bytes went missing after the fact,
  // an empty tile is honest; a remote one is not.
  if (img.saveState === 'persisted' && img.localRef) return `vault://f/${img.localRef}`
  if (img.saveState === 'persisted') return ''
  if (img.preview) return img.preview
  const u = String(img.url || '')
  if (u.includes('img.booru.org')) {
    const match = u.match(/https:\/\/img\.booru\.org\/([^/]+)\/\/images\/([^/]+)\/([^."]+)\.([^?#]+)/i)
    if (match) {
      const [, bSub, dir, hash, ext] = match
      return `https://thumbs.booru.org/${bSub}/thumbnails//${dir}/thumbnail_${hash}.${ext}`
    }
  }
  if (u.includes('realbooru.com/images/')) {
    const match = u.match(/https:\/\/realbooru\.com\/images\/([^/]+)\/([^/]+)\/([^.]+)\./i)
    if (match) {
      const [, d1, d2, h] = match
      return `https://realbooru.com/thumbnails/${d1}/${d2}/thumbnail_${h}.jpg`
    }
  }
  return u
}

/**
 * Phase 5: resolve keepsakes to locally stored BYTES (swarm IndexedDB), keyed
 * by source url. Vault (Electron) is preferred where present; this covers the
 * dev/browser case and keeps the gallery off third-party URLs once cached.
 * Only entries already verified 'local' are resolved; blob URLs are revoked
 * on change/unmount. Exported for the shared MediaPickerModal (B7), which
 * must render the same honest tiles the gallery does.
 */
export function useKeepsakeLocalUrls(images: GalleryImage[], vaultUrls: Record<string, string>): Record<string, string> {
  const [map, setMap] = useState<Record<string, string>>({})
  const live = useRef(new Map<string, string>()) // source url -> object URL
  const [nonce, setNonce] = useState(0)
  const key = images.map((i) => i.url || '').filter(Boolean).join('|')
  // A retry can store bytes with no vault event behind it (browser/dev stores
  // in IndexedDB only), so the tile must be told to look again instead of
  // staying "missing" until the page happens to change.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const bump = () => setNonce((n) => n + 1)
    window.addEventListener('orbit-keepsake-updated', bump)
    return () => window.removeEventListener('orbit-keepsake-updated', bump)
  }, [])
  useEffect(() => {
    let dead = false
    void (async () => {
      const { getLocalObject } = await import('../../utils/p2pSwarm')
      const next = new Map<string, string>()
      for (const img of images) {
        const u = img.url || ''
        if (!u) continue
        if (vaultUrls[u]) continue // vault owns this one
        const existing = live.current.get(u)
        if (existing) { next.set(u, existing); continue }
        if (img.saveState !== 'persisted') continue
        try {
          const blob = (await getLocalObject(img.localRef || u)) || (await getLocalObject(u))
          if (blob) next.set(u, URL.createObjectURL(blob))
        } catch { /* unresolved stays unresolved */ }
        // The object store answered (hit or miss): the tile may now report an
        // honest status instead of waiting forever.
        markLocalLookupSettled(u)
        if (img.localRef) markLocalLookupSettled(img.localRef)
      }
      if (dead) {
        // Superseded mid-flight: revoke only what this run minted and nothing
        // the live map still owns.
        for (const [u, o] of next) if (!live.current.has(u)) { try { URL.revokeObjectURL(o) } catch { /* gone */ } }
        return
      }
      for (const [u, o] of live.current) {
        if (!next.has(u)) { try { URL.revokeObjectURL(o) } catch { /* gone */ } }
      }
      live.current = next
      setMap(Object.fromEntries(next))
    })()
    return () => { dead = true }
  }, [key, JSON.stringify(vaultUrls), nonce])
  // Unmount: release everything this view minted.
  useEffect(() => {
    return () => {
      for (const o of live.current.values()) { try { URL.revokeObjectURL(o) } catch { /* gone */ } }
      live.current = new Map()
    }
  }, [])
  return map
}

/**
 * Live progress for the streaming vault pin (large videos), so a long cache
 * does not look frozen next to the "Caching…" badge. Session-only, keyed by
 * source url; never persisted with the gallery.
 */
function useVaultPinProgress(): Record<string, number> {
  const [map, setMap] = useState<Record<string, number>>({})
  useEffect(() => {
    const sub = typeof window !== 'undefined' ? window.gmatch?.onVaultPinProgress : undefined
    if (typeof sub !== 'function') return
    const off = sub(({ url, bytes, total }) => {
      if (!url || !(total > 0)) return
      const pct = Math.max(0, Math.min(99, Math.floor((bytes / total) * 100)))
      setMap((prev) => (prev[url] === pct ? prev : { ...prev, [url]: pct }))
    })
    return () => {
      try { off?.() } catch { /* bridge already detached */ }
    }
  }, [])
  return map
}

/** In-flight retries keyed by keep id: the tile badge and the viewer's retry
 *  button call the same pipeline, and clicking both must not start two
 *  downloads for the same bytes. */
const retryingKeepsakes = new Set<string>()

/** Boot repair runs once per session: every keep that is not yet verified
 *  'persisted' goes through the authorized persist pipeline, so the vault
 *  ends up holding ALL the media the app knows about — offline data, not
 *  best-effort. The vault bridge dedupes by content hash, so a re-run after
 *  an eviction re-fetches only what is actually missing. */
let bootRepairRan = false
async function repairKeepsakeVault(gallery: GalleryImage[]): Promise<void> {
  if (bootRepairRan) return
  bootRepairRan = true
  const missing = gallery.filter((g) => g.url && g.saveState !== 'persisted' && !retryingKeepsakes.has(g.id))
  // Bounded pool of 3: the pipeline is already per-URL guarded; this keeps the
  // boot repair from storming a host with every keep at once.
  const queue = [...missing]
  const worker = async () => {
    for (;;) {
      const img = queue.shift()
      if (!img) return
      await retryKeepsake(img).catch(() => { /* a failed repair stays 'failed' honestly */ })
    }
  }
  await Promise.all([worker(), worker(), worker()])
}

/** Re-run the authorized persist pipeline for one keep; store the outcome.
 *  A failed retry never discards an identity the record already carries. */
async function retryKeepsake(img: GalleryImage): Promise<void> {
  if (retryingKeepsakes.has(img.id)) return
  retryingKeepsakes.add(img.id)
  useGame.setState((s) => ({
    gallery: s.gallery.map((g) => (g.id === img.id ? { ...g, saveState: 'downloading' as const } : g)),
  }))
  try {
    // An explicit retry must really hit the vault again (the session's negative
    // pin cache otherwise answers "null" without trying) and must wake the
    // tile's object-store resolution once the bytes land.
    vaultForgetFailure(img.url)
    const { persistKeepsake } = await import('../../services/keepsake')
    const res = await persistKeepsake(img.url, {}, img.kind)
    useGame.setState((s) => ({
      gallery: s.gallery.map((g) =>
        g.id === img.id ? { ...g, saveState: res.status === 'local' ? 'persisted' : 'failed', localRef: res.ref ?? g.localRef } : g,
      ),
    }))
    if (res.status === 'local' && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('orbit-keepsake-updated', { detail: { id: img.id, url: img.url } }))
    }
  } finally {
    retryingKeepsakes.delete(img.id)
  }
}

/** Viewer media resolution: verified local bytes, or a diagnosable non-local
 *  state. `missing` is only set after a completed local lookup; a read or
 *  decrypt failure is `error`, never disguised as absence. */
type ViewerMedia =
  | { status: 'loading' }
  | { status: 'local'; url: string; media: 'image' | 'video' }
  | { status: 'missing' }
  | { status: 'error'; reason: string }

/** Local error state: bytes unavailable or unreadable, record kept, no remote
 *  redirect. Loading is its own state: an in-flight lookup must not be shown
 *  as "unavailable", and an unreadable vault row is never shown as missing. */
function KeepsakeErrorState({
  state,
  reason,
  onRetry,
}: {
  state: string
  reason?: string
  onRetry: () => void
}) {
  const unreadable = state === 'error'
  const title =
    state === 'pending'
      ? 'Caching the bytes…'
      : unreadable
        ? 'Local media could not be read'
        : 'Media unavailable locally'
  const detail = unreadable
    ? `The bytes are on this device but the local vault could not read them (${reason || 'unreadable'}). The record is kept.`
    : 'The saved bytes could not be found or recovered on this device. The record is kept — retry the download or re-import the media.'
  return (
    <div
      role="alert"
      className="flex max-h-[70vh] min-h-[240px] w-[320px] max-w-full flex-col items-center justify-center gap-2 rounded-lg border border-border-glass bg-black/60 p-6 text-center"
    >
      <span className="text-xs font-semibold text-retro-fg">{title}</span>
      {state !== 'pending' && (
        <span className="text-xs leading-relaxed text-retro-muted">{detail}</span>
      )}
      {state !== 'pending' && !unreadable && (
        <button
          type="button"
          onClick={onRetry}
          className="glass-action px-3 py-1.5 text-xs font-semibold rounded-lg cursor-pointer"
        >
          Retry download
        </button>
      )}
    </div>
  )
}

export interface IdleGalleryViewProps {
  onCreateCard?: (media: { url: string; tags: string[]; name: string }) => void
  onSetWallpaper?: (url: string, mime?: string) => void
  onRepostImage?: (media: { url: string; tags: string[]; name?: string; kind?: 'video' | 'image'; mimeType?: string }) => void
  onAddToStory?: (media: { url: string; tags: string[]; name?: string; kind?: 'video' | 'image'; mimeType?: string }) => void
}

/**
 * Keepsakes gallery: controls, tag pills, batch actions, slideshow,
 * pagination at 18 items max per page, and repost/story integration.
 */
export default function IdleGalleryView({
  onCreateCard,
  onSetWallpaper,
  onRepostImage,
  onAddToStory,
}: IdleGalleryViewProps) {
  const gallery = useGame((s) => s.gallery)
  const backgroundUrl = useGame((s) => s.backgroundUrl)
  const featureImage = useGame((s) => s.featureImage)
  const setBackground = useGame((s) => s.setBackground)
  const removeGalleryImage = useGame((s) => s.removeGalleryImage)

  // The context-menu bridge runs outside React's render, so it needs the latest
  // resolver without re-subscribing on every render.
  const forwardUrlRef = useRef<(img: GalleryImage) => string>(() => '')

  // Filters, search, sort, tags & pagination
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | 'image' | 'video'>('all')
  const [gallerySort, setGallerySort] = useState<'newest' | 'oldest' | 'rarity' | 'clicks'>('newest')
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set())
  const [page, setPage] = useState(0)

  // Selection & modal states
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [viewerId, setViewerId] = useState<string | null>(null)
  const [batchNotice, setBatchNotice] = useState<string | null>(null)
  const [showSlideshow, setShowSlideshow] = useState(false)
  const [slideshowItems, setSlideshowItems] = useState<ResolvedItem[]>([])
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const pinProgress = useVaultPinProgress()

  // Boot repair: sweep every keep that is not yet verified into the vault once
  // per session, so the offline data IS there when the network is not.
  const galleryRef = useRef(gallery)
  galleryRef.current = gallery
  useEffect(() => {
    void repairKeepsakeVault(galleryRef.current)
  }, [])

  // The shared media context menu asks; the gallery owns the bytes, so it runs
  // the action against its own store. Keeps this view free of a second dropdown.
  useEffect(() => {
    const onAction = (e: Event) => {
      const detail = (e as CustomEvent<GalleryActionDetail>).detail
      if (!detail?.keepsakeId) return
      const img = useGame.getState().gallery.find((g) => g.id === detail.keepsakeId)
      if (!img) return
      switch (detail.action) {
        case 'repost':
          onRepostImage?.({
            url: forwardUrlRef.current(img),
            tags: img.tags,
            name: img.tags.slice(0, 3).join(' ') || 'Keepsake',
            kind: img.kind,
            mimeType: img.kind === 'video' ? 'video/mp4' : undefined,
          })
          break
        case 'story':
          onAddToStory?.({
            url: forwardUrlRef.current(img),
            tags: img.tags,
            name: img.tags.slice(0, 3).join(' ') || 'Keepsake',
            kind: img.kind,
            mimeType: img.kind === 'video' ? 'video/mp4' : undefined,
          })
          break
        case 'card':
          onCreateCard?.({
            url: img.url,
            tags: img.tags.slice(0, 8),
            name: img.tags.slice(0, 3).join(' ') || 'Keepsake',
          })
          break
        case 'feature':
          featureImage(img.id)
          break
        case 'backdrop': {
          const url = forwardUrlRef.current(img)
          setBackground(url)
          onSetWallpaper?.(url, img.kind === 'video' ? 'video/mp4' : undefined)
          break
        }
        case 'delete':
          if (window.confirm('Delete this keepsake permanently?')) {
            removeGalleryImage(img.id)
            setViewerId((v) => (v === img.id ? null : v))
            setSelectedIds((prev) => {
              const next = new Set(prev)
              next.delete(img.id)
              return next
            })
          }
          break
      }
    }
    window.addEventListener(GALLERY_ACTION_EVENT, onAction)
    return () => window.removeEventListener(GALLERY_ACTION_EVENT, onAction)
  }, [onRepostImage, onAddToStory, onCreateCard, onSetWallpaper, setBackground, featureImage, removeGalleryImage])

  useEffect(() => {
    if (!openMenuId) return
    const handleOutside = () => setOpenMenuId(null)
    window.addEventListener('click', handleOutside)
    return () => window.removeEventListener('click', handleOutside)
  }, [openMenuId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedIds(new Set())
        setOpenMenuId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const baseFilteredGallery = useMemo(() => {
    const q = search.trim().toLowerCase()
    return gallery.filter((img) => {
      if (typeFilter === 'image' && img.kind === 'video') return false
      if (typeFilter === 'video' && img.kind !== 'video') return false
      if (q && !img.tags.some((t) => t.toLowerCase().includes(q)) && !img.id.toLowerCase().includes(q)) {
        return false
      }
      return true
    })
  }, [gallery, typeFilter, search])

  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of baseFilteredGallery) {
      if (Array.isArray(item.tags)) {
        for (const t of item.tags) counts.set(t, (counts.get(t) || 0) + 1)
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)
  }, [baseFilteredGallery])

  const toggleTag = (t: string) => {
    setActiveTags((prev) => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })
    setPage(0)
  }

  const tagFiltered = useMemo(() => {
    if (activeTags.size === 0) return baseFilteredGallery
    return baseFilteredGallery.filter((img) =>
      [...activeTags].every((t) => img.tags.includes(t))
    )
  }, [baseFilteredGallery, activeTags])

  const sortedGallery = useMemo(() => {
    const indexed = tagFiltered.map((item, originalIdx) => ({ item, originalIdx }))
    indexed.sort((a, b) => {
      if (gallerySort === 'oldest') {
        const timeA = a.item.boughtAt ?? a.originalIdx
        const timeB = b.item.boughtAt ?? b.originalIdx
        return timeA - timeB
      }
      if (gallerySort === 'rarity') {
        const scoreA = (RARITY_ORDER[a.item.rarity] || 0) * 1000 + (a.item.rarityBase || 0)
        const scoreB = (RARITY_ORDER[b.item.rarity] || 0) * 1000 + (b.item.rarityBase || 0)
        return scoreB - scoreA
      }
      if (gallerySort === 'clicks') {
        return (b.item.clicks || 0) - (a.item.clicks || 0)
      }
      // 'newest' default
      const timeA = a.item.boughtAt ?? a.originalIdx
      const timeB = b.item.boughtAt ?? b.originalIdx
      return timeB - timeA
    })
    return indexed.map((x) => x.item)
  }, [tagFiltered, gallerySort])

  const PAGE_SIZE = 18
  const totalPages = Math.max(1, Math.ceil(sortedGallery.length / PAGE_SIZE))
  const safePage = Math.min(page, Math.max(0, totalPages - 1))
  const paginatedGallery = useMemo(() => {
    return sortedGallery.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE)
  }, [sortedGallery, safePage])

  // Local vault (opt-in): render pinned bytes from disk instead of remote.
  const vaultUrls = useVaultUrls(paginatedGallery.map((g) => g.url))
  // Phase 5: local bytes from the swarm store (covers dev / vault-off).
  const localUrls = useKeepsakeLocalUrls(paginatedGallery, vaultUrls)
  // Viewer may sit outside the current page; resolve its url separately.
  const viewerVaultUrl = useVaultUrl(
    (viewerId && sortedGallery.find((g) => g.id === viewerId)?.url) || null,
  )

  // Resolve tile candidates for the current page, then convert any vault://
  // references to localhost http via useVaultHttpUrls (single hook call at
  // gallery level — never inside the .map() loop). Raw vault:// depends on
  // the Electron custom-scheme handler; localhost http works everywhere and
  // supports Range requests for <video> seek.
  //
  // useVaultHttpUrls is async (useEffect internally), so httpUrlMap starts
  // empty. While a vault:// reference is unresolved we return the vault://
  // reference itself (never an empty string, which would trigger a page
  // reload). The tile renderer decides whether to show a placeholder while
  // the reference is still pending.
  const tileUrlById = useMemo(
    () =>
      new Map(
        paginatedGallery.map((img) => [
          img.id,
          resolveGalleryTileUrl(img, vaultUrls[img.url || ''] || localUrls[img.url || '']),
        ]),
      ),
    [paginatedGallery, vaultUrls, localUrls],
  )
  const vaultTileUrls = [...tileUrlById.values()].filter((u): u is string =>
    u.startsWith('vault://'),
  )
  const httpUrlMap = useVaultHttpUrls(vaultTileUrls)
  const getTileUrl = (img: GalleryImage): string => {
    const raw = tileUrlById.get(img.id) || ''
    if (raw.startsWith('vault://')) return httpUrlMap[raw] || raw
    return raw
  }

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleBatchDownload = async () => {
    if (selectedIds.size === 0) return
    const targets = gallery.filter((img) => selectedIds.has(img.id))
    let skipped = 0
    const { resolveFreshLocalUrl, releaseLocalUrl } = await import('../../services/keepsake')
    for (const img of targets) {
      const ext = img.kind === 'video' ? 'mp4' : 'jpg'
      const name = `gallery-${img.id.slice(0, 8)}.${ext}`
      const fresh = await resolveFreshLocalUrl(img)
      try {
        const ok = fresh ? await downloadMedia(fresh, name) : false
        if (!ok) skipped += 1
      } finally {
        // The download consumed the bytes: release even when it failed.
        if (fresh) releaseLocalUrl(fresh)
      }
    }
    setBatchNotice(
      skipped > 0
        ? `${skipped} keepsake${skipped === 1 ? '' : 's'} have no local bytes yet — open and retry first.`
        : null,
    )
  }

  const handleBatchDelete = () => {
    if (selectedIds.size === 0) return
    if (window.confirm(`Delete ${selectedIds.size} images permanently from the gallery?`)) {
      for (const id of selectedIds) {
        removeGalleryImage(id)
      }
      setSelectedIds(new Set())
    }
  }

  // Local-only resolution for the open viewer (vault + IDB blob, never remote).
  // Placed before the empty-gallery early return: hooks cannot be conditional.
  const viewerItem = viewerId ? sortedGallery.find((g) => g.id === viewerId) ?? null : null
  const viewerLocal: KeepsakeLocal | null = useMemo(() => {
    if (!viewerItem) return null
    const vUrl = viewerItem.url || ''
    const merged: Record<string, string> = { ...vaultUrls }
    // useVaultUrl falls back to the INPUT url while unresolved: only a
    // DIFFERENT string is a verified mapping. Merging the self-fallback
    // would shadow the real IDB blob with the remote URL.
    if (vUrl && viewerVaultUrl && viewerVaultUrl !== vUrl && !merged[vUrl]) {
      merged[vUrl] = viewerVaultUrl
    }
    return resolveKeepsakeLocal(viewerItem, merged, localUrls)
  }, [viewerItem, vaultUrls, localUrls, viewerVaultUrl])

  // Async resolution for the open viewer: the page-level maps cover the common
  // case (a keep already resolved by url), but a keep whose source url drifted
  // (host / API-base change) or whose bytes are addressable only by content
  // hash needs a fresh lookup. The viewer must never call bytes "unavailable"
  // while a resolution attempt is still owed, and a read or decrypt failure is
  // reported as such, never as a missing file.
  const [viewerProbe, setViewerProbe] = useState<{ id: string; media: ViewerMedia } | null>(null)
  useEffect(() => {
    if (!viewerItem || viewerLocal?.kind === 'local') return
    const id = viewerItem.id
    let dead = false
    let held: string | null = null
    setViewerProbe({ id, media: { status: 'loading' } })
    void (async () => {
      const r = await resolveLocalMedia(viewerItem)
      if (r.state === 'local') {
        const blob = r.url.startsWith('blob:')
        if (dead) {
          if (blob) releaseLocalUrl(r.url)
          return
        }
        // A mounted <video> keeps streaming: claim the URL so the cap cannot
        // reap it mid-seek. Released when the viewer switches or unmounts.
        if (blob) {
          retainLocalUrl(r.url)
          held = r.url
        }
        setViewerProbe({
          id,
          media: { status: 'local', url: r.url, media: viewerItem.kind === 'video' ? 'video' : 'image' },
        })
        return
      }
      if (dead) return
      setViewerProbe({
        id,
        media: r.state === 'unreadable' ? { status: 'error', reason: r.reason } : { status: 'missing' },
      })
    })()
    return () => {
      dead = true
      if (held) releaseLocalUrl(held)
    }
  }, [viewerItem, viewerLocal])

  const viewerResolved: ViewerMedia =
    viewerLocal?.kind === 'local'
      ? { status: 'local', url: viewerLocal.url, media: viewerLocal.media }
      : viewerProbe && viewerItem && viewerProbe.id === viewerItem.id
        ? viewerProbe.media
        : { status: 'loading' }
  const viewerLocalUrl = viewerResolved.status === 'local' ? viewerResolved.url : null

  // Legacy recovery: only after the fresh lookup CONFIRMED no local bytes does
  // a viewer without verified bytes attempt the authorized persist pipeline
  // once. Failure keeps the record (and any existing localRef); nothing is
  // silently discarded or re-imported while bytes might still be local.
  const recoveryTried = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!viewerItem || viewerResolved.status !== 'missing') return
    if (viewerLocal?.kind !== 'missing' || !viewerLocal.legacy) return
    if (recoveryTried.current.has(viewerItem.id)) return
    recoveryTried.current.add(viewerItem.id)
    const target = viewerItem
    void (async () => {
      const { persistKeepsake } = await import('../../services/keepsake')
      const res = await persistKeepsake(target.url, {}, target.kind)
      useGame.setState((s) => ({
        gallery: s.gallery.map((g) =>
          g.id === target.id
            ? { ...g, saveState: res.status === 'local' ? 'persisted' : 'failed', localRef: res.ref ?? g.localRef }
            : g,
        ),
      }))
    })()
  }, [viewerItem, viewerResolved, viewerLocal])

  // Forwarding (repost/story/forge) prefers verified local bytes; the remote
  // URL survives only as import provenance for the controlled forge pipeline
  // (which re-downloads + validates), never as a render source.
  const forwardUrl = (img: GalleryImage): string => {
    const r = resolveKeepsakeLocal(img, vaultUrls, localUrls)
    return r.kind === 'local' ? r.url : img.url
  }
  forwardUrlRef.current = forwardUrl

  // Cross-surface open: the context menu dispatches this for keepsake tiles so
  // "Open in New Tab" resolves local bytes instead of the raw <img> src.
  // Resolution is fresh at action time (vault + object store), so background
  // map timing can never gate or poison the open.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const id = (e as CustomEvent<{ keepsakeId?: string }>).detail?.keepsakeId
      if (!id) return
      const img = useGame.getState().gallery.find((g) => g.id === id)
      if (!img) return
      void (async () => {
        const { resolveFreshLocalUrl, retainLocalUrl } = await import('../../services/keepsake')
        const url = await resolveFreshLocalUrl(img)
        if (url) {
          // The new tab owns it now: claim it so the cap never reaps it while
          // the tab is still fetching/seeking.
          retainLocalUrl(url)
          window.open(url, '_blank', 'noopener,noreferrer')
        }
      })()
    }
    window.addEventListener('gmatch:open-keepsake', onOpen)
    return () => window.removeEventListener('gmatch:open-keepsake', onOpen)
  }, [])

  if (gallery.length === 0) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto p-3.5">
        <EmptyState
          icon={ImageIcon}
          title="No keepsakes yet"
          description="Drain feed images to keep them here."
        />
      </div>
    )
  }

  const viewerIdx = viewerId ? sortedGallery.findIndex((g) => g.id === viewerId) : -1
  const viewer = viewerIdx >= 0 ? sortedGallery[viewerIdx] : null
  const stepViewer = (dir: 1 | -1) => {
    if (sortedGallery.length === 0) return
    const next = ((viewerIdx < 0 ? 0 : viewerIdx) + dir + sortedGallery.length) % sortedGallery.length
    setViewerId(sortedGallery[next].id)
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {/* Header Toolbar */}
      <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-3 border-b border-border-glass">
        <Title>
          Gallery ({gallery.length})
        </Title>

        <div className="flex items-center gap-2 flex-wrap text-xs">
          <select
            value={gallerySort}
            onChange={(e) => {
              setGallerySort(e.target.value as any)
              setPage(0)
            }}
            aria-label="Sort gallery"
            className="bg-glass-w5 border border-border-glass rounded-lg px-2 py-1.5 text-xs text-retro-fg outline-none cursor-pointer"
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="rarity">Rarity</option>
            <option value="clicks">Clicks</option>
          </select>

          <div className="flex items-center gap-1.5 bg-glass-w5 border border-border-glass rounded-lg px-2 py-1.5">
            <Search className="w-3.5 h-3.5 text-retro-muted" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(0)
              }}
              placeholder="Filter gallery…"
              aria-label="Filter gallery"
              className="bg-transparent text-retro-fg text-xs outline-none placeholder:text-retro-muted w-24 sm:w-32"
            />
          </div>

          <Tabs
            tabs={[{ id: 'all' as const, label: 'All' }, { id: 'image' as const, label: 'Images' }, { id: 'video' as const, label: 'Videos' }]}
            value={typeFilter}
            onChange={(t) => {
              setTypeFilter(t)
              setPage(0)
            }}
          />

          <Button
            size="sm"
            onClick={() => {
              if (sortedGallery.length > 0) {
                const { items, skipped } = toLocalSlideshowItems(sortedGallery, vaultUrls, localUrls)
                if (items.length === 0) {
                  setBatchNotice('Nothing local to play yet — keepsakes without cached bytes are skipped.')
                  return
                }
                if (skipped > 0) {
                  setBatchNotice(`${skipped} keepsake${skipped === 1 ? '' : 's'} skipped (no local bytes).`)
                }
                setSlideshowItems(items)
                setShowSlideshow(true)
              }
            }}
            disabled={sortedGallery.length === 0}
            title="Play slideshow of current items"
          >
            <Film className="w-3.5 h-3.5" />
            <span>Slideshow</span>
          </Button>
        </div>
      </div>

      {/* Batch Action Bar */}
      {selectedIds.size > 0 && (
        <div className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs animate-orbit-fade-in border-t border-border-glass">
          <div className="flex items-center gap-2 text-retro-fg font-semibold">
            <CheckSquare className="w-4 h-4 text-success-fg" />
            <span>{selectedIds.size} selected</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant="primary" onClick={handleBatchDownload}>
              <Download className="w-3.5 h-3.5" />
              <span>Download</span>
            </Button>
            <Button
              size="sm"
              onClick={() => {
                const selectedItems = gallery.filter((i) => selectedIds.has(i.id))
                if (selectedItems.length > 0) {
                  const { items, skipped } = toLocalSlideshowItems(selectedItems, vaultUrls, localUrls)
                  if (items.length === 0) {
                    setBatchNotice('Nothing local to play yet — keepsakes without cached bytes are skipped.')
                    return
                  }
                  if (skipped > 0) {
                    setBatchNotice(`${skipped} keepsake${skipped === 1 ? '' : 's'} skipped (no local bytes).`)
                  }
                  setSlideshowItems(items)
                  setShowSlideshow(true)
                }
              }}
            >
              <Film className="w-3.5 h-3.5" />
              <span>Slideshow</span>
            </Button>
            <Button size="sm" variant="danger" onClick={handleBatchDelete}>
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete</span>
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
              Clear
            </Button>
          </div>
          {batchNotice && (
            <div className="px-4 pb-1 text-xs text-warning-fg" role="status">
              {batchNotice}
            </div>
          )}
        </div>
      )}

      {batchNotice && selectedIds.size === 0 && (
        <div className="px-4 pt-1 text-xs text-warning-fg" role="status">
          {batchNotice}
        </div>
      )}

      {/* Tag pills */}
      {tagCounts.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-4 pt-3 pb-1">
          <Tag className="w-3.5 h-3.5 text-retro-muted" />
          {tagCounts.map(([t, n]) => (
            <button
              key={t}
              type="button"
              onClick={() => toggleTag(t)}
              aria-pressed={activeTags.has(t)}
              className={`px-2 py-0.5 rounded-full text-2xs font-semibold border cursor-pointer transition-colors ${
                activeTags.has(t)
                  ? 'bg-glass-w20 border-retro-fg/70 text-retro-fg'
                  : 'border-border-glass text-retro-muted hover:text-retro-body'
              }`}
            >
              {t} <span className="opacity-60">{n}</span>
            </button>
          ))}
          {activeTags.size > 0 && (
            <button
              type="button"
              onClick={() => {
                setActiveTags(new Set())
                setPage(0)
              }}
              className="text-2xs text-retro-muted hover:text-retro-fg cursor-pointer underline ml-1"
            >
              clear ({activeTags.size})
            </button>
          )}
        </div>
      )}

      {backgroundUrl && (
        <div className="mx-4 my-2 flex items-center gap-2.5 rounded-[10px] border border-border-glass bg-retro-bg px-3 py-1.5 text-xs text-retro-muted">
          <span>App backdrop is active</span>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setBackground(null)} title="Remove the app backdrop">
            <IconX size={12} /> Clear
          </Button>
        </div>
      )}

      {sortedGallery.length === 0 ? (
        <div className="p-4">
          <EmptyState
            icon={Search}
            title="No keepsakes match filter"
            description="No images match your search and tag criteria. Try clearing tags or filters."
            action={
              <Button size="sm" onClick={() => {
                setSearch('')
                setTypeFilter('all')
                setActiveTags(new Set())
                setPage(0)
              }}>
                Clear filter
              </Button>
            }
          />
        </div>
      ) : (
        <div className="p-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {paginatedGallery.map((img) => {
              const isBackdrop = backgroundUrl === img.url
              const isMotion = img.kind === 'video'
              const isSelected = selectedIds.has(img.id)
              const tileUrl = getTileUrl(img)
              // A record that CLAIMS persisted bytes but whose lookup finished
              // with nothing (evicted vault / cleared object store / unreadable
              // row) must say so and offer a retry — the tile used to render a
              // silent placeholder while the viewer said "unavailable".
              const missingLocal =
                img.saveState === 'persisted' &&
                !vaultUrls[img.url || ''] &&
                !localUrls[img.url || ''] &&
                vaultLookupSettled(img.url || '') &&
                keepsakeLocalSettled(img.localRef || img.url)

              return (
                <div
                  key={img.id}
                  draggable
                  title="Drag into Card Forge (or click Card) to make a card"
                  onDragStart={(e) => {
                    e.dataTransfer.setData(
                      DND_KEEPSAKE,
                      JSON.stringify({
                        url: img.url,
                        tags: img.tags,
                        name: img.tags.slice(0, 3).join(' ') || 'Keepsake',
                      })
                    )
                    e.dataTransfer.effectAllowed = 'copy'
                  }}
                  className={`group relative aspect-square rounded-[10px] border bg-retro-bg shadow-[0_4px_10px_rgba(0,0,0,0.5)] cursor-grab active:cursor-grabbing ${
                    openMenuId === img.id ? 'z-30' : 'overflow-hidden'
                  } ${
                    isSelected
                      ? 'border-success ring-2 ring-success/0'
                      : isBackdrop
                      ? 'border-retro-accent'
                      : 'border-border-glass'
                  }`}
                >
                  {/* Top-left Select Checkbox */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleSelect(img.id)
                    }}
                    aria-label={isSelected ? 'Deselect image' : 'Select image'}
                    className={`absolute left-1.5 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-md backdrop-blur-md transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-success/0 text-retro-fg opacity-100 shadow-md ring-1 ring-white/30'
                        : 'bg-black/60 text-retro-fg/70 opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
                    }`}
                  >
                    {isSelected ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
                  </button>

                  {/* Thumbnail click to view */}
                  <button
                    type="button"
                    className="block h-full w-full cursor-pointer border-0 bg-transparent p-0"
                    title="View keepsake"
                    aria-label={`View ${img.tags.slice(0, 2).join(' ') || 'keepsake'}`}
                    onClick={(e) => {
                      if (e.shiftKey || e.ctrlKey || e.metaKey) {
                        toggleSelect(img.id)
                        return
                      }
                      setViewerId(img.id)
                    }}
                  >
                    {isMotion ? (
                      <video
                        className="block h-full w-full object-cover"
                        // Never assign src="": an unresolved vault:// reference
                        // (or an empty candidate) omits the attribute entirely,
                        // so the browser never re-requests the whole page.
                        src={tileUrl && !tileUrl.startsWith('vault://') ? tileUrl : httpUrlMap[tileUrl] || undefined}
                        poster={img.preview || undefined}
                        muted
                        preload="metadata"
                        playsInline
                        data-keepsake-id={img.id}
                      />
                    ) : (
                      <CachedImg
                        className="block h-full w-full object-cover"
                        src={tileUrl && !tileUrl.startsWith('vault://') ? tileUrl : httpUrlMap[tileUrl] || offlineSvg(img.tags)}
                        fallbackSrc={offlineSvg(img.tags)}
                        alt={img.tags.slice(0, 3).join(' ') || 'gallery image'}
                        referrerPolicy="no-referrer"
                        loading="lazy"
                        data-keepsake-id={img.id}
                      />
                    )}
                  </button>

                  {/* Phase 5: local-cache status — never imply a keep is saved
                      when its bytes are not locally stored. */}
                  {img.saveState === 'downloading' && (
                    <span className="pointer-events-none absolute bottom-1.5 left-1.5 z-20 rounded-md bg-black/70 px-1.5 py-0.5 text-2xs font-mono text-retro-fg/80 backdrop-blur-md">
                      Caching…{pinProgress[img.url] != null ? ` ${pinProgress[img.url]}%` : ''}
                    </span>
                  )}
                  {img.saveState === 'failed' && (
                    <button
                      type="button"
                      onClick={async (e) => {
                        e.stopPropagation()
                        await retryKeepsake(img)
                      }}
                      title="Could not cache this keep locally. The source link is kept for a retry."
                      className="absolute bottom-1.5 left-1.5 z-20 rounded-md border border-danger/0 bg-black/75 px-1.5 py-0.5 text-2xs font-mono text-danger-fg backdrop-blur-md cursor-pointer hover:bg-black/90"
                    >
                      Not cached · Retry
                    </button>
                  )}
                  {missingLocal && img.saveState !== 'failed' && (
                    <button
                      type="button"
                      onClick={async (e) => {
                        e.stopPropagation()
                        await retryKeepsake(img)
                      }}
                      title="This keep was saved but its local bytes are no longer readable. Retry to fetch them again."
                      className="absolute bottom-1.5 left-1.5 z-20 rounded-md border border-warning/0 bg-black/75 px-1.5 py-0.5 text-2xs font-mono text-warning-fg backdrop-blur-md cursor-pointer hover:bg-black/90"
                    >
                      Missing locally · Retry
                    </button>
                  )}
                </div>
              )
            })}
          </div>

          {/* Pagination and Select All on Page Footer */}
          <div className="flex items-center justify-between pt-3 border-t border-border-glass/80 mt-4 text-xs">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                const pageIds = paginatedGallery.map((i) => i.id)
                const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id))
                setSelectedIds((prev) => {
                  const next = new Set(prev)
                  if (allSelected) {
                    pageIds.forEach((id) => next.delete(id))
                  } else {
                    pageIds.forEach((id) => next.add(id))
                  }
                  return next
                })
              }}
            >
              {paginatedGallery.length > 0 && paginatedGallery.every((i) => selectedIds.has(i.id))
                ? 'Deselect all on page'
                : 'Select all on page'}
            </Button>

            {totalPages > 1 && (
              <div className="flex items-center gap-2 text-xs">
                <Button
                  size="sm"
                  disabled={safePage === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  ← Prev
                </Button>
                <span className="text-retro-muted font-mono text-xs">
                  Page <strong className="text-retro-fg">{safePage + 1}</strong> of {totalPages}
                </span>
                <Button
                  size="sm"
                  disabled={safePage >= totalPages - 1}
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                >
                  Next →
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Viewer Modal */}
      {viewer && (
        <MediaViewerModal onClose={() => setViewerId(null)} label="Keepsake viewer">
          <figure className="relative flex max-h-[80vh] min-h-0 w-auto max-w-full flex-col items-center">
            <div className="relative min-h-0 w-auto max-w-full" data-keepsake-id={viewer.id}>
              {viewerResolved.status === 'local' ? (
                viewerResolved.media === 'video' ? (
                  <NativeVideoPlayer
                    src={viewerResolved.url}
                    poster={viewer.preview || undefined}
                    className="max-h-[70vh] w-auto max-w-full rounded-lg"
                    videoClassName="max-h-[70vh] w-auto max-w-full rounded-lg object-contain"
                    controls
                    autoPlay
                    muted={false}
                    loop
                    playsInline
                  />
                ) : (
                  <img
                    src={viewerResolved.url}
                    alt={viewer.tags.slice(0, 3).join(' ') || 'keepsake'}
                    className="max-h-[70vh] w-auto max-w-full rounded-lg object-contain"
                    referrerPolicy="no-referrer"
                  />
                )
              ) : (
                <KeepsakeErrorState
                  state={
                    viewerResolved.status === 'error'
                      ? 'error'
                      : viewerResolved.status === 'loading'
                        ? 'pending'
                        : viewerLocal?.kind === 'failed'
                          ? 'failed'
                          : 'missing'
                  }
                  reason={viewerResolved.status === 'error' ? viewerResolved.reason : undefined}
                  onRetry={() => void retryKeepsake(viewer)}
                />
              )}
              {sortedGallery.length > 1 && (
                <>
                  <button
                    type="button"
                    aria-label="Previous keepsake"
                    title="Previous"
                    className="absolute left-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border-0 bg-black/60 p-0 text-retro-fg/90 backdrop-blur-sm transition-colors hover:bg-black/85 hover:text-retro-fg"
                    onClick={(e) => {
                      e.stopPropagation()
                      stepViewer(-1)
                    }}
                  >
                    <IconChevronL size={18} />
                  </button>
                  <button
                    type="button"
                    aria-label="Next keepsake"
                    title="Next"
                    className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border-0 bg-black/60 p-0 text-retro-fg/90 backdrop-blur-sm transition-colors hover:bg-black/85 hover:text-retro-fg"
                    onClick={(e) => {
                      e.stopPropagation()
                      stepViewer(1)
                    }}
                  >
                    <IconChevronR size={18} />
                  </button>
                </>
              )}
            </div>
            <figcaption className={`${MUTED} mt-2 max-w-full truncate text-center text-xs`}>
              {viewer.tags.slice(0, 5).join(' ') || 'keepsake'}
              {sortedGallery.length > 1 ? ` · ${viewerIdx + 1}/${sortedGallery.length}` : ''}
            </figcaption>

            {/* Viewer Action Bar */}
            <div className="mt-3 flex items-center justify-center gap-2 flex-wrap">
              {onRepostImage && (
                <Button
                  size="sm"
                  onClick={() =>
                    onRepostImage({
                      url: viewerLocalUrl ?? viewer.url,
                      tags: viewer.tags,
                      name: viewer.tags.slice(0, 3).join(' ') || 'Keepsake',
                      kind: viewer.kind,
                      mimeType: viewer.kind === 'video' ? 'video/mp4' : undefined,
                    })
                  }
                  title="Repost to feed"
                >
                  <Repeat className="w-3.5 h-3.5" />
                  <span>Repost</span>
                </Button>
              )}
              {onAddToStory && (
                <Button
                  size="sm"
                  onClick={() =>
                    onAddToStory({
                      url: viewerLocalUrl ?? viewer.url,
                      tags: viewer.tags,
                      name: viewer.tags.slice(0, 3).join(' ') || 'Keepsake',
                      kind: viewer.kind,
                      mimeType: viewer.kind === 'video' ? 'video/mp4' : undefined,
                    })
                  }
                  title="Add to story"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Story</span>
                </Button>
              )}
              {onCreateCard && (
                <Button
                  size="sm"
                  onClick={() =>
                    onCreateCard({
                      url:
                        viewer.kind === 'video' && viewer.url.includes('redgifs')
                          ? redgifsPlayable(viewer.url)
                          : viewer.url,
                      tags: viewer.tags.slice(0, 8),
                      name: viewer.tags.slice(0, 3).join(' ') || 'Keepsake',
                    })
                  }
                  title="Turn into card"
                >
                  <ImagePlus className="w-3.5 h-3.5" />
                  <span>Card</span>
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => {
                  // Local-only: download from freshly verified bytes.
                  if (!viewer) return
                  void (async () => {
                    const { resolveFreshLocalUrl, releaseLocalUrl } = await import('../../services/keepsake')
                    const fresh = await resolveFreshLocalUrl(viewer)
                    if (!fresh) return
                    const ext = viewer.kind === 'video' ? 'mp4' : 'jpg'
                    try {
                      await downloadMedia(fresh, `keepsake-${viewer.id.slice(0, 8)}.${ext}`)
                    } finally {
                      // Consumer is done either way: nothing else needs the URL.
                      releaseLocalUrl(fresh)
                    }
                  })()
                }}
                disabled={!viewerLocalUrl}
                title={viewerLocalUrl ? 'Download media' : 'Download needs local bytes first'}
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download</span>
              </Button>
              <Button
                size="sm"
                onClick={async () => {
                  // Local-only: the vault localhost URL in Electron, the
                  // verified blob URL in dev. Never the provider URL.
                  // Re-resolved fresh at click time (not from background maps).
                  if (!viewer) return
                  const { resolveFreshLocalUrl, releaseLocalUrl, retainLocalUrl } = await import('../../services/keepsake')
                  const fresh = await resolveFreshLocalUrl(viewer)
                  if (!fresh) return
                  const bridge = (window as unknown as { gmatch?: { openExternal?: (u: string) => void; vaultHttpUrl?: (u: string) => Promise<{ local: string | null }> } }).gmatch
                  if (bridge?.vaultHttpUrl) {
                    const res = await bridge.vaultHttpUrl(viewer.url).catch(() => null)
                    const dest = res?.local
                    if (dest && /^https?:\/\//.test(dest)) {
                      // The vault loopback URL wins: the minted blob (if any)
                      // is unused, so release it instead of leaking it.
                      if (fresh.startsWith('blob:')) releaseLocalUrl(fresh)
                      if (bridge.openExternal) {
                        void bridge.openExternal(dest)
                      } else {
                        window.open(dest, '_blank', 'noopener,noreferrer')
                      }
                      return
                    }
                  }
                  // Verified blob URL (dev / IDB bytes): the tab keeps using it.
                  if (fresh.startsWith('blob:')) {
                    retainLocalUrl(fresh)
                    window.open(fresh, '_blank', 'noopener,noreferrer')
                  }
                }}
                disabled={!viewerLocalUrl}
                title={viewerLocalUrl ? 'Open in browser' : 'Open needs local bytes first'}
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Browser</span>
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setBackground(viewer.url)
                  onSetWallpaper?.(viewer.url, viewer.kind === 'video' ? 'video/mp4' : undefined)
                }}
                title="Set as app backdrop"
              >
                <IconWallpaper size={13} />
                <span>Backdrop</span>
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  if (window.confirm('Delete this keepsake permanently?')) {
                    removeGalleryImage(viewer.id)
                    setViewerId(null)
                    setSelectedIds((prev) => {
                      const next = new Set(prev)
                      next.delete(viewer.id)
                      return next
                    })
                  }
                }}
                title="Delete keepsake"
              >
                <IconTrash size={13} />
                <span>Delete</span>
              </Button>
            </div>
          </figure>
        </MediaViewerModal>
      )}

      {/* Slideshow Player */}
      {showSlideshow && (
        <SlideshowPlayer
          items={slideshowItems}
          intervalMs={3500}
          identity={null}
          onClose={() => setShowSlideshow(false)}
        />
      )}
    </div>
  )
}
