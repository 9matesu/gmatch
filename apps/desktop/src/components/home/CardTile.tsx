"use client";

import { useState, useRef } from 'react'
import { isMediaVideo } from '../../utils/media'
import { MediaBadge } from '../MediaBadge'
import { getApiBaseUrl } from '../../utils/api'
import { ObjectImage } from '../ObjectImage'
import { computeCardRarity, RARITY_TIERS, formatGc, parseTags } from '@orbit/shared'
import type { User } from '@orbit/shared'
import { useNow } from '../../hooks/useNow'
import { Heart, Clock, Gift, Check } from 'lucide-react'

interface IdentityLike {
  orbitId: string
  publicKeyHex: string
  privateKeyHex: string
}

export interface CardTileItem {
  id: string
  name?: string | null
  content_url?: string | null
  mime_type?: string | null
  size_bytes?: number
  owner_id: string
  owner_name?: string | null
  uploader_name?: string | null
  caption?: string | null
  score?: number
  gacha_downloads_count?: number
  is_received?: number | boolean
  likes_count?: number
  like_count?: number
  expires_at?: string | null
  created_at?: string | null
  // Canonical card fields (present on merged collection cards).
  card_id?: string
  value?: number
  rarity?: string
  market_status?: string
  tags?: string[] | string | null
  description?: string | null
  frame?: string
  accent_color?: string
}

