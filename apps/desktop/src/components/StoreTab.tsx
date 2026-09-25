"use client";

import { useState, useEffect } from 'react';
import { STORE_ITEMS, type StoreItem, type User, formatGc, computeCashoutPayout, clampCashoutRateBps, DEFAULT_CASHOUT_RATE_BPS, RARITY_TIERS } from '@orbit/shared';
import { orbitFetch } from '../utils/api';
import type { OrbitIdentity } from '@orbit/crypto';
import type { ActiveHackSession } from './home/CommandIsland';
import { playPress, playLike } from '../utils/sounds';
import { TargetSelectorModal } from './hacks/TargetSelectorModal';
import { ObjectImage } from './ObjectImage';
import { CardDetailView } from './CardDetailView';
import {
  ShoppingBag,
  Zap,
  Coins,
  Sparkles,
  Layers,
  EyeOff,
  Flame,
  ShieldAlert,
} from 'lucide-react';

interface PortfolioCard {
  id: string;
  value: number;
  rarity: string;
  marketStatus: string;
}

const RARITY_ORDER = ['common', 'copper', 'silver', 'gold', 'diamond'] as const;

export function StoreTab({ points, onPurchase, onDeployHack, identity, onOpenCardCollection, onOpenFlash, users = [], profilePics = {}, toast, arsenalOnly = false }: {
  points: number;
  onPurchase?: (item: StoreItem) => void;
  onUseConsumable?: (item: StoreItem) => void;
  onDeployHack?: (session: ActiveHackSession) => void;
  identity?: OrbitIdentity | null;
  onOpenCardCollection?: () => void;
  onOpenFlash?: () => void;
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
  const [marketListings, setMarketListings] = useState<Array<{ listingId: string; cardId: string; price: number; sellerId: string; card: any }>>([]);
  const [buyingCardId, setBuyingCardId] = useState<string | null>(null);
  const [marketCardId, setMarketCardId] = useState<string | null>(null);

  // Community market (Steam-style): open listings, newest first.
  const refreshMarket = () => {
    if (!identity) return;
    orbitFetch('/api/cards/market?limit=24', {}, identity)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (Array.isArray(data?.listings)) setMarketListings(data.listings); })
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
            .filter((c: any) => c.marketStatus !== 'cashed_out')
            .map((c: any) => ({
              id: c.id,
              value: Number(c.value || 0),
              rarity: String(c.rarity || 'common'),
              marketStatus: String(c.marketStatus || 'none'),
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
            .filter((c: any) => c.marketStatus !== 'cashed_out')
            .map((c: any) => ({
              id: c.id,
              value: Number(c.value || 0),
              rarity: String(c.rarity || 'common'),
              marketStatus: String(c.marketStatus || 'none'),
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

    playLike();
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
        playLike();
        toast?.(`Purchased ${item.name}`, 'success');
        onPurchase?.(item);

        if (item.category === 'hack' && targetId) {
          // Deferred so the purity rule doesn't see Date.now() during render paths.
          setTimeout(() => {
            onDeployHack?.({
              itemId: item.id,
              itemName: item.name,
              targetUserId: targetId,
              targetUserName: targetName || 'Target Player',
              expiresAt: Date.now() + 180000,
            });
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
  const cashoutEstimate = portfolio.reduce((a, c) => a + computeCashoutPayout(c.value, cashoutRate), 0);
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
      {/* Header */}
      <section className="w-full solid-panel backdrop-blur-md p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-surface-interactive flex items-center justify-center text-retro-muted">
            <ShoppingBag className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-medium text-retro-fg">Store</h2>
            <p className="text-xs text-retro-muted">
              {arsenalOnly
                ? 'Deploy cyber hacks with g$.'
                : 'Cash out your collection. Buying retired; hacks live under PC Domination.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-interactive border border-border-glass rounded-lg">
          <Coins className="w-3.5 h-3.5 text-retro-accent" />
          <span className="text-xs text-retro-muted">Balance:</span>
          <span className="text-sm font-medium font-mono text-retro-fg tabular-nums">g$ {points.toLocaleString()}</span>
        </div>
      </section>

      {/* Economy Dashboard */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="solid-panel backdrop-blur-md p-3.5 col-span-2 lg:col-span-1">
          <div className="flex items-center gap-1.5 text-retro-muted text-[10px] font-semibold uppercase tracking-wider">
            <Coins className="w-3.5 h-3.5 text-retro-accent" />
            Balance
          </div>
          <div className="mt-1 text-lg font-bold font-mono tabular-nums text-retro-fg">{formatGc(points)}</div>
        </div>

        <div className="solid-panel backdrop-blur-md p-3.5">
          <div className="flex items-center gap-1.5 text-retro-muted text-[10px] font-semibold uppercase tracking-wider">
            <Layers className="w-3.5 h-3.5" />
            Portfolio Value
          </div>
          <div className="mt-1 text-lg font-bold font-mono tabular-nums text-retro-fg">{formatGc(portfolioValue)}</div>
          <div className="text-[10px] text-retro-muted mt-0.5">{portfolio.length} card{portfolio.length === 1 ? '' : 's'}</div>
        </div>

        <div className="solid-panel backdrop-blur-md border border-amber-500/20 p-3.5">
          <div className="flex items-center gap-1.5 text-amber-400 text-[10px] font-semibold uppercase tracking-wider">
            <Sparkles className="w-3.5 h-3.5" />
            Cashout Value
          </div>
          <div className="mt-1 text-lg font-bold font-mono tabular-nums text-amber-300">{formatGc(cashoutEstimate)}</div>
          <div className="text-[10px] text-retro-muted mt-0.5">{(cashoutRate / 100).toFixed(1)}% rate</div>

          {cashingOutAll && cashoutProgress ? (
            <div className="mt-2.5 flex items-center gap-2 text-xs text-amber-300 font-medium">
              <span className="w-3 h-3 border border-amber-400 border-t-transparent rounded-full animate-spin" />
              Cashing out {cashoutProgress.done}/{cashoutProgress.total}…
            </div>
          ) : confirmCashoutAll ? (
            <div className="mt-2.5 space-y-2">
              <p className="text-xs text-retro-body font-medium">
                Cash out {cashableCount} card{cashableCount === 1 ? '' : 's'} for ~{formatGc(cashoutEstimate)}?
                {skippedCount > 0 && (
                  <span className="text-retro-muted"> ({skippedCount} listed skipped)</span>
                )}
              </p>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void handleCashOutAll()}
                  className="px-2.5 py-1.5 rounded bg-amber-500 text-black text-xs font-bold cursor-pointer transition-colors hover:bg-amber-400"
                >
                  Confirm
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmCashoutAll(false)}
                  className="px-2.5 py-1.5 rounded bg-surface-interactive border border-border-glass text-retro-body text-xs font-medium cursor-pointer transition-colors hover:text-retro-fg"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                playPress(780);
                setConfirmCashoutAll(true);
              }}
              disabled={cashableCount === 0}
              className="mt-2.5 w-full px-2.5 py-1.5 rounded bg-amber-500/15 hover:bg-amber-500/25 disabled:opacity-40 text-amber-300 text-xs font-bold transition-colors cursor-pointer flex items-center justify-center gap-1.5"
            >
              <Coins className="w-3 h-3" />
              Cash Out All
            </button>
          )}
        </div>

        <div className="solid-panel backdrop-blur-md p-3.5 col-span-2 lg:col-span-1">
          <div className="text-retro-muted text-[10px] font-semibold uppercase tracking-wider mb-1.5">Rarity Mix</div>
          <div className="flex flex-wrap gap-1.5">
            {RARITY_ORDER.map((r) => {
              const count = rarityDist[r] || 0;
              const tier = RARITY_TIERS[r];
              if (!tier) return null;
              return (
                <span
                  key={r}
                  className="text-[10px] font-bold px-1.5 py-0.5 rounded border tabular-nums"
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
      <section className="solid-panel backdrop-blur-md p-4">
        <div className="flex items-center justify-between gap-2 mb-3">
          <h3 className="text-xs font-bold text-retro-fg uppercase tracking-wider">Most valuable cards</h3>
          {onOpenCardCollection && (
            <button
              type="button"
              onClick={onOpenCardCollection}
              className="px-2.5 py-1.5 text-xs font-medium border border-border-glass text-retro-fg hover:bg-surface-interactive cursor-pointer rounded-lg transition-colors whitespace-nowrap"
            >
              View collection
            </button>
          )}
        </div>
        {portfolio.length === 0 ? (
          <p className="text-xs text-retro-muted">No cards yet. Forge, trade or win some to build value.</p>
        ) : (
          <div className="space-y-1.5">
            {[...portfolio].sort((a, b) => b.value - a.value).slice(0, 8).map((c, i) => {
              const tier = RARITY_TIERS[c.rarity as keyof typeof RARITY_TIERS];
              return (
                <div key={c.id} className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg bg-surface-interactive border border-border-glass">
                  <span className="text-xs font-mono text-retro-muted tabular-nums w-5 shrink-0">#{i + 1}</span>
                  {tier && (
                    <span
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wide shrink-0"
                      style={{ color: tier.accentColor, borderColor: `${tier.accentColor}66`, backgroundColor: `${tier.accentColor}14` }}
                    >
                      {tier.label}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-retro-muted">{c.id.slice(0, 12)}…</span>
                  <span className="text-xs font-bold font-mono tabular-nums text-retro-fg shrink-0">{formatGc(c.value)}</span>
                  <span className="text-[10px] font-mono tabular-nums text-amber-300 shrink-0">→ {formatGc(computeCashoutPayout(c.value, cashoutRate))}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Inventory (read-only) */}
      <section className="solid-panel backdrop-blur-md p-4">
        <h3 className="text-xs font-bold text-retro-fg uppercase tracking-wider mb-3">Inventory</h3>
        {(() => {
          const owned = storeItems.filter((item) => (inventory[item.id] || 0) > 0);
          if (owned.length === 0) return <p className="text-xs text-retro-muted">Empty. Nothing owned.</p>;
          return (
            <div className="space-y-1.5">
              {owned.map((item) => (
                <div key={item.id} className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg bg-surface-interactive border border-border-glass">
                  <span className="min-w-0 flex-1 truncate text-xs text-retro-body">{item.name}</span>
                  <span className="text-xs font-mono tabular-nums text-retro-muted shrink-0">×{inventory[item.id]}</span>
                </div>
              ))}
            </div>
          );
        })()}
      </section>

      {/* Community Market — Steam-style buy/sell between players */}
      <section className="solid-panel backdrop-blur-md p-4">
        <div className="flex items-center justify-between gap-2 mb-3">
          <h3 className="text-xs font-bold text-retro-fg uppercase tracking-wider">Community Market</h3>
          <span className="text-[10px] text-retro-muted">{marketListings.length} open listing{marketListings.length === 1 ? '' : 's'}</span>
        </div>
        {marketListings.length === 0 ? (
          <p className="text-xs text-retro-muted">Nothing listed yet. Open one of your cards and list it for g$.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {marketListings.map((l) => (
              <div key={l.listingId} className="rounded-lg border border-border-glass bg-surface-interactive overflow-hidden flex flex-col">
                <button
                  type="button"
                  onClick={() => setMarketCardId(l.cardId)}
                  className="block w-full text-left cursor-pointer"
                  aria-label={`View card ${l.card?.name || l.cardId.slice(0, 8)}`}
                >
                  <div className="aspect-square bg-black">
                    <ObjectImage
                      objectId={l.card?.mediaObjectId}
                      contentUrl={l.card?.contentUrl}
                      mimeType={l.card?.mimeType}
                      identity={identity ?? null}
                      alt={l.card?.name || 'market card'}
                      className="w-full h-full object-cover"
                      videoClassName="w-full h-full object-cover"
                    />
                  </div>
                  <div className="p-2">
                    <div className="text-xs font-bold text-retro-fg truncate">{l.card?.name || 'Unnamed Card'}</div>
                    <div className="text-[10px] capitalize text-retro-muted">{l.card?.rarity}</div>
                  </div>
                </button>
                <div className="flex items-center justify-between gap-1.5 px-2 pb-2">
                  <span className="text-xs font-mono font-bold text-cyan-300 tabular-nums">{formatGc(l.price)} g$</span>
                  {l.sellerId === identity?.orbitId ? (
                    <span className="px-2 py-1 rounded bg-retro-interactive text-retro-muted text-[10px] font-bold" title="This is your own listing. Cancel it from your card page instead">Yours</span>
                  ) : (
                    <button
                      type="button"
                      disabled={buyingCardId !== null}
                      onClick={() => void buyListing(l)}
                      className="px-2 py-1 rounded bg-cyan-500/20 hover:bg-cyan-500/30 disabled:opacity-40 text-cyan-300 text-[10px] font-bold cursor-pointer transition-colors"
                    >
                      {buyingCardId === l.cardId ? '…' : 'Buy'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      </>
      )}

      {/* Store Items Grid (arsenal mode only: hack buy/deploy) */}
      {arsenalOnly && (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredItems.map((item) => {
          const count = inventory[item.id] || 0;
          const canAfford = points >= item.cost;

          return (
            <div
              key={item.id}
              className="relative solid-panel backdrop-blur-md p-4 flex flex-col justify-between transition-colors border-rose-500/30"
            >
              <div className="space-y-2">
                <div className="flex items-start justify-between">
                  <div className="p-2.5 rounded-lg border bg-rose-500/10 border-rose-500/20 text-rose-400">
                    {item.id === 'item-hack-deny' && <EyeOff className="w-5 h-5" />}
                    {item.id === 'item-hack-mobile' && <Flame className="w-5 h-5" />}
                    {item.id === 'item-flash-drop' && <Zap className="w-5 h-5 text-retro-warning" />}
                  </div>

                  {item.badge && (
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded border bg-rose-500/10 text-rose-400 border-rose-500/20">
                      {item.badge}
                    </span>
                  )}
                </div>

                <div>
                  <h4 className="text-sm font-medium text-retro-fg">{item.name}</h4>
                  <p className="text-xs text-retro-muted mt-1">{item.desc}</p>
                </div>
              </div>

              <div className="pt-3 border-t border-border-glass mt-3 flex items-center justify-between gap-2">
                <span className="text-sm font-medium font-mono tabular-nums text-rose-400">
                  g$ {item.cost.toLocaleString()}
                </span>

                <button
                  type="button"
                  onClick={() => handleBuy(item)}
                  disabled={!canAfford || buying === item.id}
                  className="px-3 py-1.5 bg-rose-500/15 hover:bg-rose-500/20 disabled:opacity-40 text-rose-400 text-xs font-medium rounded-lg transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  <ShieldAlert className="w-3.5 h-3.5" />
                  <span>{buying === item.id ? 'Deploying...' : (item.id === 'item-flash-drop' && count > 0 ? 'Fire' : 'Deploy')}</span>
                </button>
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
