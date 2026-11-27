"use client";

import { useState, useRef } from 'react'
import { isMediaVideo } from '../../utils/media'
import { MediaBadge } from '../MediaBadge'
import { CardArtwork } from '../cards/CardArtwork'
import { computeCardRarity, RARITY_TIERS, formatGc, parseTags } from '@orbit/shared'
import type { User } from '@orbit/shared'
import { useNow } from '../../hooks/useNow'
import { Heart, Clock, Gift, Check } from 'lucide-react'
import {
  classes, COLOR, GAP, ICON, MONO, MOTION, PADDING, PADDING_X,
  RADIUS, SHADOW, TRACKING, TYPE, WEIGHT,
} from '../../ui/tokens'

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
    ''
  )

  const cardTitle = item.name?.trim() || item.caption?.trim() || ownerLabel || 'Untitled Card'

  const hasValuation =
    item.card_id != null ||
    item.value !== undefined ||
    item.score !== undefined ||
    item.gacha_downloads_count !== undefined ||
    item.rarity != null
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
      className={classes(
        'holo-card group relative select-none cursor-pointer',
        MOTION.transition.transform, 'active:scale-(--scale-press-sm)',
        RADIUS.panel, 'border', COLOR.edge, COLOR.canvas, 'overflow-hidden', SHADOW.xs, COLOR.hoverEdgeStrong,
        selected && classes('ring-2 ring-retro-accent', SHADOW.modal, 'z-[var(--z-dropdown)]'),
      )}
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
      <div className={classes('holo-card-inner flex flex-col h-full', RADIUS.chip, 'overflow-hidden')} style={{ boxShadow: `inset 0 0 0 1.5px ${accent}66` }}>
        {/* Top Badges */}
        <div className={classes('absolute top-2 left-2 flex flex-wrap items-center', GAP[1], 'z-[var(--z-dropdown)]')}>
          <span className={classes(TYPE.caption, WEIGHT.semibold, 'uppercase', TRACKING.wider, PADDING_X[2], 'py-0.5', RADIUS.chip, 'border backdrop-blur-xs', rarity.badgeClass)}>
            {rarity.label}
          </span>
          {frameType !== 'chrome' && (
            <span className={classes(TYPE.caption, WEIGHT.medium, 'uppercase', TRACKING.wider, PADDING_X[1.5], 'py-0.5', RADIUS.chip, 'border', MONO, 'backdrop-blur-xs',
              frameType === 'holo'
                ? 'bg-chrome-lav/90 text-chrome-lav border-chrome-lav/60'
                : frameType === 'carbon'
                ? 'bg-retro-bg/90 text-retro-fg border-edge'
                : frameType === 'neon'
                ? 'bg-info/90 text-info-fg border-info/80'
                : 'bg-black/80 text-retro-fg border-edge'
            )}>
              {frameType}
            </span>
          )}
          {isReceived && (
            <span className={classes(TYPE.caption, WEIGHT.medium, PADDING_X[1.5], 'py-0.5', RADIUS.chip, COLOR.scrim, 'text-chrome-lav border border-chrome-lav/30 flex items-center', GAP[1], 'backdrop-blur-xs')}>
              <Gift className={classes(ICON.sm, 'text-chrome-lav')} />
              <span>RECEIVED</span>
            </span>
          )}
        </div>

        {/* Top-Right Badges: Expiry Timer & Select Checkbox */}
        <div className={classes('absolute top-2 right-2 flex items-center', GAP[1], 'z-[var(--z-dropdown)]')}>
          {minsLeft !== null && minsLeft > 0 && (
            <span className={classes(TYPE.caption, MONO, WEIGHT.medium, PADDING_X[1.5], 'py-0.5', RADIUS.chip, COLOR.scrim, 'text-warning-fg border border-warning/30 backdrop-blur-xs flex items-center', GAP[1])}>
              <Clock className={ICON.sm} />
              <span>{minsLeft > 60 ? `${Math.floor(minsLeft / 60)}h` : `${minsLeft}m`}</span>
            </span>
          )}
          {/* Selection Checkbox */}
          <div
            onClick={(e) => {
              e.stopPropagation()
              onSelect?.(item.id)
            }}
            className={classes('w-5 h-5 flex items-center justify-center', RADIUS.chip, 'border', MOTION.transition.micro,
              selected
                ? classes(COLOR.interactive, COLOR.edge, COLOR.fg, SHADOW.large)
                : classes(COLOR.scrim, COLOR.edge, 'opacity-0 group-hover:opacity-100 text-transparent hover:border-edge'),
            )}
          >
            <Check className={classes(ICON.sm, 'stroke-[3]')} />
          </div>
        </div>

        {/* Card Image */}
        <div className="relative w-full aspect-[3/4.2] bg-surface-canvas overflow-hidden">
          <CardArtwork
            objectId={item.id}
            identity={identity}
            width={150}
            height={210}
            isVideo={isVid}
          />
          {isVid && <MediaBadge className="absolute bottom-1.5 right-1.5 z-[var(--z-dropdown)]" />}
        </div>

        {/* Card Info Footer */}
        <div className={classes(PADDING[2.5], COLOR.canvas, 'border-t', COLOR.edge, 'flex flex-col', GAP[1])}>
          <div className={classes('flex items-center justify-between', GAP[1.5])}>
            <div className={classes('min-w-0 flex-1', TYPE.body, WEIGHT.semibold, COLOR.fg, 'truncate')} title={cardTitle}>
              {cardTitle}
            </div>
            {hasValuation && (
              <div className={classes('shrink-0', TYPE.caption, MONO, WEIGHT.bold, 'tabular-nums', TRACKING.tight)} style={{ color: accent }}>
                {formatGc(cardValue)}
              </div>
            )}
          </div>

          <div className={classes('flex items-center justify-between', GAP[2], TYPE.caption, MONO, COLOR.muted)}>
            {ownerLabel && (
              <span className="truncate">
                by{' '}
                {onOpenOwnerProfile ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpenOwnerProfile(item.owner_id)
                    }}
                    className={classes('inline', WEIGHT.medium, 'cursor-pointer hover:underline', COLOR.hoverFg, MOTION.transition.micro)}
                    title={`View ${ownerLabel}`}
                  >
                    {ownerLabel}
                  </button>
                ) : (
                  <span className={classes(WEIGHT.medium, COLOR.fg)}>{ownerLabel}</span>
                )}
              </span>
            )}
            <span className={classes('shrink-0 flex items-center', GAP[1], WEIGHT.bold, COLOR.fg)}>
              <Heart className={classes(ICON.sm, 'fill-danger text-danger-fg')} />
              <span>{likes}</span>
            </span>
          </div>

          {itemTags.length > 0 && (
            <div className={classes('flex flex-wrap overflow-hidden pt-0.5', GAP[1])}>
              {itemTags.map((tag) => (
                <span
                  key={tag}
                  className={classes(TYPE.caption, MONO, WEIGHT.medium, PADDING_X[1.5], 'py-0.5', RADIUS.chip, 'bg-retro-panel border', COLOR.edge, COLOR.muted, 'truncate max-w-[90px]')}
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