export function CardTile({
  item,
  onClick,
  onDoubleClick,
  selected,
  onSelect,
  dragActive,
  users,
  identity,
  onOpenOwnerProfile,
  now,
}: {
  item: CardTileItem
  onClick?: () => void
  onDoubleClick?: () => void
  selected?: boolean
  onSelect?: (id: string) => void
  dragActive?: boolean
  users?: User[]
  identity?: IdentityLike | null
  onOpenOwnerProfile?: (ownerId: string) => void
  now?: number
}) {
  const localNow = useNow(now === undefined ? 30_000 : 0)
  const currentNow = now ?? localNow
  const isVid = Boolean(item.mime_type?.startsWith('video/')) || isMediaVideo(item.content_url)

  const isReceived = Boolean(item.is_received || (identity && item.owner_id !== identity.orbitId))
  const likes = Number(item.likes_count ?? item.like_count ?? 0)

  // Expiration countdown calculation
  const expiresMs = item.expires_at ? new Date(item.expires_at).getTime() : null
  const minsLeft = expiresMs ? Math.max(0, Math.floor((expiresMs - currentNow) / 60000)) : null

  const ownerLabel = (
    item.owner_name?.trim() || item.uploader_name?.trim() ||
    users?.find(u => u.id === item.owner_id)?.display_name?.trim() ||
    'Unknown User'
  )

  const cardTitle = item.name?.trim() || item.caption?.trim() || ownerLabel || 'Untitled Card'

  const handleMediaError = () => {
    if (typeof window === 'undefined' || !item.id) return
    if (item.id.startsWith('p2p-obj-') || item.id.startsWith('p2p-wrtc-')) return
    const verifyUrl = `${getApiBaseUrl()}/api/objects/${item.id}`
    fetch(verifyUrl, { method: 'HEAD', cache: 'no-store' })
      .then((res) => {
        if (res.status === 404 || res.status === 410) {
          window.dispatchEvent(new CustomEvent('orbit-object-404', { detail: { cardId: item.id } }))
        }
      })
      .catch(() => {})
  }

  const cardValue = Math.max(0, item.value ?? item.score ?? item.gacha_downloads_count ?? 0)
  const rarity = item.rarity && RARITY_TIERS[item.rarity as keyof typeof RARITY_TIERS]
    ? RARITY_TIERS[item.rarity as keyof typeof RARITY_TIERS]
    : computeCardRarity(cardValue)

  const accent = item.accent_color || rarity.accentColor
  const itemTags = (Array.isArray(item.tags) ? item.tags : parseTags(item.tags)).slice(0, 3)

  const frameType = item.frame || 'chrome'
  const cardRef = useRef<HTMLDivElement>(null)
  const [tilt, setTilt] = useState({ rotateX: 0, rotateY: 0 })
  const [mousePos, setMousePos] = useState({ x: 50, y: 50 })
  const [isHovered, setIsHovered] = useState(false)

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return
    const rect = cardRef.current.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    setTilt({
      rotateX: (0.5 - y) * 12,
      rotateY: (x - 0.5) * 12,
    })
    setMousePos({ x: x * 100, y: y * 100 })
  }

  return (
    <div
      ref={cardRef}
      data-rarity={rarity.rarity}
      data-frame={frameType}
      style={{
        '--mouse-x': `${mousePos.x}%`,
        '--mouse-y': `${mousePos.y}%`,
        transform: isHovered
          ? `perspective(1000px) rotateX(${tilt.rotateX.toFixed(2)}deg) rotateY(${tilt.rotateY.toFixed(2)}deg) scale3d(1.02, 1.02, 1.02)`
          : undefined,
      } as React.CSSProperties}
      className={`holo-card group relative select-none cursor-pointer transition-transform duration-100 ease-out active:scale-[0.96] rounded-xl border border-border-glass bg-retro-bg overflow-hidden shadow-xs hover:border-white/20 ${
        selected ? 'ring-2 ring-white shadow-xl scale-[1.02] z-10' : ''
      }`}
      onMouseMove={handleMouseMove}
      onClick={() => {
        if (onSelect) onSelect(item.id)
        onClick?.()
      }}
      onDoubleClick={() => {
        if (onDoubleClick) onDoubleClick()
      }}
      onMouseEnter={() => {
        setIsHovered(true)
        if (onSelect && dragActive && selected === false) onSelect(item.id)
      }}
      onMouseLeave={() => {
        setIsHovered(false)
        setTilt({ rotateX: 0, rotateY: 0 })
      }}
    >
      <div className="holo-sheen" />
      <div className="holo-card-inner flex flex-col h-full rounded-[6px] overflow-hidden" style={{ boxShadow: `inset 0 0 0 1.5px ${accent}66` }}>
        {/* Top Badges */}
        <div className="absolute top-2 left-2 z-20 flex flex-wrap items-center gap-1">
          <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md border shadow-md ${rarity.badgeClass}`}>
            {rarity.label}
          </span>
          {frameType !== 'chrome' && (
            <span className={`text-[10px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-md border shadow-md font-mono ${
              frameType === 'holo'
                ? 'bg-gradient-to-r from-pink-500/80 via-purple-500/80 to-cyan-500/80 text-white border-pink-400/60'
                : frameType === 'carbon'
                ? 'bg-retro-bg/90 text-retro-fg border-border-glass'
                : frameType === 'neon'
                ? 'bg-cyan-950/90 text-cyan-300 border-cyan-400/80'
                : 'bg-black/80 text-retro-fg border-border-glass'
            }`}>
              {frameType}
            </span>
          )}
          <span className="text-[10px] font-mono font-black px-1.5 py-0.5 rounded-md bg-black/85 text-amber-300 border border-amber-400/50 shadow-md backdrop-blur-xs">
            {formatGc(cardValue)}
          </span>
          {isReceived && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 bg-purple-950/90 text-cyan-300 rounded-md border border-purple-500/50 flex items-center gap-0.5 shadow-md">
              <Gift className="w-2.5 h-2.5 text-purple-400" />
              <span>RECEIVED</span>
            </span>
          )}
        </div>

        {/* Top-Right Badges: Likes & Expiry Timer & Select Checkbox */}
        <div className="absolute top-2 right-2 z-20 flex items-center gap-1">
          {minsLeft !== null && minsLeft > 0 && (
            <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 bg-black/80 text-amber-300 rounded-md border border-amber-500/40 backdrop-blur-xs flex items-center gap-0.5 shadow-md">
              <Clock className="w-2.5 h-2.5" />
              <span>{minsLeft > 60 ? `${Math.floor(minsLeft / 60)}h` : `${minsLeft}m`}</span>
            </span>
          )}
          <span className="text-[10px] font-mono font-black px-1.5 py-0.5 bg-black/85 text-rose-300 rounded-md border border-rose-500/40 backdrop-blur-xs flex items-center gap-1 shadow-md">
            <Heart className="w-2.5 h-2.5 fill-rose-500 text-amber-400" />
            <span>{likes}</span>
          </span>
          {/* Selection Checkbox */}
          <div
            onClick={(e) => {
              e.stopPropagation()
              onSelect?.(item.id)
            }}
            className={`w-5 h-5 rounded-md border flex items-center justify-center transition-all ${
              selected
                ? 'bg-surface-interactive border-border-glass text-retro-fg shadow-md'
                : 'bg-black/60 border-border-glass opacity-0 group-hover:opacity-100 text-transparent hover:border-border-glass'
            }`}
          >
            <Check className="w-3 h-3 stroke-[3]" />
          </div>
        </div>

        {/* Card Image */}
        <div className="relative w-full aspect-[3/4.2] bg-surface-canvas overflow-hidden">
          <ObjectImage
            contentUrl={item.content_url}
            objectId={item.id}
            identity={identity || null}
            mimeType={item.mime_type}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            videoClassName="pointer-events-none w-full h-full object-cover"
            muted
            playsInline
            preload="none"
            onError={handleMediaError}
          />
          {isVid && <MediaBadge className="absolute bottom-1.5 right-1.5 z-10" />}
        </div>

        {/* Card Info Footer */}
        <div className="p-2.5 bg-retro-bg border-t border-border-glass flex flex-col gap-1">
          <div className="flex items-center justify-between gap-1.5">
            <div className="min-w-0 flex-1 text-xs font-semibold text-retro-fg truncate" title={cardTitle}>
              {cardTitle}
            </div>
            <div className="shrink-0 text-[10px] font-mono font-bold tabular-nums tracking-tight" style={{ color: accent }}>
              {formatGc(cardValue)}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 text-[10px] font-mono text-retro-muted">
            <span className="truncate">
              by{' '}
              {onOpenOwnerProfile ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onOpenOwnerProfile(item.owner_id)
                  }}
                  className="inline font-medium cursor-pointer hover:underline hover:text-retro-fg transition-colors"
                  title={`View ${ownerLabel}`}
                >
                  {ownerLabel}
                </button>
              ) : (
                <span className="font-medium text-retro-fg">{ownerLabel}</span>
              )}
            </span>
            <span className="shrink-0 flex items-center gap-1 font-bold text-retro-fg">
              <Heart className="w-2.5 h-2.5 fill-rose-500 text-rose-400" />
              <span>{likes}</span>
            </span>
          </div>

          {itemTags.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-0.5 overflow-hidden">
              {itemTags.map((tag) => (
                <span
                  key={tag}
                  className="text-[10px] font-mono font-medium px-1.5 py-0.2 rounded bg-retro-panel border border-border-glass text-retro-muted truncate max-w-[90px]"
                  style={{ color: accent }}
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
