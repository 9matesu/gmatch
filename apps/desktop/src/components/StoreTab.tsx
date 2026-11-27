"use client";

import { useState, useEffect } from 'react';
import { STORE_ITEMS, type StoreItem, type User, formatGc, computeCashoutPayout, clampCashoutRateBps, DEFAULT_CASHOUT_RATE_BPS, RARITY_TIERS, computeCardRarity } from '@orbit/shared';
import { orbitFetch, invalidateCache } from '../utils/api';
import type { OrbitIdentity } from '@orbit/crypto';
import type { ActiveHackSession } from './home/CommandIsland';
import { playPress } from '../utils/sounds';
import { formatCount } from '../ui/format';
import { Button, PageHeader } from '../ui/kit';
import {
  classes, CHROME, COLOR, FEEDBACK, GAP, ICON, MONO, MOTION, PADDING, PADDING_X,
  PADDING_Y, RADIUS, RARITY, RECIPE, STATUS, TRACKING, TYPE, WEIGHT,
} from '../ui/tokens';
import type { CanonicalCard } from '../utils/cardCollection';
import { TargetSelectorModal } from './hacks/TargetSelectorModal';
import { CardDetailView } from './CardDetailView';
import {
  Zap,
  Coins,
  Sparkles,
  Layers,
  EyeOff,
  Flame,
  ShieldAlert,
  ArrowRight,
} from 'lucide-react'
import { GameCard } from './cards/GameCard';

/**
 * A row in the "your portfolio" table. `ownerName` is joined server-side with
 * the card; this projection used to discard it, so the table could only show a
 * bare card id, and the community market had no way to credit the seller even
 * though `sellerId` was in the payload.
 */
interface PortfolioCard {
  id: string;
  value: number;
  rarity: string;
  marketStatus: string;
  ownerId?: string;
  ownerName?: string | null;
  name?: string | null;
}

interface MarketListing {
  listingId: string;
  cardId: string;
  price: number;
  sellerId: string;
  sellerName?: string | null;
  card: CanonicalCard;
}

