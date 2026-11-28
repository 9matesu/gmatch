"use client";

import { useState, useEffect, useMemo } from 'react';
import { STORE_ITEMS, type StoreItem, type User, formatGc, computeCashoutPayout, clampCashoutRateBps, DEFAULT_CASHOUT_RATE_BPS } from '@orbit/shared';
import { orbitFetch, invalidateCache } from '../utils/api';
import type { OrbitIdentity } from '@orbit/crypto';
import type { ActiveHackSession } from './home/CommandIsland';
import { playPress } from '../utils/sounds';
import { formatCount } from '../ui/format';
import { Button, PageHeader, Input, Select, FeedbackState } from '../ui/kit';
import {
  classes, CHROME, COLOR, FEEDBACK, GAP, ICON, MONO, MOTION, PADDING, PADDING_X,
  PADDING_Y, RADIUS, RECIPE, STATUS, TRACKING, TYPE, WEIGHT,
} from '../ui/tokens';
import type { CanonicalCard } from '../utils/cardCollection';
import { TargetSelectorModal } from './hacks/TargetSelectorModal';
import { CardDetailView } from './CardDetailView';
import { ObjectImage } from './ObjectImage';
import {
  Zap,
  Coins,
  Sparkles,
  Layers,
  EyeOff,
  Flame,
  ShieldAlert,
  Search,
  ShoppingBag,
} from 'lucide-react'
import { ProductTile, productIcon } from './store/ProductTile';
import { ProductQuickView } from './store/ProductQuickView';
import { useStoreLocal } from './store/useStoreLocal';
import {
  STORE_CATEGORIES, STORE_SORTS, buildStoreProducts, filterAndSortProducts, productsForKeys,
  type StoreCategory, type StoreMarketListing, type StoreProduct, type StoreSort,
} from './store/storeCatalog';

/** One compact, single-line search shell — the chat search's py-1.5 height,
 *  with the field's own fg/placeholder roles. No glass tier, no tall block. */
const SEARCH_SHELL = classes(
  RADIUS.control, 'border', COLOR.edge, COLOR.canvasSurface,
  PADDING_X[2.5], PADDING_Y[1.5], 'flex items-center', GAP[2], TYPE.body, COLOR.fg,
);

interface IdentityLike {
  orbitId: string;
  publicKeyHex: string;
  privateKeyHex: string;
}

/** A small thumb in the recently-viewed strip. Card art resolves signed bytes. */
function RecentChip({ product, identity, onClick }: { product: StoreProduct; identity: IdentityLike | null; onClick: () => void }) {
  const Icon = productIcon(product);
  return (
    <button
      type="button"
      onClick={onClick}
      title={product.name}
      className={classes(
        CHROME.tile, 'shrink-0 w-16 overflow-hidden cursor-pointer',
        MOTION.transition.quick, COLOR.hoverEdgeStrong,
      )}
    >
      <span className={classes('block aspect-square w-full overflow-hidden', COLOR.canvasSurface)}>
        {product.card ? (
          <ObjectImage
            objectId={product.card.mediaObjectId ?? null}
            contentUrl={product.card.contentUrl ?? null}
            mimeType={product.card.mimeType ?? null}
            identity={identity}
            alt=""
            thumb
            className="w-full h-full object-cover"
          />
        ) : (
          <span className={classes('flex h-full w-full items-center justify-center', 'bg-gradient-to-br from-retro-accent/15 to-transparent')}>
            <Icon className={COLOR.accent} size={20} aria-hidden />
          </span>
        )}
      </span>
      <span className={classes('block px-1 py-0.5', TYPE.caption, COLOR.muted, 'truncate')}>{product.name}</span>
    </button>
  );
}

