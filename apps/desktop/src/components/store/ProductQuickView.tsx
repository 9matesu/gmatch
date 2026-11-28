"use client";

/**
 * The store's quick-view sheet: a real detail for one product without leaving
 * the grid. A card gets the FULL premium `GameCard` (the tile only carries a
 * thumbnail); gear gets its token-drawn poster. Description, tags, seller and
 * price are whatever the catalogue row actually supplied — nothing is invented.
 */
import { Heart, Sparkles } from 'lucide-react';
import { RARITY_TIERS, formatGc } from '@orbit/shared';
import { Button, SideSheet } from '../../ui/kit';
import { GameCard } from '../cards/GameCard';
import {
  classes, CHROME, COLOR, GAP, ICON, MONO, MOTION, PADDING_X, RADIUS,
  STATUS, TRACKING, TYPE, WEIGHT,
} from '../../ui/tokens';
import { GearPoster } from './ProductTile';
import type { StoreProduct } from './storeCatalog';

interface IdentityLike {
  orbitId: string;
  publicKeyHex: string;
  privateKeyHex: string;
}

export interface ProductQuickViewProps {
  product: StoreProduct | null;
  identity: IdentityLike | null;
  wishlisted: boolean;
  onToggleWishlist: () => void;
  onBuy: () => void;
  buying: boolean;
  canAfford: boolean;
  onOpenDetail: () => void;
  onOpenOwner?: (userId: string) => void;
  onClose: () => void;
}

export function ProductQuickView({
  product, identity, wishlisted, onToggleWishlist, onBuy, buying, canAfford,
  onOpenDetail, onOpenOwner, onClose,
}: ProductQuickViewProps) {
  const tier = product?.rarity ? RARITY_TIERS[product.rarity] : null;
  const tags = product?.card?.tags ?? [];
  const description = product?.item?.desc || product?.card?.description || null;
  const sellerName = product?.sellerName || (product?.sellerId ? `User_${product.sellerId.slice(0, 6)}` : null);

  return (
    <SideSheet open={Boolean(product)} onClose={onClose} title={product?.name ?? 'Product'}>
      {product && (
        <div className="space-y-3">
          <div className="mx-auto max-w-[220px]">
            {product.card ? (
              <GameCard
                objectId={product.card.mediaObjectId ?? null}
                src={product.card.contentUrl}
                identity={identity}
                width={220}
                height={220}
                isVideo={Boolean(product.card.mimeType?.startsWith('video/'))}
                name={product.card.name}
                rarity={tier ?? undefined}
                value={product.card.value ?? 0}
                accentColor={product.card.accentColor}
                frame={product.card.frame}
                interactive
              />
            ) : (
              <div className={classes(CHROME.tile, 'overflow-hidden')}>
                <GearPoster product={product} />
              </div>
            )}
          </div>

          <div className={classes('flex items-center justify-between', GAP[2])}>
            {tier ? (
              <span
                className={classes(TYPE.caption, WEIGHT.bold, 'uppercase', TRACKING.wider, RADIUS.chip, PADDING_X[1.5], 'py-0.5', 'border')}
                style={{ color: tier.accentColor, borderColor: `${tier.accentColor}66`, backgroundColor: `${tier.accentColor}14` }}
              >
                {tier.label}
              </span>
            ) : <span />}
            <span className={classes(TYPE.sub, MONO, WEIGHT.bold, STATUS.info, 'tabular-nums')}>
              {product.price != null ? formatGc(product.price) : product.value != null ? `${formatGc(product.value)} value` : '—'}
            </span>
          </div>

          {description && <p className={classes(TYPE.body, COLOR.body)}>{description}</p>}

          {tags.length > 0 && (
            <div className={classes('flex flex-wrap', GAP[1.5])}>
              {tags.map((t) => (
                <span key={t} className={classes(CHROME.badge, PADDING_X[1.5], 'py-0.5', COLOR.muted)}>{t}</span>
              ))}
            </div>
          )}

          {product.source === 'market' && (
            <div className={classes(TYPE.caption, COLOR.muted)}>
              {product.own ? 'Your listing' : 'Sold by '}
              {!product.own && (
                <button
                  type="button"
                  onClick={() => product.sellerId && onOpenOwner?.(product.sellerId)}
                  className={classes(WEIGHT.medium, COLOR.body, COLOR.hoverAccent, 'hover:underline cursor-pointer', MOTION.transition.micro)}
                >
                  {sellerName}
                </button>
              )}
            </div>
          )}

          <div className={classes('flex items-center', GAP[2], 'pt-1')}>
            <Button
              type="button"
              variant="secondary"
              aria-pressed={wishlisted}
              onClick={onToggleWishlist}
              className={classes('flex items-center', GAP[1.5])}
            >
              <Heart className={classes(ICON.sm, wishlisted ? STATUS.danger : undefined)} fill={wishlisted ? 'currentColor' : 'none'} aria-hidden />
              {wishlisted ? 'Wishlisted' : 'Wishlist'}
            </Button>
            {product.source === 'collection' ? (
              <Button type="button" variant="secondary" onClick={onOpenDetail}>Manage card</Button>
            ) : product.own ? (
              <span className={classes(TYPE.caption, COLOR.muted)}>This is your listing — cancel it from your card.</span>
            ) : (
              <Button
                type="button"
                variant={product.source === 'gear' ? 'danger' : 'primary'}
                disabled={buying || !canAfford}
                onClick={onBuy}
              >
                {buying ? 'Buying...' : `Buy for ${formatGc(product.price ?? 0)}`}
              </Button>
            )}
            {product.card && product.source === 'market' && (
              <Button type="button" variant="ghost" onClick={onOpenDetail}>
                <Sparkles className={ICON.sm} aria-hidden /> Details
              </Button>
            )}
          </div>
        </div>
      )}
    </SideSheet>
  );
}
