"use client";

import { useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { computeCardRarity, formatGc, type CardRarityDetails } from '@orbit/shared'
import { CardArtwork } from './CardArtwork'
import { useObjectImage } from '../../hooks/useObjectImage'
import {
  CHROME, classes, MOTION, TCG_CARD,
} from '../../ui/tokens'

interface IdentityLike {
  orbitId: string
  publicKeyHex: string
  privateKeyHex: string
}

export interface GameCardProps {
  /** Signed-bytes object id (wins over `src`). Never a bare descriptor. */
  objectId: string | null
  /** Direct, already-resolvable media URL (server snapshot, keepsake link). */
  src?: string | null
  identity?: IdentityLike | null
  /** Holo art dimensions (the card window is sized from these). */
  width: number
  height: number
  isVideo?: boolean
  /** Card name printed on the embossed title plate. */
  name?: string | null
  /** Rarity tier; derived from `value` when omitted. */
  rarity?: CardRarityDetails
  /** Card value in g$; printed in the stat row. */
  value?: number | null
  /** Accent override (user card payload); falls back to the rarity accent. */
  accentColor?: string | null
  /** Frame finish label (chrome / holo / carbon / neon). */
  frame?: string
  /** Print the title plate and the extra rows (default: when a name or value is given). */
  showNameplate?: boolean
  /** Extra rows under the stat row (owner, tags, meta). */
  footerExtra?: ReactNode
  /** Cosmetic: forged from a picture the player found in the clicker game. */
  clicker?: boolean
  /** Tactile tilt + sheen + cursor. Disable for dense grids. Default true. */
  interactive?: boolean
  selected?: boolean
  className?: string
  /** Overlays painted over the holo art (rarity gem, zoom, ribbons, stamps). */
  children?: ReactNode
}

/**
 * The ONE premium trading-card object, used by every card surface in the app —
 * the collection tile, the detail view, the store market, the profile grid, the
 * duel round, the special match and the spectator arena.
 *
 * It is a TCG card, not an image with a caption: a rarity-tinted metal frame,
 * an embossed title plate, an inset art window with the Pokemon HoloCard foil
 * (signed bytes resolved by CardArtwork), a value row and, when no bytes exist
 * anywhere, the woven card back instead of a blank placeholder. Surfaces
 * compose around it — a tile adds selection / a context menu, a duel adds a
 * zoom button or a decision stamp — via `children` (over the art) and
 * `footerExtra`.
 */
export function GameCard({
  objectId,
  src,
  identity,
  width,
  height,
  isVideo = false,
  name,
  rarity,
  value,
  accentColor,
  frame = 'chrome',
  showNameplate,
  footerExtra,
  clicker = false,
  interactive = true,
  selected = false,
  className,
  children,
}: GameCardProps) {
  const tier = rarity ?? computeCardRarity(value ?? 0)
  const accent = accentColor || tier.accentColor
  const hasValue = typeof value === 'number' && value > 0
  const title = name?.trim() || 'Untitled Card'
  const plate = showNameplate ?? Boolean(name?.trim() || hasValue)

  // One resolution, shared with CardArtwork's deduped fetch. A card with no
  // bytes anywhere shows its back; the HoloCard mounts the moment art arrives.
  const img = useObjectImage(objectId ?? null, identity ?? null)
  const hasArt = Boolean(img.url || src)

  const cardRef = useRef<HTMLDivElement>(null)
  const [tilt, setTilt] = useState({ rotateX: 0, rotateY: 0 })
  const [mousePos, setMousePos] = useState({ x: 50, y: 50 })
  const [hovered, setHovered] = useState(false)

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!interactive || !cardRef.current) return
    const rect = cardRef.current.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    setTilt({ rotateX: (0.5 - y) * 12, rotateY: (x - 0.5) * 12 })
    setMousePos({ x: x * 100, y: y * 100 })
  }

  return (
    <div
      ref={cardRef}
      data-card=""
      data-rarity={tier.rarity}
      data-frame={frame}
      data-card-back={hasArt ? undefined : ''}
      style={{
        '--card-accent': accent,
        '--mouse-x': `${mousePos.x}%`,
        '--mouse-y': `${mousePos.y}%`,
        transform: interactive && hovered
          ? `perspective(1000px) rotateX(${tilt.rotateX.toFixed(2)}deg) rotateY(${tilt.rotateY.toFixed(2)}deg) scale3d(1.02, 1.02, 1.02)`
          : undefined,
      } as CSSProperties}
      className={classes(
        TCG_CARD.frame,
        interactive && classes('cursor-pointer', MOTION.transition.transform, 'active:scale-(--scale-press-sm)'),
        selected && classes('ring-2 ring-retro-accent', 'z-[var(--z-dropdown)]'),
        className,
      )}
      onMouseMove={handleMove}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setTilt({ rotateX: 0, rotateY: 0 }) }}
    >
      <div className={TCG_CARD.foil} aria-hidden="true" />
      <div className={TCG_CARD.inner}>
        {plate && (
          <div className={TCG_CARD.plate}>
            <span className={TCG_CARD.plateTitle} title={title}>{title}</span>
            <span className={TCG_CARD.plateGem} aria-hidden="true" />
          </div>
        )}

        {/* Inset art window: signed bytes (or a direct snapshot URL) keep the
            HoloCard; a row nobody holds shows the woven back, not a blank. */}
        <div className={TCG_CARD.artWindow}>
          {hasArt ? (
            <CardArtwork
              objectId={objectId}
              src={src}
              identity={identity}
              width={width}
              height={height}
              isVideo={isVideo}
            >
              <span className={classes(TCG_CARD.rarityChip, tier.badgeClass)}>{tier.label}</span>
              {children}
            </CardArtwork>
          ) : (
            <div className={TCG_CARD.back} role="status" aria-label="Card back — no artwork available">
              <span className={TCG_CARD.backCore} aria-hidden="true" />
            </div>
          )}
          {clicker && (
            <span data-clicker-badge="" className={classes('absolute top-2 right-2 z-20', CHROME.cardChip)} title="Found in the clicker game">clicker!</span>
          )}
        </div>

        {/* Stat row — the card's printed valuation. */}
        <div className={TCG_CARD.statRow}>
          <span className={TCG_CARD.statLabel}>Value</span>
          <span className={TCG_CARD.statValue}>{hasValue ? formatGc(value) : '—'}</span>
        </div>

        {plate && footerExtra && (
          <div className={TCG_CARD.footer}>{footerExtra}</div>
        )}
      </div>
    </div>
  )
}