export function StoreTab({ points, onPurchase, onDeployHack, identity, onOpenCardCollection, onOpenFlash, onOpenOwner, users = [], profilePics = {}, toast, arsenalOnly = false }: {
  points: number;
  onPurchase?: (item: StoreItem) => void;
  onUseConsumable?: (item: StoreItem) => void;
  onDeployHack?: (session: ActiveHackSession) => void;
  identity?: OrbitIdentity | null;
  onOpenCardCollection?: () => void;
  onOpenFlash?: () => void;
  /** Open a user's profile from a card's owner credit. */
  onOpenOwner?: (userId: string) => void;
  users?: User[];
  profilePics?: Record<string, string>;
  toast?: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  /** Hack-arsenal embed (PC Domination): only hack items, no shop grid. */
  arsenalOnly?: boolean;
}) {
  const [storeItems, setStoreItems] = useState<StoreItem[]>(STORE_ITEMS);
  const [targetModalItem, setTargetModalItem] = useState<StoreItem | null>(null);
  const [inventory, setInventory] = useState<Record<string, number>>({});
  const [buying, setBuying] = useState<string | null>(null);
  const [portfolio, setPortfolio] = useState<CanonicalCard[]>([]);
  const [cashoutRate, setCashoutRate] = useState<number>(DEFAULT_CASHOUT_RATE_BPS);
  const [confirmCashoutAll, setConfirmCashoutAll] = useState(false);
  const [cashingOutAll, setCashingOutAll] = useState(false);
  const [cashoutProgress, setCashoutProgress] = useState<{ done: number; total: number } | null>(null);
  const [marketListings, setMarketListings] = useState<StoreMarketListing[]>([]);
  const [buyingCardId, setBuyingCardId] = useState<string | null>(null);
  const [detailCardId, setDetailCardId] = useState<string | null>(null);
  const [quickViewKey, setQuickViewKey] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<StoreCategory>('all');
  const [sort, setSort] = useState<StoreSort>('featured');

  const myId = identity?.orbitId ?? null;
  const { wishlist, recent, toggleWishlist, pushRecent } = useStoreLocal(myId);

  // Community market (Steam-style): open listings, newest first.
  const refreshMarket = () => {
    if (!identity) return;
    orbitFetch('/api/cards/market?limit=48', {}, identity)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!Array.isArray(data?.listings)) return;
        // Every listing carries its seller id, and the seller is the card's
        // current owner — so the joined `card.ownerName` IS the seller name.
        // Lift it out so the grid can credit them without a directory lookup.
        setMarketListings(
          data.listings.map((l: StoreMarketListing) => ({ ...l, sellerName: l.card?.ownerName ?? null })),
        );
      })
      .catch(() => { });
  };

  useEffect(() => {
    if (arsenalOnly) return;
    refreshMarket();
    const onCards = () => refreshMarket();
    window.addEventListener('orbit-cards-refresh', onCards);
    return () => window.removeEventListener('orbit-cards-refresh', onCards);
  }, [identity, arsenalOnly]);

  const buyListing = async (listing: { cardId: string; price: number }) => {
    if (!identity || buyingCardId) return;
    setBuyingCardId(listing.cardId);
    try {
      const res = await orbitFetch(`/api/cards/${listing.cardId}/buy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idempotency_key: crypto.randomUUID() }),
      }, identity);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast?.(data?.error || 'Could not buy this card', 'error');
        return;
      }
      toast?.(`Bought for ${formatGc(listing.price)}. It's in your collection`, 'success');
      refreshMarket();
      window.dispatchEvent(new CustomEvent('orbit-cards-refresh'));
      window.dispatchEvent(new CustomEvent('orbit-score-refresh'));
    } catch {
      toast?.('Network error while buying', 'error');
    } finally {
      setBuyingCardId(null);
    }
  };

  // Fetch dynamic store items and pricing from backend
  useEffect(() => {
    if (!identity) return;
    orbitFetch('/api/users/store/items', {}, identity)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (Array.isArray(data?.items)) {
          setStoreItems(data.items);
        }
      })
      .catch(() => { });
  }, [identity]);

  // Fetch the caller's canonical card collection (portfolio) + cashout rate.
  useEffect(() => {
    if (!identity) return;
    let cancelled = false;

    orbitFetch('/api/cards', {}, identity)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !Array.isArray(data?.cards)) return;
        setPortfolio(data.cards.filter((c: CanonicalCard) => c.marketStatus !== 'cashed_out'));
      })
      .catch(() => { });

    orbitFetch('/api/economy/cashout-rate', {}, identity)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        setCashoutRate(clampCashoutRateBps(data?.rateBps));
      })
      .catch(() => { });

    return () => {
      cancelled = true;
    };
  }, [identity]);

  const refreshPortfolio = () => {
    if (!identity) return;
    orbitFetch('/api/cards', {}, identity)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!Array.isArray(data?.cards)) return;
        setPortfolio(data.cards.filter((c: CanonicalCard) => c.marketStatus !== 'cashed_out'));
      })
      .catch(() => { });
  };

  const handleCashOutAll = async () => {
    if (!identity || cashingOutAll) return;
    const cashable = portfolio.filter((c) => c.marketStatus !== 'cashed_out' && c.marketStatus !== 'listed');
    if (cashable.length === 0) {
      toast?.('No cards available to cash out', 'warning');
      setConfirmCashoutAll(false);
      return;
    }

    setCashingOutAll(true);
    setCashoutProgress({ done: 0, total: cashable.length });
    playPress(880);

    let payout = 0;
    let failed = 0;
    for (let i = 0; i < cashable.length; i++) {
      const card = cashable[i];
      try {
        const res = await orbitFetch(
          `/api/cards/${card.id}/cashout`,
          {
            method: 'POST',
            body: JSON.stringify({ idempotency_key: crypto.randomUUID() }),
          },
          identity
        );
        const data = await res.json().catch(() => ({ error: 'Cashout failed' }));
        if (res.ok) {
          payout += Number(data.payout || 0);
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
      setCashoutProgress({ done: i + 1, total: cashable.length });
    }

    playPress(820);
    refreshPortfolio();
    window.dispatchEvent(new CustomEvent('orbit-cards-refresh'));
    window.dispatchEvent(new CustomEvent('orbit-score-refresh'));

    const cashedCount = cashable.length - failed;
    if (cashedCount > 0) {
      toast?.(`Cashed out ${cashedCount} card${cashedCount === 1 ? '' : 's'} for ${formatGc(payout)}.`, 'success');
    } else {
      toast?.('No cards were cashed out', 'error');
    }
    if (failed > 0 || portfolio.length > cashable.length) {
      const extra: string[] = [];
      if (failed > 0) extra.push(`${failed} failed`);
      if (portfolio.length > cashable.length) extra.push(`${portfolio.length - cashable.length} listed/skipped`);
      toast?.(`Skipped: ${extra.join(', ')}`, 'info');
    }

    setConfirmCashoutAll(false);
    setCashingOutAll(false);
    setCashoutProgress(null);
  };

  const refreshInventory = () => {
    if (!identity) return;
    orbitFetch('/api/users/store/inventory', {}, identity)
      .then((r) => (r.ok ? r.json() : []))
      .then((items: { item_id: string; quantity: number }[]) => {
        if (!Array.isArray(items)) return;
        const next: Record<string, number> = {};
        for (const it of items) {
          if (it && typeof it.item_id === 'string') next[it.item_id] = Number(it.quantity || 0);
        }
        setInventory(next);
      })
      .catch(() => { });
  };

  useEffect(() => {
    refreshInventory();
  }, [identity]);

  const handleBuy = async (item: StoreItem, targetId?: string, targetName?: string) => {
    if (points < item.cost || !identity || buying) return;

    if (item.category === 'hack' && item.id === 'item-flash-drop') {
      // Flash Drop broadcasts to everyone online — no single target needed.
      // If a charge is already in inventory, fire it directly instead.
      if ((inventory[item.id] || 0) > 0) {
        playPress(920);
        onOpenFlash?.();
        return;
      }
    } else if (item.category === 'hack' && !targetId) {
      setTargetModalItem(item);
      return;
    }

    setBuying(item.id);
    playPress(880);
    try {
      const res = await orbitFetch(
        '/api/users/store/purchase',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ item_id: item.id, target_id: targetId, idempotency_key: crypto.randomUUID() }),
        },
        identity
      );
      if (res.ok) {
        playPress(820);
        toast?.(`Purchased ${item.name}`, 'success');
        onPurchase?.(item);
        // A purchase moves the wallet, so the balance everywhere (top bar,
        // Store, rankings) is now stale. invalidateCache because /api/users is
        // served from the 3s response cache, which would otherwise hand back
        // the pre-purchase snapshot.
        invalidateCache('/api/users');
        window.dispatchEvent(new CustomEvent('orbit-score-refresh'));

        if (item.category === 'hack' && targetId) {
          // The debuff window is the SERVER's: read it off the purchase
          // response, and only fall back to polling if an older node omits it.
          const bought = await res.json().catch(() => null as { debuff?: { expires_at?: number } } | null);
          const expiresAt = Number(bought?.debuff?.expires_at) || 0;
          setTimeout(() => {
            onDeployHack?.({
              itemId: item.id,
              itemName: item.name,
              targetUserId: targetId,
              targetUserName: targetName || 'Target Player',
              expiresAt,
            });
            if (!expiresAt) toast?.('Session length unknown. Recheck the Hacks tab for the timer', 'info');
          }, 0);
          return;
        }

        if (item.category === 'hack' && item.id === 'item-flash-drop') {
          refreshInventory();
          onOpenFlash?.();
          return;
        }

        if (item.consumable) {
          refreshInventory();
        }
      } else {
        const err = await res.json().catch(() => ({ error: 'Purchase failed' }));
        toast?.(err.error || 'Purchase failed', 'error');
      }
    } catch {
      toast?.('Network error during purchase', 'error');
    } finally {
      setBuying(null);
    }
  };

  const arsenalItems = storeItems.filter((item) => item.category === 'hack');

  // Keep the portfolio dashboard in sync when cards change elsewhere.
  useEffect(() => {
    const onCardsRefresh = () => refreshPortfolio();
    window.addEventListener('orbit-cards-refresh', onCardsRefresh);
    return () => window.removeEventListener('orbit-cards-refresh', onCardsRefresh);
  }, [identity]);

  const portfolioValue = portfolio.reduce((a, c) => a + Number(c.value || 0), 0);
  // Estimate the SAME set handleCashOutAll actually pays. Counting listed
  // cards here promised a payout that the confirm step explicitly skips.
  const cashoutEstimate = portfolio
    .filter((c) => c.marketStatus !== 'cashed_out' && c.marketStatus !== 'listed')
    .reduce((a, c) => a + computeCashoutPayout(c.value, cashoutRate), 0);
  const cashableCount = portfolio.filter((c) => c.marketStatus !== 'cashed_out' && c.marketStatus !== 'listed').length;
  const skippedCount = portfolio.length - cashableCount;

  // One catalogue, three real sources. Gear + market + own cards.
  const products = useMemo(
    () => buildStoreProducts({ items: storeItems, listings: marketListings, portfolio, myId }),
    [storeItems, marketListings, portfolio, myId],
  );

  const visible = useMemo(
    () => filterAndSortProducts(products, { query, category, sort }),
    [products, query, category, sort],
  );

  const recentProducts = useMemo(() => productsForKeys(products, recent), [products, recent]);
  const quickViewProduct = useMemo(
    () => (quickViewKey ? products.find((p) => p.key === quickViewKey) ?? null : null),
    [products, quickViewKey],
  );

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: products.length, gear: 0, market: 0, collection: 0 };
    for (const p of products) counts[p.source] += 1;
    return counts;
  }, [products]);

  const openQuickView = (p: StoreProduct) => {
    setQuickViewKey(p.key);
    pushRecent(p.key);
  };

  const buyProduct = (p: StoreProduct) => {
    if (p.source === 'gear' && p.item) {
      void handleBuy(p.item);
    } else if (p.source === 'market' && p.cardId) {
      void buyListing({ cardId: p.cardId, price: p.price ?? 0 });
    }
  };
  const buyingProduct = (p: StoreProduct) => (p.source === 'gear' ? buying === p.item?.id : buyingCardId === (p.cardId ?? ''));
  const canAffordProduct = (p: StoreProduct) => p.price != null && points >= p.price;

  return (
    <div className="w-full space-y-3 font-sans select-none text-retro-fg">
      {!arsenalOnly && (
      <>
      {/* Header: one title, one number. The balance is the datum, so it sits
          here instead of being repeated in a dashboard card. */}
      <PageHeader
        title="Store"
        action={
          <div className={classes('flex items-center', GAP[2])}>
            {onOpenCardCollection && (
              <Button type="button" variant="secondary" size="sm" onClick={onOpenCardCollection} className="whitespace-nowrap">
                View collection
              </Button>
            )}
            <div className={classes(RECIPE.card, PADDING_X[3], PADDING_Y[1.5], COLOR.interactive, 'flex items-center', GAP[1.5])}>
              <Coins className={classes(ICON.sm, COLOR.accent)} />
              <span className={classes(TYPE.sub, WEIGHT.medium, MONO, COLOR.fg, 'tabular-nums')}>g$ {formatCount(points)}</span>
            </div>
          </div>
        }
      />

      {/* Wallet bar: one dense, opaque plate. Portfolio value + the SAME set
          cash-out-all pays, side by side with a hairline divider. The balance
          is the datum, so it lives here instead of in a tall dashboard card. */}
      <section className={classes(CHROME.tile, 'grid grid-cols-1 sm:grid-cols-2', GAP[0])}>
        <div className={classes(PADDING_X[3], PADDING_Y[2.5], 'min-w-0')}>
          <div className={classes('flex items-center', GAP[1.5], COLOR.muted, TYPE.caption, WEIGHT.semibold, 'uppercase', TRACKING.wider)}>
            <Layers className={ICON.sm} />
            Portfolio Value
          </div>
          <div className={classes('mt-0.5 flex items-baseline', GAP[2])}>
            <span className={classes(TYPE.title, WEIGHT.bold, MONO, 'tabular-nums', COLOR.fg)}>{formatGc(portfolioValue)}</span>
            <span className={classes(TYPE.caption, COLOR.muted)}>{portfolio.length} card{portfolio.length === 1 ? '' : 's'}</span>
          </div>
        </div>

        <div className={classes(PADDING_X[3], PADDING_Y[2.5], 'min-w-0', 'border-t sm:border-t-0 sm:border-l', COLOR.edgeSubtle)}>
          <div className={classes('flex items-start justify-between', GAP[2])}>
            <div className="min-w-0">
              <div className={classes('flex items-center', GAP[1.5], STATUS.warning, TYPE.caption, WEIGHT.semibold, 'uppercase', TRACKING.wider)}>
                <Sparkles className={ICON.sm} />
                Cashout Value
              </div>
              <div className={classes('mt-0.5', TYPE.title, WEIGHT.bold, MONO, 'tabular-nums', STATUS.warning)}>{formatGc(cashoutEstimate)}</div>
            </div>
            <span className={classes(TYPE.caption, COLOR.muted, MONO, 'tabular-nums', 'shrink-0')}>{(cashoutRate / 100).toFixed(1)}%</span>
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <span className={classes(TYPE.caption, COLOR.muted)}>
              {cashableCount} cashable{skippedCount > 0 ? ` · ${skippedCount} listed skipped` : ''}
            </span>
            {!cashingOutAll && !confirmCashoutAll && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  playPress(780);
                  setConfirmCashoutAll(true);
                }}
                disabled={cashableCount === 0}
                className={classes('flex items-center', GAP[1.5], STATUS.warning)}
              >
                <Coins className={ICON.sm} />
                Cash Out All
              </Button>
            )}
          </div>

          {cashingOutAll && cashoutProgress ? (
            <div className={classes('mt-2 flex items-center', GAP[2], TYPE.body, STATUS.warning, WEIGHT.medium)}>
              <span className={RECIPE.spinner} />
              Cashing out {cashoutProgress.done}/{cashoutProgress.total}...
            </div>
          ) : confirmCashoutAll ? (
            <div className={classes('mt-2 flex flex-wrap items-center', GAP[2])}>
              <span className={classes(TYPE.caption, COLOR.body)}>
                Cash out {cashableCount} card{cashableCount === 1 ? '' : 's'} for ~{formatGc(cashoutEstimate)}?
              </span>
              <div className={classes('flex items-center', GAP[1.5])}>
                <Button type="button" variant="secondary" size="sm" onClick={() => void handleCashOutAll()}>
                  Confirm
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmCashoutAll(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {/* Toolbar rail: search + sort + category chips on ONE dense row that
          wraps. The chips ARE the category filter, so there is no second
          heading repeating "Shop". */}
      <section className={classes(CHROME.tile, PADDING[2.5], 'flex flex-col gap-2.5')}>
        <div className={classes('flex flex-col sm:flex-row sm:items-center', GAP[2])}>
          <div className={classes(SEARCH_SHELL, 'flex-1')}>
            <Search className={classes(ICON.sm, COLOR.muted)} aria-hidden />
            <Input
              bare
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search cards, tags, gear..."
              aria-label="Search the store"
            />
          </div>
          <Select value={sort} onChange={(e) => setSort(e.target.value as StoreSort)} aria-label="Sort products">
            {STORE_SORTS.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </Select>
        </div>
        <div className={classes('flex flex-wrap items-center', GAP[1.5])}>
          {STORE_CATEGORIES.map((c) => {
            const active = category === c.id;
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={active}
                onClick={() => setCategory(c.id)}
                className={classes(
                  RADIUS.chip, PADDING_X[2.5], PADDING_Y[1], TYPE.body, WEIGHT.semibold,
                  'border cursor-pointer', MOTION.transition.micro,
                  active ? classes(COLOR.accentBg, COLOR.onAccent, COLOR.accentEdge) : classes(COLOR.glassW8, COLOR.edge, COLOR.muted, COLOR.hoverFg),
                )}
              >
                {c.label}
                <span className={classes('ml-1.5', MONO, 'tabular-nums', active ? undefined : COLOR.faint)}>
                  {categoryCounts[c.id] ?? 0}
                </span>
              </button>
            );
          })}
          <span className={classes('ml-auto', TYPE.caption, COLOR.muted, MONO, 'tabular-nums')}>
            {visible.length} item{visible.length === 1 ? '' : 's'}
          </span>
        </div>
      </section>

      {/* Recently viewed — local-only, per identity. */}
      {recentProducts.length > 0 && (
        <section className="space-y-1.5">
          <h3 className={classes(CHROME.sectionLabel)}>Recently viewed</h3>
          <div className={classes('flex overflow-x-auto pb-1', GAP[2])}>
            {recentProducts.map((p) => (
              <RecentChip key={p.key} product={p} identity={identity ?? null} onClick={() => openQuickView(p)} />
            ))}
          </div>
        </section>
      )}

      {/* The shop floor: one dense, aligned tile grid. */}
      <section>
        {visible.length === 0 ? (
          <FeedbackState
            icon={<ShoppingBag className={FEEDBACK.icon} />}
            title={products.length === 0 ? 'Nothing in the store yet' : 'No matches'}
            description={products.length === 0 ? 'Gear, community listings and your cards show up here.' : 'Try another search or category.'}
          />
        ) : (
          <div
            data-testid="store-grid"
            className={classes('grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5', GAP[2.5], 'items-stretch')}
          >
            {visible.map((p) => (
              <ProductTile
                key={p.key}
                product={p}
                identity={identity ?? null}
                wishlisted={wishlist.includes(p.key)}
                onToggleWishlist={() => toggleWishlist(p.key)}
                onQuickView={() => openQuickView(p)}
                onOpenDetail={() => p.cardId && setDetailCardId(p.cardId)}
                onBuy={() => buyProduct(p)}
                buying={buyingProduct(p)}
                canAfford={canAffordProduct(p)}
                onOpenOwner={onOpenOwner}
              />
            ))}
          </div>
        )}
      </section>

      {/* Inventory (read-only) */}
      {(() => {
        const owned = storeItems.filter((item) => (inventory[item.id] || 0) > 0);
        if (owned.length === 0) return null;
        return (
          <section className={classes(CHROME.tile, PADDING[3])}>
            <h3 className={classes(CHROME.sectionLabel, 'mb-2')}>Inventory</h3>
            <div className={classes('grid grid-cols-1 sm:grid-cols-2', GAP[1.5])}>
              {owned.map((item) => (
                <div key={item.id} className={classes(CHROME.rowTile, 'flex items-center', GAP[2.5])}>
                  <span className={classes('min-w-0 flex-1 truncate', TYPE.body, COLOR.body)}>{item.name}</span>
                  <span className={classes(TYPE.body, MONO, 'tabular-nums', COLOR.muted, 'shrink-0')}>x{inventory[item.id]}</span>
                </div>
              ))}
            </div>
          </section>
        );
      })()}
      </>
      )}

      {/* Store Items Grid (arsenal mode only: hack buy/deploy) */}
      {arsenalOnly && (
      <div className={classes('grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3', GAP[4])}>
        {arsenalItems.map((item) => {
          const count = inventory[item.id] || 0;
          const canAfford = points >= item.cost;

          return (
            <div
              key={item.id}
              className={classes(CHROME.statTile, 'flex flex-col justify-between', STATUS.dangerEdge)}
            >
              <div className={classes('space-y-2')}>
                <div className="flex items-start justify-between">
                  <div className={classes(PADDING[2.5], RADIUS.control, 'border', STATUS.dangerBg, STATUS.dangerEdge, STATUS.danger)}>
                    {item.id === 'item-hack-deny' && <EyeOff className={ICON.lg} />}
                    {item.id === 'item-hack-mobile' && <Flame className={ICON.lg} />}
                    {item.id === 'item-flash-drop' && <Zap className={classes(ICON.lg, STATUS.warning)} />}
                  </div>

                  {item.badge && (
                    <span className={classes(TYPE.caption, WEIGHT.medium, PADDING_X[2], 'py-0.5', RADIUS.chip, 'border', STATUS.dangerBg, STATUS.danger, STATUS.dangerEdge)}>
                      {item.badge}
                    </span>
                  )}
                </div>

                <div>
                  <h4 className={classes(TYPE.sub, WEIGHT.medium, COLOR.fg)}>{item.name}</h4>
                  <p className={classes(FEEDBACK.description, 'mt-1')}>{item.desc}</p>
                </div>
              </div>

              <div className={classes('pt-3 border-t mt-3 flex items-center justify-between', COLOR.edge, GAP[2])}>
                <span className={classes(TYPE.sub, WEIGHT.medium, MONO, 'tabular-nums', STATUS.danger)}>
                  g$ {formatCount(item.cost)}
                </span>

                <Button
                  type="button"
                  variant="danger"
                  onClick={() => handleBuy(item)}
                  disabled={!canAfford || buying === item.id}
                  className={classes('flex items-center', GAP[1.5])}
                >
                  <ShieldAlert className={ICON.sm} />
                  <span>{buying === item.id ? 'Deploying...' : (item.id === 'item-flash-drop' && count > 0 ? 'Fire' : 'Deploy')}</span>
                </Button>
              </div>
            </div>
          );
        })}
      </div>
      )}

      {/* Target Selector Modal for Hacking Services (any mode) */}
      {targetModalItem && (
        <TargetSelectorModal
          isOpen={Boolean(targetModalItem)}
          onClose={() => setTargetModalItem(null)}
          item={targetModalItem}
          users={users}
          profilePics={profilePics}
          myOrbitId={identity?.orbitId || ''}
          onConfirmTarget={(targetUser) => {
            const itemToBuy = targetModalItem;
            setTargetModalItem(null);
            handleBuy(itemToBuy, targetUser.id, targetUser.display_name || 'Target Player');
          }}
        />
      )}

      {/* Quick-view sheet for one product. */}
      <ProductQuickView
        product={quickViewProduct}
        identity={identity ?? null}
        wishlisted={Boolean(quickViewProduct && wishlist.includes(quickViewProduct.key))}
        onToggleWishlist={() => quickViewProduct && toggleWishlist(quickViewProduct.key)}
        onBuy={() => quickViewProduct && buyProduct(quickViewProduct)}
        buying={Boolean(quickViewProduct && buyingProduct(quickViewProduct))}
        canAfford={Boolean(quickViewProduct && canAffordProduct(quickViewProduct))}
        onOpenDetail={() => {
          if (quickViewProduct?.cardId) setDetailCardId(quickViewProduct.cardId);
        }}
        onOpenOwner={onOpenOwner}
        onClose={() => setQuickViewKey(null)}
      />

      {/* Card detail (Steam-style card modal) — buy / list / cashout / transfer */}
      {!arsenalOnly && detailCardId && (
        <CardDetailView
          cardId={detailCardId}
          identity={identity ?? null}
          onClose={() => { setDetailCardId(null); refreshMarket(); refreshPortfolio(); }}
          toast={toast}
        />
      )}
    </div>
  );
}
