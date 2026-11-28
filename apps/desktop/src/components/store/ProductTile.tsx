"use client";

/**
 * One product tile in the store grid: real art, real name, real price, one
 * wishlist action and one buy/detail action.
 *
 * Every control is a SIBLING of the others — a button inside a button is
 * invalid HTML and React warns on hydration — so the media/name open the quick
 * view, the heart toggles the wishlist, and the footer owns Buy / Details.
 *
 * Art is honest: a card renders its own bytes (thumbnailed through
 * `ObjectImage`), gear renders a token-drawn poster with its own icon. There is
 * never a broken image and never a fabricated photo.
 */
import type { LucideIcon } from 'lucide-react';
import { EyeOff, Flame, Heart, Package, Zap } from 'lucide-react';
import { RARITY_TIERS, formatGc } from '@orbit/shared';
import { ObjectImage } from '../ObjectImage';
import { Button } from '../../ui/kit';
import {
  classes, CHROME, COLOR, GAP, ICON, MONO, MOTION, PADDING, PADDING_X, PADDING_Y,
  RADIUS, STATUS, TRACKING, TYPE, WEIGHT,
} from '../../ui/tokens';
import type { StoreProduct } from './storeCatalog';

const ITEM_ICONS: Record<string, LucideIcon> = { Flame, EyeOff, Zap };

interface IdentityLike {
  orbitId: string;
  publicKeyHex: string;
  privateKeyHex: string;
}

export interface ProductTileProps {
  product: StoreProduct;
  identity: IdentityLike | null;
  wishlisted: boolean;
  onToggleWishlist: () => void;
  onQuickView: () => void;
  onOpenDetail: () => void;
  onBuy: () => void;
  buying: boolean;
  canAfford: boolean;
  onOpenOwner?: (userId: string) => void;
}

export function productIcon(product: StoreProduct): LucideIcon {
  return (product.item?.icon && ITEM_ICONS[product.item.icon]) || Package;
}

export function GearPoster({ product }: { product: StoreProduct }) {
  const Icon = productIcon(product);
  return (
    <div
      className={classes(
        'relative aspect-square w-full flex items-center justify-center overflow-hidden',
        'bg-gradient-to-br from-retro-accent/15 to-transparent',
        COLOR.canvasSurface,
      )}
    >
      <Icon className={COLOR.accent} size={44} aria-hidden />
      {product.item?.badge && (
        <span className={classes('absolute bottom-2 left-2', CHROME.badge, WEIGHT.bold, 'uppercase', TRACKING.wider)}>
          {product.item.badge}
        </span>
      )}
    </div>
  );
}

function CardArt({ product, identity }: { product: StoreProduct; identity: IdentityLike | null }) {
  return (
    <div className={classes('relative aspect-square w-full overflow-hidden', COLOR.canvasSurface)}>
      <ObjectImage
        objectId={product.card?.mediaObjectId ?? null}
        contentUrl={product.card?.contentUrl ?? null}
        mimeType={product.card?.mimeType ?? null}
        identity={identity}
        alt={product.name}
        thumb
        className="w-full h-full object-cover"
      />
    </div>
  );
}

export function ProductTile({
  product, identity, wishlisted, onToggleWishlist, onQuickView, onOpenDetail,
  onBuy, buying, canAfford, onOpenOwner,
}: ProductTileProps) {
  const tier = product.rarity ? RARITY_TIERS[product.rarity] : null;
  const sellerName = product.sellerName || (product.sellerId ? `User_${product.sellerId.slice(0, 6)}` : null);
  const priceLabel = product.price != null
    ? formatGc(product.price)
    : product.value != null ? `${formatGc(product.value)} value` : '—';

  return (
    <article
      className={classes(
        CHROME.tile, 'flex flex-col overflow-hidden h-full',
        MOTION.transition.quick, COLOR.hoverEdgeStrong,
      )}
    >
      <div className="relative">
        <button
          type="button"
          onClick={onQuickView}
          aria-label={`Quick view ${product.name}`}
          className="block w-full cursor-pointer"
        >
          {product.source === 'gear' ? <GearPoster product={product} /> : <CardArt product={product} identity={identity} />}
        </button>
        <button
          type="button"
          onClick={onToggleWishlist}
          aria-pressed={wishlisted}
          aria-label={wishlisted ? `Remove ${product.name} from wishlist` : `Add ${product.name} to wishlist`}
          className={classes('absolute top-2 right-2', CHROME.iconButton, COLOR.scrimSoft)}
        >
          <Heart
            className={classes(ICON.sm, wishlisted ? STATUS.danger : COLOR.onMedia)}
            fill={wishlisted ? 'currentColor' : 'none'}
            aria-hidden
          />
        </button>
      </div>

      <div className={classes(PADDING[2], 'flex flex-col flex-1', GAP[0.5], 'min-w-0')}>
        <button
          type="button"
          onClick={onQuickView}
          className={classes('text-left cursor-pointer', COLOR.hoverAccent, MOTION.transition.micro)}
        >
          <span className={classes(TYPE.body, WEIGHT.semibold, COLOR.fg, 'line-clamp-2')}>{product.name}</span>
        </button>

        {tier && (
          <span
            className={classes('self-start', TYPE.caption, WEIGHT.bold, 'uppercase', TRACKING.wider, RADIUS.chip, PADDING_X[1.5], 'py-0.5', 'border', 'tabular-nums', 'shrink-0')}
            style={{ color: tier.accentColor, borderColor: `${tier.accentColor}66`, backgroundColor: `${tier.accentColor}14` }}
          >
            {tier.label}
          </span>
        )}

        {product.source === 'market' && (
          <div className={classes('flex items-center', GAP[1], TYPE.caption, COLOR.muted, 'min-w-0')}>
            <span className="shrink-0">by</span>
            {product.own ? (
              <span className={classes('truncate', WEIGHT.medium, COLOR.body)}>you</span>
            ) : (
              <button
                type="button"
                onClick={() => product.sellerId && onOpenOwner?.(product.sellerId)}
                className={classes('min-w-0 truncate text-left', WEIGHT.medium, COLOR.body, COLOR.hoverAccent, 'hover:underline cursor-pointer', MOTION.transition.micro)}
                aria-label={`Open profile of ${sellerName}`}
              >
                {sellerName}
              </button>
            )}
          </div>
        )}

        {product.source === 'collection' && !product.own && product.sellerName && (
          <div className={classes(TYPE.caption, COLOR.muted, 'truncate')}>by {product.sellerName}</div>
        )}
      </div>

      <div className={classes('mt-auto flex items-center justify-between', GAP[1.5], PADDING_X[2], PADDING_Y[1.5], 'border-t', COLOR.edgeSubtle)}>
        <span className={classes(TYPE.sub, MONO, WEIGHT.bold, STATUS.info, 'tabular-nums', 'truncate')}>{priceLabel}</span>
        {product.own ? (
          <span className={classes(PADDING_X[2], PADDING_Y[1], RADIUS.chip, COLOR.interactive, COLOR.muted, TYPE.caption, WEIGHT.bold)} title="This is your own listing">
            Yours
          </span>
        ) : product.source === 'collection' ? (
          <Button type="button" variant="secondary" size="sm" onClick={onOpenDetail}>Details</Button>
        ) : (
          <Button
            type="button"
            variant={product.source === 'gear' ? 'danger' : 'info'}
            size="sm"
            disabled={buying || !canAfford}
            title={!canAfford ? 'Not enough g$' : undefined}
            onClick={onBuy}
          >
            {buying ? '...' : 'Buy'}
          </Button>
        )}
      </div>
    </article>
  );
}
