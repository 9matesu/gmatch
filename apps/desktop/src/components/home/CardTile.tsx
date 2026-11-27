"use client";

import { useState } from 'react'
import { isMediaVideo } from '../../utils/media'
import { MediaBadge } from '../MediaBadge'
import { GameCard } from '../cards/GameCard'
import { computeCardRarity, RARITY_TIERS, parseTags } from '@orbit/shared'
import type { User } from '@orbit/shared'
import { useNow } from '../../hooks/useNow'
import { Check, Clock, Gift, Heart, Maximize2, Eye } from 'lucide-react'
import {
  classes, COLOR, GAP, ICON, MONO, MOTION, PADDING_X,
  RADIUS, SHADOW, TYPE, WEIGHT,
} from '../../ui/tokens'
import { ContextMenu, type ContextMenuItem } from '../ui/ContextMenu'

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

  const itemTags = (Array.isArray(item.tags) ? item.tags : parseTags(item.tags)).slice(0, 3)

  const frameType = item.frame || 'chrome'
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)

  // Cards have a context too: right-click opens the same shared menu at the
  // cursor, with only the actions this card actually supports.
  const cardItems: ContextMenuItem[] = []
  if (onClick) cardItems.push({ label: 'Open card', icon: <Eye className="w-3.5 h-3.5" />, onSelect: onClick })
  if (onDoubleClick) cardItems.push({ label: 'Expand card', icon: <Maximize2 className="w-3.5 h-3.5" />, onSelect: onDoubleClick })
  if (onOpenOwnerProfile) {
    cardItems.push({ label: `View ${ownerLabel || 'owner'}`, onSelect: () => onOpenOwnerProfile(item.owner_id) })
  }
  if (onSelect) cardItems.push({ label: 'Select card', icon: <Check className="w-3.5 h-3.5" />, onSelect: () => onSelect(item.id) })

  const footerExtra = (
    <>
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
              style={{ color: rarity.accentColor }}
            >
              #{tag}
            </span>
          ))}
        </div>
      )}
    </>
  )

  return (
    <div
      className="relative"
      onContextMenu={(e) => {
        if (cardItems.length === 0) return
        e.preventDefault()
        e.stopPropagation()
        setMenuAt({ x: e.clientX, y: e.clientY })
      }}
      onClick={() => {
        if (onSelect) onSelect(item.id)
        onClick?.()
      }}
      onDoubleClick={() => { if (onDoubleClick) onDoubleClick() }}
      onMouseEnter={() => { if (onSelect && dragActive && selected === false) onSelect(item.id) }}
    >
      <GameCard
        objectId={item.id}
        identity={identity}
        width={150}
        height={210}
        isVideo={isVid}
        name={cardTitle}
        rarity={rarity}
        value={hasValuation ? cardValue : undefined}
        accentColor={item.accent_color}
        frame={frameType}
        selected={selected}
        footerExtra={footerExtra}
      >
        {/* Frame finish + received ribbon (bottom-left, clear of the value chip). */}
        <div className={classes('absolute bottom-2 left-2 flex flex-wrap items-center', GAP[1], 'z-20')}>
          {frameType !== 'chrome' && (
            <span className={classes(TYPE.caption, WEIGHT.medium, 'uppercase', RADIUS.chip, PADDING_X[1.5], 'py-0.5', COLOR.scrim, COLOR.onMedia, 'border', COLOR.edge, 'backdrop-blur-xs')}>
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

        {/* Expiry timer + selection checkbox (bottom-right). */}
        <div className={classes('absolute bottom-2 right-2 flex items-center', GAP[1], 'z-20')}>
          {minsLeft !== null && minsLeft > 0 && (
            <span className={classes(TYPE.caption, MONO, WEIGHT.medium, PADDING_X[1.5], 'py-0.5', RADIUS.chip, COLOR.scrim, 'text-warning-fg border border-warning/30 backdrop-blur-xs flex items-center', GAP[1])}>
              <Clock className={ICON.sm} />
              <span>{minsLeft > 60 ? `${Math.floor(minsLeft / 60)}h` : `${minsLeft}m`}</span>
            </span>
          )}
          {onSelect && (
            <button
              type="button"
              aria-label={selected ? `Deselect ${cardTitle}` : `Select ${cardTitle}`}
              aria-pressed={selected}
              onClick={(e) => {
                e.stopPropagation()
                onSelect?.(item.id)
              }}
              className={classes('size-5 flex items-center justify-center', RADIUS.chip, 'border cursor-pointer', MOTION.transition.micro,
                selected
                  ? classes(COLOR.interactive, COLOR.edge, COLOR.fg, SHADOW.large)
                  : classes(COLOR.scrim, COLOR.edge, 'opacity-0 group-hover:opacity-100 text-transparent hover:border-edge'),
              )}
            >
              <Check className={classes(ICON.sm, 'stroke-[3]')} />
            </button>
          )}
        </div>

        {isVid && <MediaBadge className="absolute bottom-1.5 right-1.5 z-[var(--z-dropdown)]" />}
      </GameCard>
      {menuAt && (
        <ContextMenu
          x={menuAt.x}
          y={menuAt.y}
          title="Card"
          items={cardItems}
          onDismiss={() => setMenuAt(null)}
        />
      )}
    </div>
  )
}