const RARITY_ORDER = ['common', 'copper', 'silver', 'gold', 'diamond'] as const;

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
  /** Hack-arsenal embed (PC Domination): only hack items, no dashboard/tabs. */
  arsenalOnly?: boolean;
}) {
  const [storeItems, setStoreItems] = useState<StoreItem[]>(STORE_ITEMS);
  const [targetModalItem, setTargetModalItem] = useState<StoreItem | null>(null);
  const [inventory, setInventory] = useState<Record<string, number>>({});
  const [buying, setBuying] = useState<string | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioCard[]>([]);
  const [cashoutRate, setCashoutRate] = useState<number>(DEFAULT_CASHOUT_RATE_BPS);
  const [confirmCashoutAll, setConfirmCashoutAll] = useState(false);
  const [cashingOutAll, setCashingOutAll] = useState(false);
  const [cashoutProgress, setCashoutProgress] = useState<{ done: number; total: number } | null>(null);
  const [marketListings, setMarketListings] = useState<MarketListing[]>([]);
  const [buyingCardId, setBuyingCardId] = useState<string | null>(null);
  const [marketCardId, setMarketCardId] = useState<string | null>(null);

  // Community market (Steam-style): open listings, newest first.
  const refreshMarket = () => {
    if (!identity) return;
    orbitFetch('/api/cards/market?limit=24', {}, identity)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!Array.isArray(data?.listings)) return;
        // Every listing carries its seller id, and the seller is the card's
        // current owner — so the joined `card.ownerName` IS the seller name.
        // Lift it out so the grid can credit them without a directory lookup.
        setMarketListings(
          data.listings.map((l: MarketListing) => ({ ...l, sellerName: l.card?.ownerName ?? null })),
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
      toast?.(`Bought for ${formatGc(listing.price)} g$. It's in your collection`, 'success');
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

  // Fetch the caller's canonical card collection (portfolio) + cashout rate for
  // the store dashboard.
  useEffect(() => {
    if (!identity) return;
    let cancelled = false;

    orbitFetch('/api/cards', {}, identity)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !Array.isArray(data?.cards)) return;
        setPortfolio(
          data.cards
            .filter((c: CanonicalCard) => c.marketStatus !== 'cashed_out')
            .map((c: CanonicalCard) => ({
              id: c.id,
              value: Number(c.value || 0),
              rarity: String(c.rarity || 'common'),
              marketStatus: String(c.marketStatus || 'none'),
              // Keep the identity fields: the table credits each card by name.
              ownerId: c.ownerId,
              ownerName: c.ownerName ?? null,
              name: c.name ?? null,
            }))
        );
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
        setPortfolio(
          data.cards
            .filter((c: CanonicalCard) => c.marketStatus !== 'cashed_out')
            .map((c: CanonicalCard) => ({
              id: c.id,
              value: Number(c.value || 0),
              rarity: String(c.rarity || 'common'),
              marketStatus: String(c.marketStatus || 'none'),
              ownerId: c.ownerId,
              ownerName: c.ownerName ?? null,
              name: c.name ?? null,
            }))
        );
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
        // Store, rankings) is now stale. The two sibling handlers above already
        // do this; the buy path was the outlier and left the number frozen for
        // a full poll interval. invalidateCache because /api/users is served
        // from the 3s response cache, which would otherwise hand back the
        // pre-purchase snapshot.
        invalidateCache('/api/users');
        window.dispatchEvent(new CustomEvent('orbit-score-refresh'));

        if (item.category === 'hack' && targetId) {
          // The debuff window is the SERVER's, not ours: `deny` lasts 5 minutes
          // and `mobile_virus` 1. This used to hardcode 3 minutes for every
          // hack, so the countdown disagreed with when the effect actually
          // stopped. Read it off the purchase response, and only fall back to
          // polling if an older node omits it.
          const bought = await res.json().catch(() => null as { debuff?: { expires_at?: number } } | null);
          const expiresAt = Number(bought?.debuff?.expires_at) || 0;
          // Deferred so the purity rule doesn't see Date.now() during render paths.
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

  const filteredItems = storeItems.filter((item) => item.category === 'hack');

  // Keep the portfolio dashboard in sync when cards change elsewhere.
  useEffect(() => {
    const onCardsRefresh = () => refreshPortfolio();
    window.addEventListener('orbit-cards-refresh', onCardsRefresh);
    return () => window.removeEventListener('orbit-cards-refresh', onCardsRefresh);
  }, [identity]);

  const portfolioValue = portfolio.reduce((a, c) => a + c.value, 0);
  // Estimate the SAME set handleCashOutAll actually pays. Counting listed
  // cards here promised a payout that the confirm step explicitly skips.
  const cashoutEstimate = portfolio
    .filter((c) => c.marketStatus !== 'cashed_out' && c.marketStatus !== 'listed')
    .reduce((a, c) => a + computeCashoutPayout(c.value, cashoutRate), 0);
  const cashableCount = portfolio.filter((c) => c.marketStatus !== 'cashed_out' && c.marketStatus !== 'listed').length;
  const skippedCount = portfolio.length - cashableCount;
  const rarityDist = portfolio.reduce((acc, c) => {
    acc[c.rarity] = (acc[c.rarity] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  return (
    <div className="w-full space-y-4 font-sans select-none text-retro-fg">
      {!arsenalOnly && (
      <>
      {/* Header: one title, one number. The balance is the datum, so it sits
          here instead of being repeated in a dashboard card. */}
      <PageHeader
        title="Store"
        meta={arsenalOnly ? 'Deploy cyber hacks.' : undefined}
        action={
          <div className={classes(RECIPE.card, PADDING_X[3], PADDING_Y[1.5], COLOR.interactive)}>
            <Coins className={classes(ICON.sm, COLOR.accent)} />
            <span className={classes(TYPE.sub, WEIGHT.medium, MONO, COLOR.fg, 'tabular-nums')}>g$ {formatCount(points)}</span>
          </div>
        }
      />

      {/* Economy Dashboard */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">

        <div className={CHROME.statTile}>
          <div className={classes('flex items-center', GAP[1.5], COLOR.muted, TYPE.caption, WEIGHT.semibold, 'uppercase', TRACKING.wider)}>
            <Layers className={ICON.sm} />
            Portfolio Value
          </div>
          <div className={classes('mt-1', TYPE.title, WEIGHT.bold, MONO, 'tabular-nums', COLOR.fg)}>{formatGc(portfolioValue)}</div>
          <div className={classes(TYPE.caption, COLOR.muted, 'mt-0.5')}>{portfolio.length} card{portfolio.length === 1 ? '' : 's'}</div>
        </div>

        <div className={classes(CHROME.statTile, STATUS.warningEdgeSoft)}>
          <div className={classes('flex items-center', GAP[1.5], STATUS.warning, TYPE.caption, WEIGHT.semibold, 'uppercase', TRACKING.wider)}>
            <Sparkles className={ICON.sm} />
            Cashout Value
          </div>
          <div className={classes('mt-1', TYPE.title, WEIGHT.bold, MONO, 'tabular-nums', STATUS.warning)}>{formatGc(cashoutEstimate)}</div>
          <div className={classes(TYPE.caption, COLOR.muted, 'mt-0.5')}>{(cashoutRate / 100).toFixed(1)}% rate</div>

          {cashingOutAll && cashoutProgress ? (
            <div className={classes('mt-2.5 flex items-center', GAP[2], TYPE.body, STATUS.warning, WEIGHT.medium)}>
              <span className={RECIPE.spinner} />
              Cashing out {cashoutProgress.done}/{cashoutProgress.total}…
            </div>
          ) : confirmCashoutAll ? (
            <div className={classes('mt-2.5 space-y-2')}>
              <p className={classes(TYPE.body, COLOR.body, WEIGHT.medium)}>
                Cash out {cashableCount} card{cashableCount === 1 ? '' : 's'} for ~{formatGc(cashoutEstimate)}?
                {skippedCount > 0 && (
                  <span className={COLOR.muted}> ({skippedCount} listed skipped)</span>
                )}
              </p>
              <div className={classes('flex items-center', GAP[1.5])}>
                <Button type="button" variant="secondary" onClick={() => void handleCashOutAll()}>
                  Confirm
                </Button>
                <Button type="button" variant="ghost" onClick={() => setConfirmCashoutAll(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                playPress(780);
                setConfirmCashoutAll(true);
              }}
              disabled={cashableCount === 0}
              className={classes('mt-2.5 w-full', 'flex items-center justify-center', GAP[1.5], STATUS.warning)}
            >
              <Coins className={ICON.sm} />
              Cash Out All
            </Button>
          )}
        </div>

        <div className={classes(CHROME.statTile, 'col-span-2 lg:col-span-1')}>
          <div className={classes(COLOR.muted, TYPE.caption, WEIGHT.semibold, 'uppercase', TRACKING.wider, 'mb-1.5')}>Rarity Mix</div>
          <div className={classes('flex flex-wrap', GAP[1.5])}>
            {RARITY_ORDER.map((r) => {
              const count = rarityDist[r] || 0;
              const tier = RARITY_TIERS[r];
              if (!tier) return null;
              return (
                <span
                  key={r}
                  className="text-2xs font-bold px-1.5 py-0.5 rounded border tabular-nums"
                  style={{ color: tier.accentColor, borderColor: `${tier.accentColor}66`, backgroundColor: `${tier.accentColor}14` }}
                >
                  {tier.label} {count}
                </span>
              );
            })}
          </div>
        </div>
      </section>
      </>
      )}

      {!arsenalOnly && (
      <>
      {/* Most valuable cards */}
      <section className={CHROME.statTile}>
        <h3 className={classes(CHROME.sectionLabel, 'mb-3')}>Most valuable cards</h3>
        {portfolio.length === 0 ? (
          <p className={FEEDBACK.description}>No cards yet.</p>
        ) : (
          <div className={classes('space-y-1.5')}>
            {[...portfolio].sort((a, b) => b.value - a.value).slice(0, 8).map((c, i) => {
              const tier = RARITY_TIERS[c.rarity as keyof typeof RARITY_TIERS];
              return (
                <div key={c.id} className={classes(CHROME.rowTile, 'flex items-center', GAP[2.5])}>
                  <span className={classes(TYPE.body, MONO, COLOR.muted, 'tabular-nums w-5 shrink-0')}>#{i + 1}</span>
                  {tier && (
                    <span
                      className={classes(TYPE.caption, WEIGHT.bold, PADDING_X[1.5], 'py-0.5', RADIUS.chip, 'border uppercase shrink-0', TRACKING.wide)}
                      style={{ color: tier.accentColor, borderColor: `${tier.accentColor}66`, backgroundColor: `${tier.accentColor}14` }}
                    >
                      {tier.label}
                    </span>
                  )}
                  <span className={classes('min-w-0 flex-1 truncate', TYPE.body, COLOR.body)}>
                    {c.name || `${c.id.slice(0, 12)}…`}
                  </span>
                  {c.ownerId !== identity?.orbitId && c.ownerName && (
                    <span className={classes('hidden sm:inline max-w-[8rem] shrink-0 truncate', TYPE.caption, COLOR.muted)}>
                      by {c.ownerName}
                    </span>
                  )}
                  <span className={classes(TYPE.body, WEIGHT.bold, MONO, 'tabular-nums', COLOR.fg, 'shrink-0')}>{formatGc(c.value)}</span>
                  <span className={classes(TYPE.caption, MONO, 'tabular-nums', STATUS.warning, 'shrink-0', 'flex items-center', GAP[1])} title="Cash-out payout">
                    <ArrowRight className={ICON.sm} aria-hidden />
                    {formatGc(computeCashoutPayout(c.value, cashoutRate))}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Inventory (read-only) */}
      <section className={CHROME.statTile}>
        <h3 className={classes(CHROME.sectionLabel, 'mb-3')}>Inventory</h3>
        {(() => {
          const owned = storeItems.filter((item) => (inventory[item.id] || 0) > 0);
          if (owned.length === 0) return <p className={FEEDBACK.description}>Nothing owned.</p>;
          return (
            <div className={classes('space-y-1.5')}>
              {owned.map((item) => (
                <div key={item.id} className={classes(CHROME.rowTile, 'flex items-center', GAP[2.5])}>
                  <span className={classes('min-w-0 flex-1 truncate', TYPE.body, COLOR.body)}>{item.name}</span>
                  <span className={classes(TYPE.body, MONO, 'tabular-nums', COLOR.muted, 'shrink-0')}>x{inventory[item.id]}</span>
                </div>
              ))}
            </div>
          );
        })()}
      </section>

      {/* Community Market — the shop floor: cards listed by other players,
          each with one asking price, one buy action and a collection route. */}
      <section className={CHROME.statTile}>
        <div className={classes('flex items-center justify-between', GAP[2], 'mb-1')}>
          <h3 className={CHROME.sectionLabel}>Community Market</h3>
          <div className={classes('flex items-center', GAP[2])}>
            <span className={classes(TYPE.caption, COLOR.muted)}>{marketListings.length} for sale</span>
            {onOpenCardCollection && (
              <Button type="button" variant="secondary" size="sm" onClick={onOpenCardCollection} className="whitespace-nowrap">
                View collection
              </Button>
            )}
          </div>
        </div>
        <p className={classes(FEEDBACK.descriptionTight, 'mb-3')}>Cards on sale — buying one adds it to your collection.</p>
        {marketListings.length === 0 ? (
          <p className={FEEDBACK.description}>Nothing listed.</p>
        ) : (
          <div className={classes('grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5', GAP[2])}>
            {marketListings.map((l) => {
              const tier = computeCardRarity(l.card?.value ?? 0);
              return (
                <div key={l.listingId} className={classes(RECIPE.card, COLOR.interactiveSoft, COLOR.hoverEdgeStrong, 'overflow-hidden flex flex-col', MOTION.transition.quick)}>
                  <button
                    type="button"
                    onClick={() => setMarketCardId(l.cardId)}
                    className="block w-full text-left cursor-pointer"
                    aria-label={`View card ${l.card?.name || l.cardId.slice(0, 8)}`}
                  >
                    <GameCard
                      objectId={l.card?.mediaObjectId ?? null}
                      src={l.card?.contentUrl}
                      identity={identity ?? null}
                      width={190}
                      height={190}
                      isVideo={Boolean(l.card?.mimeType?.startsWith('video/'))}
                      name={l.card?.name}
                      rarity={tier}
                      value={l.card?.value ?? 0}
                      accentColor={l.card?.accentColor}
                      frame={l.card?.frame}
                      showNameplate={false}
                      interactive={false}
                      className="rounded-none border-0"
                    />
                  </button>
                  {/* Compact product info: name, tier and intrinsic card value. */}
                  <div className={classes(PADDING[2], 'flex flex-col', GAP[0.5], 'min-w-0')}>
                    <div className={classes(TYPE.body, WEIGHT.semibold, COLOR.fg, 'truncate')} title={l.card?.name || undefined}>
                      {l.card?.name || 'Unnamed Card'}
                    </div>
                    <div className={classes('flex items-center justify-between', GAP[1.5], TYPE.caption, COLOR.muted, 'min-w-0')}>
                      <span className={classes('uppercase', TRACKING.wider, WEIGHT.bold, RARITY[tier.rarity] || COLOR.muted, 'truncate')}>{tier.label}</span>
                      <span className={classes(MONO, 'shrink-0')}>{formatGc(l.card?.value || 0)} value</span>
                    </div>
                  </div>
                  {/* Credit the seller. The name is joined server-side: the
                      local `users` roster is capped at 100 rows and filtered
                      to 24h freshness, so it cannot name a stranger. This row is
                      a SIBLING of the view-card button on purpose: a button
                      nested in a button is invalid HTML (React warns on
                      hydration), so the profile link lives outside it. */}
                  <div className={classes(PADDING_X[2], PADDING_Y[1], 'flex items-center', GAP[1], TYPE.caption, COLOR.muted, 'min-w-0', 'border-t', COLOR.edgeSubtle)}>
                    <span className="shrink-0">by</span>
                    {l.sellerId === identity?.orbitId ? (
                      <span className={classes('truncate', WEIGHT.medium, COLOR.body)}>you</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onOpenOwner?.(l.sellerId)}
                        className={classes('min-w-0 truncate text-left', WEIGHT.medium, COLOR.body, COLOR.hoverAccent, 'hover:underline cursor-pointer', MOTION.transition.micro)}
                        aria-label={`Open profile of ${l.sellerName || 'seller'}`}
                      >
                        {l.sellerName || `User_${l.sellerId.slice(0, 6)}`}
                      </button>
                    )}
                  </div>
                  {/* The asking price is the loudest number on a product tile. */}
                  <div className={classes('mt-auto flex items-center justify-between', GAP[1.5], PADDING_X[2], PADDING_Y[2], 'border-t', COLOR.edgeSubtle)}>
                    <span className={classes(TYPE.sub, MONO, WEIGHT.bold, STATUS.info, 'tabular-nums')}>{formatGc(l.price)}</span>
                    {l.sellerId === identity?.orbitId ? (
                      <span className={classes(PADDING_X[2], PADDING_Y[1], RADIUS.chip, COLOR.interactive, COLOR.muted, TYPE.caption, WEIGHT.bold)} title="This is your own listing. Cancel it from your card page instead">Yours</span>
                    ) : (
                      <Button
                        type="button"
                        variant="info"
                        size="sm"
                        disabled={buyingCardId !== null}
                        onClick={() => void buyListing(l)}
                      >
                        {buyingCardId === l.cardId ? '…' : 'Buy'}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
      </>
      )}

      {/* Store Items Grid (arsenal mode only: hack buy/deploy) */}
      {arsenalOnly && (
      <div className={classes('grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3', GAP[4])}>
        {filteredItems.map((item) => {
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

      {/* Target Selector Modal for Hacking Services (arsenal only) */}
      {arsenalOnly && targetModalItem && (
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
      {/* Community Market listing detail (Steam-style card modal) */}
      {!arsenalOnly && marketCardId && (
        <CardDetailView
          cardId={marketCardId}
          identity={identity ?? null}
          onClose={() => { setMarketCardId(null); refreshMarket(); }}
          toast={toast}
        />
      )}
    </div>
  );
}
