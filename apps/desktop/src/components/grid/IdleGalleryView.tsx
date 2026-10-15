import { useState, useMemo, useEffect } from 'react'
import { useGame } from '../../game/store'
import type { GalleryImage } from '../../game/types'
import { IconTrash, IconWallpaper, IconX, IconRefresh, IconChevronL, IconChevronR } from '../../ui/icons'
import { DND_KEEPSAKE } from '../DropZone'
import { offlineSvg } from '../../services/offlineSvg'
import { redgifsPlayable } from '../../services/redgifs'
import CachedImg from '../../ui/CachedImg'
import MediaViewerModal from '../../ui/MediaViewerModal'
import { EmptyState } from '../EmptyState'
import { useVaultUrls, useVaultUrl, vaultHttpUrl } from '../../services/vault'
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
  MoreVertical,
  ExternalLink,
} from 'lucide-react'
import { MUTED } from '../../ui/styles'

const HOVER_BTN =
  'glass-button absolute flex cursor-pointer items-center justify-center rounded-lg p-0 opacity-0 focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100'

const RARITY_ORDER: Record<string, number> = {
  Common: 1,
  Copper: 2,
  Silver: 3,
  Gold: 4,
  Diamond: 5,
}

async function downloadMedia(url: string, filename: string) {
  try {
    const res = await fetch(url)
    if (res.ok) {
      const blob = await res.blob()
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(blobUrl)
      return
    }
  } catch {
    // direct fallback if blob fetch fails
  }
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.target = '_blank'
  a.rel = 'noopener noreferrer'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

function toResolvedItems(images: GalleryImage[]): ResolvedItem[] {
  return images.map((img) => ({
    object_id: null,
    url: img.url,
    caption: img.tags.slice(0, 5).join(' ') || 'Keepsake',
    mime_type: img.kind === 'video' ? 'video/mp4' : 'image/jpeg',
  }))
}

/**
 * Fast thumbnail resolution for gallery grid tiles:
 * 1. Pinned local vault SSD URL if ready (vault://)
 * 2. Verified local reference stored on the record itself (localRef)
 * 3. Pre-computed preview thumbnail if available
 * 4. Inferred thumbnail for known hosts (booru.org, realbooru) to avoid multi-MB full PNG/JPEG stalls
 * 5. Full image URL fallback — legacy records (no saveState) and explicitly
 *    failed saves only; a record marked `persisted` never falls back here,
 *    because its bytes are supposed to be on disk and a hotlink would hide a
 *    broken vault entry.
 */
export function resolveGalleryTileUrl(img: GalleryImage, vaultUrl?: string): string {
  if (vaultUrl) return vaultUrl
  if (img.localRef) return img.localRef
  if (img.saveState === 'persisted') return '' // local bytes claimed, none resolvable
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

  // Filters, search, sort, tags & pagination
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | 'image' | 'video'>('all')
  const [gallerySort, setGallerySort] = useState<'newest' | 'oldest' | 'rarity' | 'clicks'>('newest')
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set())
  const [page, setPage] = useState(0)

  // Selection & modal states
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [viewerId, setViewerId] = useState<string | null>(null)
  const [showSlideshow, setShowSlideshow] = useState(false)
  const [slideshowItems, setSlideshowItems] = useState<ResolvedItem[]>([])
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)

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
  // Viewer may sit outside the current page; resolve its url separately.
  const viewerVaultUrl = useVaultUrl(
    (viewerId && sortedGallery.find((g) => g.id === viewerId)?.url) || null,
  )

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
    for (const img of targets) {
      const ext = img.kind === 'video' ? 'mp4' : 'jpg'
      const name = `gallery-${img.id.slice(0, 8)}.${ext}`
      await downloadMedia(img.url, name)
    }
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
      <div className="glass-header p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="glass-inset w-7 h-7 rounded-lg flex items-center justify-center text-retro-muted">
            <ImageIcon className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-xs font-bold text-retro-fg uppercase tracking-wider">
              Gallery ({gallery.length})
            </h2>
            <p className="text-[10px] text-retro-muted">Drained images, booru captures, and idle keepsakes</p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap text-xs">
          <div className="glass-field flex items-center gap-1 px-2 py-1 text-xs">
            <span className="text-retro-muted font-semibold text-[10px] uppercase tracking-wider">Sort:</span>
            <select
              value={gallerySort}
              onChange={(e) => {
                setGallerySort(e.target.value as any)
                setPage(0)
              }}
              className="bg-transparent text-retro-body text-xs font-semibold outline-none cursor-pointer"
            >
              <option value="newest" className="bg-surface-raised text-retro-body">Newest</option>
              <option value="oldest" className="bg-surface-raised text-retro-body">Oldest</option>
              <option value="rarity" className="bg-surface-raised text-retro-body">Rarity</option>
              <option value="clicks" className="bg-surface-raised text-retro-body">Clicks</option>
            </select>
          </div>

          <div className="glass-field flex items-center gap-1 px-2 py-1 text-xs">
            <Search className="w-3.5 h-3.5 text-retro-muted" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(0)
              }}
              placeholder="Filter gallery…"
              className="bg-transparent text-retro-body text-xs font-semibold outline-none placeholder:text-retro-muted w-24 sm:w-32"
            />
          </div>

          <div className="glass-inset flex p-0.5 rounded-lg text-xs font-semibold">
            {(['all', 'image', 'video'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setTypeFilter(t)
                  setPage(0)
                }}
                // The bare word "all" was an ambiguous accessible name — the
                // audit found two controls on the gallery reading "all" and
                // nothing to tell a screen-reader user which was which.
                aria-label={`Filter: ${t}`}
                aria-pressed={typeFilter === t}
                className={`px-2.5 py-1 rounded-md cursor-pointer uppercase tracking-wider transition-colors ${
                  typeFilter === t ? 'bg-glass-w12 text-retro-fg font-bold shadow-sm' : 'text-retro-muted hover:text-retro-body'
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => {
              if (sortedGallery.length > 0) {
                setSlideshowItems(toResolvedItems(sortedGallery))
                setShowSlideshow(true)
              }
            }}
            disabled={sortedGallery.length === 0}
            className="glass-action px-3 py-1 rounded-lg font-semibold text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
            title="Play slideshow of current items"
          >
            <Film className="w-3.5 h-3.5" />
            <span>Slideshow</span>
          </button>
        </div>
      </div>

      {/* Batch Action Bar */}
      {selectedIds.size > 0 && (
        <div className="glass-header px-4 py-2.5 flex items-center justify-between gap-3 text-xs animate-orbit-fade-in border-t border-border-glass">
          <div className="flex items-center gap-2 text-retro-fg font-bold">
            <CheckSquare className="w-4 h-4 text-emerald-600" />
            <span>{selectedIds.size} images selected</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={handleBatchDownload}
              className="glass-action glass-action-primary px-3 py-1.5 rounded-lg font-bold text-xs cursor-pointer flex items-center gap-1"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download Selected</span>
            </button>
            <button
              type="button"
              onClick={() => {
                const selectedItems = gallery.filter((i) => selectedIds.has(i.id))
                if (selectedItems.length > 0) {
                  setSlideshowItems(toResolvedItems(selectedItems))
                  setShowSlideshow(true)
                }
              }}
              className="glass-action px-3 py-1.5 rounded-lg font-bold text-xs cursor-pointer flex items-center gap-1"
            >
              <Film className="w-3.5 h-3.5" />
              <span>Slideshow</span>
            </button>
            <button
              type="button"
              onClick={handleBatchDelete}
              className="glass-action glass-action-danger px-3 py-1.5 rounded-lg font-bold text-xs cursor-pointer flex items-center gap-1"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete</span>
            </button>
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="text-xs text-retro-muted hover:text-retro-body px-2 py-1 cursor-pointer"
            >
              Clear
            </button>
          </div>
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
              className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border cursor-pointer transition-colors ${
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
              className="text-[10px] text-retro-muted hover:text-retro-fg cursor-pointer underline ml-1"
            >
              clear ({activeTags.size})
            </button>
          )}
        </div>
      )}

      {backgroundUrl && (
        <div className="mx-4 my-2 flex items-center gap-2.5 rounded-[10px] border border-border-glass bg-retro-bg px-3 py-1.5 text-xs text-retro-muted">
          <span>App backdrop is active</span>
          <button
            type="button"
            className="glass-action px-2 py-0.5 text-xs font-semibold rounded-md flex items-center gap-1 cursor-pointer ml-auto"
            onClick={() => setBackground(null)}
            title="Remove the app backdrop"
          >
            <IconX size={12} /> Clear
          </button>
        </div>
      )}

      {sortedGallery.length === 0 ? (
        <div className="p-4">
          <EmptyState
            icon={Search}
            title="No keepsakes match filter"
            description="No images match your search and tag criteria. Try clearing tags or filters."
            action={
              <button
                type="button"
                className="glass-action px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer"
                onClick={() => {
                  setSearch('')
                  setTypeFilter('all')
                  setActiveTags(new Set())
                  setPage(0)
                }}
              >
                Clear filter
              </button>
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
              const tileUrl = resolveGalleryTileUrl(img, vaultUrls[img.url || ''])

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
                  className={`group relative aspect-square rounded-[10px] border bg-black shadow-[0_4px_10px_rgba(0,0,0,0.5)] cursor-grab active:cursor-grabbing ${
                    openMenuId === img.id ? 'z-30' : 'overflow-hidden'
                  } ${
                    isSelected
                      ? 'border-emerald-500 ring-2 ring-emerald-500/40'
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
                        ? 'bg-emerald-600/90 text-white opacity-100 shadow-md ring-1 ring-white/30'
                        : 'bg-black/60 text-white/70 opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
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
                        src={tileUrl}
                        poster={img.preview || undefined}
                        muted
                        preload="metadata"
                        playsInline
                      />
                    ) : (
                      <CachedImg
                        className="block h-full w-full object-cover"
                        src={tileUrl || offlineSvg(img.tags)}
                        fallbackSrc={offlineSvg(img.tags)}
                        alt={img.tags.slice(0, 3).join(' ') || 'gallery image'}
                        referrerPolicy="no-referrer"
                        loading="lazy"
                      />
                    )}
                  </button>

                  {/* Top-right More Options Menu Button & Dropdown */}
                  <div className="absolute right-1.5 top-1.5 z-20">
                    <button
                      type="button"
                      className={`${HOVER_BTN} ${
                        openMenuId === img.id ? '!opacity-100 ring-1 ring-white/30' : ''
                      } relative right-auto top-auto h-6 w-6 rounded-md bg-black/75 hover:bg-black/90 text-white/80 hover:text-white border border-white/10 shadow-md backdrop-blur-md cursor-pointer transition-all`}
                      title="More options"
                      aria-label={`Options for ${img.tags.slice(0, 2).join(' ') || 'keepsake'}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        setOpenMenuId((prev) => (prev === img.id ? null : img.id))
                      }}
                    >
                      <MoreVertical size={13} />
                    </button>

                    {openMenuId === img.id && (
                      <div
                        className="absolute right-0 top-7 z-30 w-44 py-1 bg-surface-raised/95 backdrop-blur-xl border border-border-glass rounded-xl shadow-2xl text-xs flex flex-col animate-orbit-fade-in"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {onRepostImage && (
                          <button
                            type="button"
                            className="flex items-center gap-2 px-3 py-1.5 text-left text-retro-fg hover:bg-glass-w10 transition-colors cursor-pointer"
                            title="Repost to feed"
                            aria-label={`Repost ${img.tags.slice(0, 2).join(' ') || 'image'} to feed`}
                            onClick={() => {
                              setOpenMenuId(null)
                              onRepostImage({
                                url: vaultUrls[img.url] || img.url,
                                tags: img.tags,
                                name: img.tags.slice(0, 3).join(' ') || 'Keepsake',
                                kind: img.kind,
                                mimeType: img.kind === 'video' ? 'video/mp4' : undefined,
                              })
                            }}
                          >
                            <Repeat size={13} className="text-sky-400" />
                            <span>Repost to feed</span>
                          </button>
                        )}

                        {onAddToStory && (
                          <button
                            type="button"
                            className="flex items-center gap-2 px-3 py-1.5 text-left text-retro-fg hover:bg-glass-w10 transition-colors cursor-pointer"
                            title="Add to story"
                            aria-label={`Add ${img.tags.slice(0, 2).join(' ') || 'image'} to story`}
                            onClick={() => {
                              setOpenMenuId(null)
                              onAddToStory({
                                url: vaultUrls[img.url] || img.url,
                                tags: img.tags,
                                name: img.tags.slice(0, 3).join(' ') || 'Keepsake',
                                kind: img.kind,
                                mimeType: img.kind === 'video' ? 'video/mp4' : undefined,
                              })
                            }}
                          >
                            <Sparkles size={13} className="text-amber-400" />
                            <span>Add to story</span>
                          </button>
                        )}

                        {onCreateCard && (
                          <button
                            type="button"
                            className="flex items-center gap-2 px-3 py-1.5 text-left text-retro-fg hover:bg-glass-w10 transition-colors cursor-pointer"
                            title="Turn into a card"
                            aria-label={`Turn ${img.tags.slice(0, 2).join(' ') || 'keepsake'} into a card`}
                            onClick={() => {
                              setOpenMenuId(null)
                              onCreateCard({
                                url: isMotion && img.url.includes('redgifs') ? redgifsPlayable(img.url) : img.url,
                                tags: img.tags.slice(0, 8),
                                name: img.tags.slice(0, 3).join(' ') || 'Keepsake',
                              })
                            }}
                          >
                            <ImagePlus size={13} className="text-purple-400" />
                            <span>Create card</span>
                          </button>
                        )}

                        <button
                          type="button"
                          className="flex items-center gap-2 px-3 py-1.5 text-left text-retro-fg hover:bg-glass-w10 transition-colors cursor-pointer"
                          title="Re-feature in the Goon Panel"
                          aria-label={`Re-feature ${img.tags.slice(0, 2).join(' ') || 'keepsake'}`}
                          onClick={() => {
                            setOpenMenuId(null)
                            featureImage(img.id)
                          }}
                        >
                          <IconRefresh size={13} className="text-emerald-400" />
                          <span>Re-feature</span>
                        </button>

                        <button
                          type="button"
                          disabled={isBackdrop}
                          className="flex items-center gap-2 px-3 py-1.5 text-left text-retro-fg hover:bg-glass-w10 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default"
                          title={isBackdrop ? 'This is the app backdrop' : 'Set as app backdrop'}
                          aria-label={
                            isBackdrop
                              ? 'Current app backdrop'
                              : `Set ${img.tags.slice(0, 2).join(' ') || 'image'} as app backdrop`
                          }
                          onClick={() => {
                            setOpenMenuId(null)
                            setBackground(img.url)
                            onSetWallpaper?.(img.url, isMotion ? 'video/mp4' : undefined)
                          }}
                        >
                          <IconWallpaper size={13} className="text-cyan-400" />
                          <span>{isBackdrop ? 'Active backdrop' : 'Set backdrop'}</span>
                        </button>

                        <div className="h-[1px] bg-border-glass my-1" />

                        <button
                          type="button"
                          className="flex items-center gap-2 px-3 py-1.5 text-left text-rose-400 hover:bg-rose-500/15 transition-colors cursor-pointer"
                          title="Delete permanently from the gallery"
                          aria-label={`Delete ${img.tags.slice(0, 2).join(' ') || 'keepsake'} permanently`}
                          onClick={() => {
                            setOpenMenuId(null)
                            if (window.confirm('Delete this keepsake permanently?')) {
                              removeGalleryImage(img.id)
                              if (viewerId === img.id) setViewerId(null)
                              setSelectedIds((prev) => {
                                const next = new Set(prev)
                                next.delete(img.id)
                                return next
                              })
                            }
                          }}
                        >
                          <IconTrash size={13} />
                          <span>Delete</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Pagination and Select All on Page Footer */}
          <div className="flex items-center justify-between pt-3 border-t border-border-glass/80 mt-4 text-xs">
            <button
              type="button"
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
              className="text-xs font-semibold text-retro-muted hover:text-retro-body cursor-pointer"
            >
              {paginatedGallery.length > 0 && paginatedGallery.every((i) => selectedIds.has(i.id))
                ? 'Deselect all on page'
                : 'Select all on page'}
            </button>

            {totalPages > 1 && (
              <div className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  disabled={safePage === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  className="glass-action px-3 py-1.5 text-xs font-semibold rounded-lg disabled:opacity-30 cursor-pointer"
                >
                  ← Prev
                </button>
                <span className="text-retro-muted font-mono text-xs">
                  Page <strong className="text-retro-body">{safePage + 1}</strong> of {totalPages}
                </span>
                <button
                  type="button"
                  disabled={safePage >= totalPages - 1}
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  className="glass-action px-3 py-1.5 text-xs font-semibold rounded-lg disabled:opacity-30 cursor-pointer"
                >
                  Next →
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Viewer Modal */}
      {viewer && (
        <MediaViewerModal onClose={() => setViewerId(null)} label="Keepsake viewer">
          <figure className="relative flex max-h-[80vh] min-h-0 w-auto max-w-full flex-col items-center">
            <div className="relative min-h-0 w-auto max-w-full">
              {viewer.kind === 'video' ? (
                <NativeVideoPlayer
                  src={viewerVaultUrl || viewer.url}
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
                  src={viewerVaultUrl || viewer.url || offlineSvg(viewer.tags)}
                  alt={viewer.tags.slice(0, 3).join(' ') || 'keepsake'}
                  className="max-h-[70vh] w-auto max-w-full rounded-lg object-contain"
                  referrerPolicy="no-referrer"
                />
              )}
              {sortedGallery.length > 1 && (
                <>
                  <button
                    type="button"
                    aria-label="Previous keepsake"
                    title="Previous"
                    className="absolute left-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border-0 bg-black/60 p-0 text-white/90 backdrop-blur-sm transition-colors hover:bg-black/85 hover:text-white"
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
                    className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border-0 bg-black/60 p-0 text-white/90 backdrop-blur-sm transition-colors hover:bg-black/85 hover:text-white"
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
                <button
                  type="button"
                  onClick={() =>
                    onRepostImage({
                      url: viewerVaultUrl || viewer.url,
                      tags: viewer.tags,
                      name: viewer.tags.slice(0, 3).join(' ') || 'Keepsake',
                      kind: viewer.kind,
                      mimeType: viewer.kind === 'video' ? 'video/mp4' : undefined,
                    })
                  }
                  className="glass-action px-2.5 py-1 text-xs font-semibold rounded-lg flex items-center gap-1 cursor-pointer"
                  title="Repost to feed"
                >
                  <Repeat className="w-3.5 h-3.5" />
                  <span>Repost</span>
                </button>
              )}
              {onAddToStory && (
                <button
                  type="button"
                  onClick={() =>
                    onAddToStory({
                      url: viewerVaultUrl || viewer.url,
                      tags: viewer.tags,
                      name: viewer.tags.slice(0, 3).join(' ') || 'Keepsake',
                      kind: viewer.kind,
                      mimeType: viewer.kind === 'video' ? 'video/mp4' : undefined,
                    })
                  }
                  className="glass-action px-2.5 py-1 text-xs font-semibold rounded-lg flex items-center gap-1 cursor-pointer"
                  title="Add to story"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Story</span>
                </button>
              )}
              {onCreateCard && (
                <button
                  type="button"
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
                  className="glass-action px-2.5 py-1 text-xs font-semibold rounded-lg flex items-center gap-1 cursor-pointer"
                  title="Turn into card"
                >
                  <ImagePlus className="w-3.5 h-3.5" />
                  <span>Card</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  const ext = viewer.kind === 'video' ? 'mp4' : 'jpg'
                  downloadMedia(viewer.url, `keepsake-${viewer.id.slice(0, 8)}.${ext}`)
                }}
                className="glass-action px-2.5 py-1 text-xs font-semibold rounded-lg flex items-center gap-1 cursor-pointer"
                title="Download media"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download</span>
              </button>
              <button
                type="button"
                onClick={async () => {
                  const local = await vaultHttpUrl(viewer.url)
                  if (local) void window.gmatch?.openExternal?.(local)
                }}
                className="glass-action px-2.5 py-1 text-xs font-semibold rounded-lg flex items-center gap-1 cursor-pointer"
                title="Open in browser"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Browser</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setBackground(viewer.url)
                  onSetWallpaper?.(viewer.url, viewer.kind === 'video' ? 'video/mp4' : undefined)
                }}
                className="glass-action px-2.5 py-1 text-xs font-semibold rounded-lg flex items-center gap-1 cursor-pointer"
                title="Set as app backdrop"
              >
                <IconWallpaper size={13} />
                <span>Backdrop</span>
              </button>
              <button
                type="button"
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
                className="glass-action glass-action-danger px-2.5 py-1 text-xs font-semibold rounded-lg flex items-center gap-1 cursor-pointer"
                title="Delete keepsake"
              >
                <IconTrash size={13} />
                <span>Delete</span>
              </button>
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
