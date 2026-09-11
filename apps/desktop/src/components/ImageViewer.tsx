"use client";

import React, { useState, useRef, useEffect } from 'react'
import type { OrbitIdentity } from '@orbit/crypto'
import type { OrbitObject } from '@orbit/shared'
import { orbitFetch } from '../utils/api'
import { isMediaVideo, resolveMediaUrl } from '../utils/media'
import { computeCardRarity, formatGc } from '@orbit/shared'
import { MediaBadge } from './MediaBadge'
import { ObjectImage } from './ObjectImage'
import { playPress } from '../utils/sounds'
import {
  X,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Download,
  Copy,
  Star,
  Image as ImageIcon,
  Trash2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'

const MIN_ZOOM = 0.5
const MAX_ZOOM = 4

interface ImageViewerProps {
  itemId: string
  items: OrbitObject[]
  identity: OrbitIdentity
  onClose: () => void
  onNavigate: (id: string) => void
  onDelete?: (item: OrbitObject) => void
  onSetWallpaper?: (url: string) => void
  onToggleFavorite?: (item: OrbitObject) => Promise<boolean>
}

export function ImageViewer({
  itemId,
  items,
  identity,
  onClose,
  onNavigate,
  onDelete,
  onSetWallpaper,
  onToggleFavorite,
}: ImageViewerProps) {
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [copied, setCopied] = useState(false)
  const dragStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)
  const didDragRef = useRef(false)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)

  const navIdx = items.findIndex((i) => i.id === itemId)
  const activeItem = navIdx >= 0 ? items[navIdx] : null
  const hasPrev = navIdx > 0
  const hasNext = navIdx >= 0 && navIdx < items.length - 1

  const isFavorited = activeItem ? activeItem.is_favorited === 1 : false
  const isOwner = Boolean(activeItem && identity && activeItem.owner_id === identity.orbitId)

  // Reset zoom & pan when image changes
  useEffect(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
    setLoadError(false)
  }, [itemId])

  const handleZoom = (delta: number) => {
    playPress(800)
    setZoom((prev) => Math.min(Math.max(prev + delta, MIN_ZOOM), MAX_ZOOM))
  }

  const resetView = () => {
    playPress(700)
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      } else if (e.key === 'ArrowLeft' && hasPrev) {
        onNavigate(items[navIdx - 1].id)
      } else if (e.key === 'ArrowRight' && hasNext) {
        onNavigate(items[navIdx + 1].id)
      } else if (e.key === '+' || e.key === '=') {
        handleZoom(0.25)
      } else if (e.key === '-' || e.key === '_') {
        handleZoom(-0.25)
      } else if (e.key === '0') {
        resetView()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, onNavigate, items, navIdx, hasPrev, hasNext])

  // Mouse drag panning
  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoom <= 1) return
    didDragRef.current = false
    setIsDragging(true)
    dragStartRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y }
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !dragStartRef.current) return
    const dx = e.clientX - dragStartRef.current.x
    const dy = e.clientY - dragStartRef.current.y
    if (Math.abs(dx) + Math.abs(dy) > 4) {
      didDragRef.current = true
    }
    setPan({
      x: dragStartRef.current.panX + dx,
      y: dragStartRef.current.panY + dy,
    })
  }

  const handleMouseUp = () => {
    setIsDragging(false)
    dragStartRef.current = null
  }

  // Mobile swipe gestures
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
    }
  }

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStartRef.current || e.changedTouches.length === 0 || zoom > 1) return
    const dx = e.changedTouches[0].clientX - touchStartRef.current.x
    const dy = e.changedTouches[0].clientY - touchStartRef.current.y
    touchStartRef.current = null

    if (Math.abs(dx) > 60 && Math.abs(dy) < 50) {
      if (dx < 0 && hasNext) {
        playPress(750)
        onNavigate(items[navIdx + 1].id)
      } else if (dx > 0 && hasPrev) {
        playPress(750)
        onNavigate(items[navIdx - 1].id)
      }
    }
  }

  if (!activeItem) {
    return (
      <div
        className="fixed inset-0 z-[var(--z-system)] bg-surface-canvas/95 backdrop-blur-2xl flex flex-col items-center justify-center gap-4 p-6 font-sans animate-orbit-fade-in select-none"
        onClick={onClose}
      >
        <span className="text-3xl text-retro-muted block">◈</span>
        <p className="text-sm font-bold text-retro-fg">Media not found</p>
        <p className="text-xs text-retro-muted font-mono">ID: {itemId}</p>
        <button
          type="button"
          onClick={onClose}
          className="glass-action glass-action-primary px-4 py-2 rounded-lg text-xs font-bold cursor-pointer"
        >
          Close (Esc)
        </button>
      </div>
    )
  }

  const isP2pLocal = typeof activeItem.id === 'string' && activeItem.id.startsWith('p2p-obj-')
  const isObjectPath =
    Boolean(
      activeItem.content_url &&
        (activeItem.content_url.startsWith('/api/objects/') ||
          activeItem.content_url.includes('/api/objects/'))
    ) ||
    (!activeItem.content_url && activeItem.id && !isP2pLocal)
  const rawUrl = activeItem.content_url || (activeItem.id && !isP2pLocal ? `/api/objects/${activeItem.id}` : '')
  const imageUrl = resolveMediaUrl(rawUrl)
  const senderName =
    (activeItem as { owner_name?: string }).owner_name?.trim() ||
    activeItem.display_name?.trim() ||
    'Unknown User'
  const isVideo = isMediaVideo(imageUrl) || activeItem?.mime_type?.startsWith('video/')

  const handleDownload = async () => {
    playPress(820)
    if (!activeItem) return
    try {
      if (isObjectPath) {
        const res = await orbitFetch(`/api/objects/${activeItem.id}`, {}, identity)
        if (!res.ok) return
        const blob = await res.blob()
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `orbit-${activeItem.id.slice(0, 8)}.jpg`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(a.href)
      } else {
        if (!imageUrl) return
        const a = document.createElement('a')
        a.href = imageUrl
        a.download = `orbit-${activeItem.id.slice(0, 8)}.jpg`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
      }
    } catch {}
  }

  const handleCopyLink = () => {
    playPress(880)
    if (!imageUrl) return
    try {
      navigator.clipboard.writeText(imageUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  return (
    <div
      className="fixed inset-0 z-[var(--z-system)] bg-black/70 backdrop-blur-2xl flex flex-col justify-between p-2 sm:p-4 md:p-6 overflow-hidden select-none font-sans animate-orbit-fade-in"
      onClick={() => {
        if (!didDragRef.current) onClose()
      }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Top Floating Control Bar */}
      <div
        className="glass-card w-full max-w-4xl mx-auto px-3 py-2 flex items-center justify-between shrink-0 z-40 rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 sm:gap-3 truncate min-w-0">
          <span className="text-xs sm:text-sm font-bold text-retro-fg truncate">{senderName}</span>
          {items.length > 1 && (
            <span className="text-[10px] sm:text-xs font-mono glass-inset px-2 py-0.5 rounded-full shrink-0">
              {navIdx + 1} / {items.length}
            </span>
          )}
        </div>

        {/* Zoom & View Controls */}
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          <div className="glass-inset flex items-center gap-1 rounded-lg p-1">
            <button
              type="button"
              onClick={() => handleZoom(0.25)}
              className="glass-action h-8 w-8 rounded-lg flex items-center justify-center cursor-pointer disabled:opacity-30"
              title="Zoom In (+)"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => handleZoom(-0.25)}
              className="glass-action h-8 w-8 rounded-lg flex items-center justify-center cursor-pointer disabled:opacity-30"
              title="Zoom Out (-)"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={resetView}
              className="glass-action h-8 w-8 rounded-lg flex items-center justify-center cursor-pointer disabled:opacity-30"
              title="Reset Zoom (0)"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              playPress(680)
              onClose()
            }}
            className="glass-action glass-action-danger h-8 w-8 rounded-lg flex items-center justify-center cursor-pointer"
            title="Close (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Image Display Viewport */}
      <div
        className="relative flex-1 min-h-0 flex items-center justify-center overflow-hidden my-2 sm:my-3 max-h-[calc(100dvh-130px)] z-30"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ cursor: zoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default' }}
      >
        {/* Navigation Arrow Left */}
        {hasPrev && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              playPress(750)
              onNavigate(items[navIdx - 1].id)
            }}
            className="glass-action absolute left-2 sm:left-4 z-40 h-10 w-10 sm:h-11 sm:w-11 rounded-full flex items-center justify-center cursor-pointer"
            title="Previous (←)"
          >
            <ChevronLeft className="w-5 h-5 sm:w-6 sm:h-6" />
          </button>
        )}

        {/* Image Display */}
        <div
          className="transition-transform duration-150 flex items-center justify-center max-w-full max-h-full"
          onClick={(e) => e.stopPropagation()}
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          }}
        >
          {loadError ? (
            <div className="glass-card p-8 text-center space-y-2">
              <span className="text-3xl text-retro-muted block">◈</span>
              <p className="text-xs font-bold text-retro-body">Media unavailable or encrypted</p>
              <p className="text-[10px] text-retro-muted font-mono">ID: {activeItem?.id}</p>
            </div>
          ) : (
            (() => {
              const isChat = (activeItem as any)?.is_chat === 1 || (activeItem as any)?.is_chat === '1' || (activeItem as any)?.is_chat === true;
              const isCard = !isChat && ((activeItem as any)?.card_id || (activeItem as any)?.value !== undefined || (activeItem as any)?.rarity);
              const cardVal = Math.max(0, (activeItem as any)?.value ?? (activeItem as any)?.score ?? activeItem?.gacha_downloads_count ?? 0);
              const rarity = computeCardRarity(cardVal);

              return (
                <div
                  className={`relative p-1 ${isCard ? 'metallic-card-border' : 'glass-card rounded-xl'}`}
                  {...(isCard ? { 'data-rarity': rarity.rarity } : {})}
                >
                  {isCard && (
                    <div className="absolute top-3 right-3 z-30 flex items-center gap-1.5 pointer-events-none">
                      <span className="glass-inset text-[10px] font-mono font-bold px-2 py-0.5 rounded-md">
                        {formatGc(cardVal)}
                      </span>
                    </div>
                  )}
                  <ObjectImage
                    contentUrl={activeItem.content_url}
                    objectId={activeItem.id}
                    identity={identity}
                    className="max-w-[88vw] max-h-[68vh] object-contain rounded-xl shadow-2xl select-none"
                    videoClassName="max-w-[88vw] max-h-[68vh] object-contain rounded-xl shadow-2xl bg-black"
                    controls
                    autoPlay
                    loop
                    playsInline
                    onError={() => setLoadError(true)}
                  />
                  {isVideo && <MediaBadge className="absolute top-3 left-3" />}
                </div>
              );
            })()
          )}
        </div>

        {/* Navigation Arrow Right */}
        {hasNext && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              playPress(750)
              onNavigate(items[navIdx + 1].id)
            }}
            className="glass-action absolute right-2 sm:right-4 z-40 h-10 w-10 sm:h-11 sm:w-11 rounded-full flex items-center justify-center cursor-pointer"
            title="Next (→)"
          >
            <ChevronRight className="w-5 h-5 sm:w-6 sm:h-6" />
          </button>
        )}
      </div>

      {/* Bottom Action Dock Bar */}
      <div
        className="glass-card w-full max-w-4xl mx-auto px-3 py-2 flex items-center justify-center gap-2 flex-wrap shrink-0 z-40 rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={handleDownload}
          className="glass-action h-9 px-3 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Download</span>
        </button>

        <button
          type="button"
          onClick={handleCopyLink}
          className="glass-action h-9 px-3 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
        >
          <Copy className="w-3.5 h-3.5 text-retro-muted" />
          <span>{copied ? 'Copied Link!' : 'Copy Link'}</span>
        </button>

        {onToggleFavorite && (
          <button
            type="button"
            onClick={() => {
              playPress(850)
              onToggleFavorite(activeItem)
            }}
            className={`glass-action ${isFavorited ? 'glass-nav-active' : ''} h-9 px-3 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap`}
          >
            <Star className={`w-3.5 h-3.5 ${isFavorited ? 'fill-white' : ''}`} />
            <span>{isFavorited ? 'Favorited' : 'Favorite'}</span>
          </button>
        )}

        {onSetWallpaper && imageUrl && (
          <button
            type="button"
            onClick={() => {
              playPress(800)
              onSetWallpaper(imageUrl)
            }}
            className="glass-action h-9 px-3 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <ImageIcon className="w-3.5 h-3.5" />
            <span>Set Background</span>
          </button>
        )}

        {isOwner && onDelete && (
          <button
            type="button"
            onClick={() => {
              playPress(620)
              onDelete(activeItem)
            }}
            className="glass-action glass-action-danger h-9 px-3 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5 text-red-400" />
            <span>Delete</span>
          </button>
        )}
      </div>
    </div>
  )
}
