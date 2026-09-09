"use client";

import { useState, useEffect } from 'react';
import { STORE_ITEMS, type StoreItem, type User, formatGc, computeCashoutPayout, clampCashoutRateBps, DEFAULT_CASHOUT_RATE_BPS, RARITY_TIERS } from '@orbit/shared';
import { orbitFetch } from '../utils/api';
import type { OrbitIdentity } from '@orbit/crypto';
import type { ActiveHackSession } from './home/HomeFooter';
import { playPress, playLike, playMatch } from '../utils/sounds';
import { TargetSelectorModal } from './hacks/TargetSelectorModal';
import { ObjectImage } from './ObjectImage';
import {
  ShoppingBag,
  Package,
  Zap,
  Check,
  Coins,
  Sparkles,
  Box,
  Shield,
  Crown,
  Award,
  Layers,
  Skull,
  EyeOff,
  Flame,
  ShieldAlert,
} from 'lucide-react';

interface OpenedCard {
  id: string;
  title: string;
  rarity: string;
  score: number;
  content_url: string;
}

interface PortfolioCard {
  id: string;
  value: number;
  rarity: string;
  marketStatus: string;
}

const RARITY_ORDER = ['common', 'copper', 'silver', 'gold', 'diamond'] as const;

export function StoreTab({
  points,
  onPurchase,
  onUseConsumable,
  onDeployHack,
  identity,
  onOpenCardCollection,
  onOpenFlash,
  users = [],
  profilePics = {},
  toast,
}: {
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
}) {
  const [activeCategory, setActiveCategory] = useState<'all' | 'hack' | 'pack' | 'perk' | 'badge' | 'title' | 'inventory'>('all');
  const [storeItems, setStoreItems] = useState<StoreItem[]>(STORE_ITEMS);
  const [targetModalItem, setTargetModalItem] = useState<StoreItem | null>(null);
  const [unlocked, setUnlocked] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      return new Set(JSON.parse(localStorage.getItem('orbit_unlocked_store') || '[]'));
    } catch {
      return new Set();
    }
  });
  const [inventory, setInventory] = useState<Record<string, number>>({});
  const [buying, setBuying] = useState<string | null>(null);
  const [openingPack, setOpeningPack] = useState<string | null>(null);
  const [unboxedCards, setUnboxedCards] = useState<OpenedCard[] | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioCard[]>([]);
  const [cashoutRate, setCashoutRate] = useState<number>(DEFAULT_CASHOUT_RATE_BPS);
  const [confirmCashoutAll, setConfirmCashoutAll] = useState(false);
  const [cashingOutAll, setCashingOutAll] = useState(false);
  const [cashoutProgress, setCashoutProgress] = useState<{ done: number; total: number } | null>(null);

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
      toast?.(`Cashed out ${cashedCount} card${cashedCount === 1 ? '' : 's'} for ${formatGc(payout)}!`, 'success');
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

  // Restore unlocks
  useEffect(() => {
    if (!identity) return;
    let cancelled = false;
    orbitFetch('/api/users/store/unlocks', {}, identity)
      .then((r) => (r.ok ? r.json() : []))
      .then((ids: string[]) => {
        if (cancelled || !Array.isArray(ids)) return;
        const next = new Set(ids);
        setUnlocked((prev) => {
          for (const id of ids) next.add(id);
          for (const id of prev) next.add(id);
          return next;
        });
        try {
          localStorage.setItem('orbit_unlocked_store', JSON.stringify(Array.from(next)));
        } catch { }
      })
      .catch(() => { });
    return () => {
      cancelled = true;
    };
  }, [identity]);

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
        toast?.(`Purchased ${item.name}!`, 'success');
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
        } else {
          setUnlocked((prev) => {
            const next = new Set(prev).add(item.id);
            try {
              localStorage.setItem('orbit_unlocked_store', JSON.stringify(Array.from(next)));
            } catch { }
            return next;
          });
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

  const handleOpenPack = async (item: StoreItem) => {
    if (!identity || (inventory[item.id] || 0) <= 0 || openingPack) return;

    setOpeningPack(item.id);
    playPress(920);
    try {
      const res = await orbitFetch(
        '/api/users/store/open-pack',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ item_id: item.id, idempotency_key: crypto.randomUUID() }),
        },
        identity
      );
      if (res.ok) {
        const data = await res.json();
        playMatch();
        setUnboxedCards(data.cards || []);
        refreshInventory();
        window.dispatchEvent(new CustomEvent('orbit-cards-refresh'));
        toast?.(`Opened ${item.name}! Check your collection.`, 'success');
      } else {
        toast?.('Failed to open pack', 'error');
      }
    } catch {
      toast?.('Network error opening pack', 'error');
    } finally {
      setOpeningPack(null);
    }
  };

  const filteredItems = storeItems.filter((item) => {
    if (activeCategory === 'all') return true;
    if (activeCategory === 'inventory') return (inventory[item.id] || 0) > 0;
    return item.category === activeCategory;
  });

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
      {/* Header */}
      <section className="w-full bg-surface-raised border border-retro-border rounded-lg p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-surface-interactive flex items-center justify-center text-retro-muted">
            <ShoppingBag className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-medium text-retro-fg">Store</h2>
            <p className="text-xs text-retro-muted">
              Unlock packs, perks, titles, and cosmetics with g$.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-interactive border border-retro-border rounded-lg">
          <Coins className="w-3.5 h-3.5 text-retro-accent" />
          <span className="text-xs text-retro-muted">Balance:</span>
          <span className="text-sm font-medium font-mono text-retro-fg tabular-nums">g$ {points.toLocaleString()}</span>
        </div>
      </section>

      {/* Economy Dashboard */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-surface-raised border border-retro-border rounded-lg p-3.5 col-span-2 lg:col-span-1">
          <div className="flex items-center gap-1.5 text-retro-muted text-[10px] font-semibold uppercase tracking-wider">
            <Coins className="w-3.5 h-3.5 text-retro-accent" />
            Balance
          </div>
          <div className="mt-1 text-lg font-bold font-mono tabular-nums text-retro-fg">{formatGc(points)}</div>
        </div>

        <div className="bg-surface-raised border border-retro-border rounded-lg p-3.5">
          <div className="flex items-center gap-1.5 text-retro-muted text-[10px] font-semibold uppercase tracking-wider">
            <Layers className="w-3.5 h-3.5" />
            Portfolio Value
          </div>
          <div className="mt-1 text-lg font-bold font-mono tabular-nums text-retro-fg">{formatGc(portfolioValue)}</div>
          <div className="text-[10px] text-retro-muted mt-0.5">{portfolio.length} card{portfolio.length === 1 ? '' : 's'}</div>
        </div>

        <div className="bg-surface-raised border border-amber-500/20 rounded-lg p-3.5">
          <div className="flex items-center gap-1.5 text-amber-400 text-[10px] font-semibold uppercase tracking-wider">
            <Sparkles className="w-3.5 h-3.5" />
            Cashout Value
          </div>
          <div className="mt-1 text-lg font-bold font-mono tabular-nums text-amber-300">{formatGc(cashoutEstimate)}</div>
          <div className="text-[10px] text-retro-muted mt-0.5">{(cashoutRate / 100).toFixed(1)}% rate</div>

          {cashingOutAll && cashoutProgress ? (
            <div className="mt-2.5 flex items-center gap-2 text-[11px] text-amber-300 font-medium">
              <span className="w-3 h-3 border border-amber-400 border-t-transparent rounded-full animate-spin" />
              Cashing out {cashoutProgress.done}/{cashoutProgress.total}…
            </div>
          ) : confirmCashoutAll ? (
            <div className="mt-2.5 space-y-2">
              <p className="text-[11px] text-retro-body font-medium">
                Cash out {cashableCount} card{cashableCount === 1 ? '' : 's'} for ~{formatGc(cashoutEstimate)}?
                {skippedCount > 0 && (
                  <span className="text-retro-muted"> ({skippedCount} listed skipped)</span>
                )}
              </p>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void handleCashOutAll()}
                  className="px-2.5 py-1.5 rounded bg-amber-500 text-black text-[11px] font-bold cursor-pointer transition-colors hover:bg-amber-400"
                >
                  Confirm
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmCashoutAll(false)}
                  className="px-2.5 py-1.5 rounded bg-surface-interactive border border-retro-border text-retro-body text-[11px] font-medium cursor-pointer transition-colors hover:text-retro-fg"
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
              className="mt-2.5 w-full px-2.5 py-1.5 rounded bg-amber-500/15 hover:bg-amber-500/25 disabled:opacity-40 text-amber-300 text-[11px] font-bold transition-colors cursor-pointer flex items-center justify-center gap-1.5"
            >
              <Coins className="w-3 h-3" />
              Cash Out All
            </button>
          )}
        </div>

        <div className="bg-surface-raised border border-retro-border rounded-lg p-3.5 col-span-2 lg:col-span-1">
          <div className="text-retro-muted text-[10px] font-semibold uppercase tracking-wider mb-1.5">Rarity Mix</div>
          <div className="flex flex-wrap gap-1.5">
            {RARITY_ORDER.map((r) => {
              const count = rarityDist[r] || 0;
              const tier = RARITY_TIERS[r];
              if (!tier) return null;
              return (
                <span
                  key={r}
                  className="text-[9px] font-bold px-1.5 py-0.5 rounded border tabular-nums"
                  style={{ color: tier.accentColor, borderColor: `${tier.accentColor}66`, backgroundColor: `${tier.accentColor}14` }}
                >
                  {tier.label} {count}
                </span>
              );
            })}
          </div>
        </div>
      </section>

      {/* Category Tabs */}
      <div className="flex items-center gap-1.5 p-1.5 bg-surface-interactive border border-retro-border rounded-lg overflow-x-auto styled-scrollbar">
        {[
          { id: 'all', label: 'All', icon: ShoppingBag },
          { id: 'hack', label: 'Hacks', icon: ShieldAlert },
          { id: 'pack', label: 'Packs', icon: Package },
          { id: 'perk', label: 'Perks', icon: Zap },
          { id: 'badge', label: 'Badges', icon: Shield },
          { id: 'title', label: 'Titles', icon: Award },
          { id: 'inventory', label: 'Inventory', icon: Box, count: Object.values(inventory).reduce((a, b) => a + b, 0) },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeCategory === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                playPress(750);
                setActiveCategory(tab.id as any);
              }}
              className={`h-8 px-2.5 text-xs font-medium flex items-center gap-1.5 rounded transition-colors cursor-pointer whitespace-nowrap ${isActive
                  ? 'bg-surface-raised text-retro-fg border border-retro-border'
                  : 'text-retro-muted hover:text-retro-fg'
                }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
              {tab.count !== undefined && tab.count > 0 && (
                <span className="text-[9px] px-1 py-0 rounded bg-retro-accent/10 text-retro-accent tabular-nums">
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Store Items Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredItems.map((item) => {
          const isOwned = unlocked.has(item.id);
          const count = inventory[item.id] || 0;
          const canAfford = points >= item.cost;
          const isPack = item.category === 'pack';
          const isHack = item.category === 'hack';

          return (
            <div
              key={item.id}
              className={`relative bg-surface-raised border rounded-lg p-4 flex flex-col justify-between transition-colors ${isHack
                  ? 'border-rose-500/30'
                  : isOwned && !item.consumable
                    ? 'border-retro-online/30'
                    : 'border-retro-border hover:border-zinc-500'
                }`}
            >
              <div className="space-y-2">
                <div className="flex items-start justify-between">
                  <div className={`p-2.5 rounded-lg border ${isHack ? 'bg-rose-500/10 border-rose-500/20 text-rose-400' : 'bg-surface-interactive border-retro-border text-retro-body'}`}>
                    {item.id === 'item-hack-deny' && <EyeOff className="w-5 h-5" />}
                    {item.id === 'item-hack-takeover' && <Skull className="w-5 h-5" />}
                    {item.id === 'item-hack-mobile' && <Flame className="w-5 h-5" />}
                    {item.category === 'pack' && <Package className="w-5 h-5 text-retro-accent" />}
                    {item.category === 'perk' && item.id.includes('flash') && <Zap className="w-5 h-5 text-retro-warning" />}
                    {item.category === 'perk' && !item.id.includes('flash') && <Sparkles className="w-5 h-5 text-retro-accent" />}
                    {item.category === 'badge' && <Crown className="w-5 h-5 text-retro-warning" />}
                    {item.category === 'title' && <Award className="w-5 h-5 text-retro-accent" />}
                  </div>

                  {item.badge && (
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded border ${isHack
                        ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                        : 'bg-surface-interactive text-retro-muted border-retro-border'
                      }`}>
                      {item.badge}
                    </span>
                  )}
                </div>

                <div>
                  <h4 className="text-sm font-medium text-retro-fg">{item.name}</h4>
                  <p className="text-xs text-retro-muted mt-1">{item.desc}</p>
                </div>
              </div>

              <div className="pt-3 border-t border-retro-border mt-3 flex items-center justify-between gap-2">
                <span className={`text-sm font-medium font-mono tabular-nums ${isHack ? 'text-rose-400' : 'text-retro-body'}`}>
                  g$ {item.cost.toLocaleString()}
                </span>

                {isHack ? (
                  <button
                    type="button"
                    onClick={() => handleBuy(item)}
                    disabled={!canAfford || buying === item.id}
                    className="px-3 py-1.5 bg-rose-500/15 hover:bg-rose-500/20 disabled:opacity-40 text-rose-400 text-xs font-medium rounded-lg transition-colors cursor-pointer flex items-center gap-1.5"
                  >
                    <ShieldAlert className="w-3.5 h-3.5" />
                    <span>{buying === item.id ? 'Deploying...' : (item.id === 'item-flash-drop' && count > 0 ? 'Fire' : 'Deploy')}</span>
                  </button>
                ) : isPack ? (
                  <div className="flex items-center gap-2">
                    {count > 0 && (
                      <button
                        type="button"
                        onClick={() => handleOpenPack(item)}
                        disabled={Boolean(openingPack)}
                        className="px-3 py-1.5 bg-retro-accent/15 hover:bg-retro-accent/20 text-retro-accent text-xs font-medium rounded-lg transition-colors cursor-pointer flex items-center gap-1"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>Open ({count})</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleBuy(item)}
                      disabled={!canAfford || buying === item.id}
                      className="px-3 py-1.5 bg-retro-accent hover:bg-retro-accent-hover disabled:opacity-40 text-black text-xs font-medium rounded-lg transition-colors cursor-pointer"
                    >
                      {buying === item.id ? 'Buying...' : 'Buy Pack'}
                    </button>
                  </div>
                ) : isOwned ? (
                  <div className="flex items-center gap-1 text-retro-online text-xs font-medium">
                    <Check className="w-3.5 h-3.5" />
                    <span>Owned</span>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleBuy(item)}
                    disabled={!canAfford || buying === item.id}
                    className="px-3 py-1.5 bg-retro-accent hover:bg-retro-accent-hover disabled:opacity-40 text-black text-xs font-medium rounded-lg transition-colors cursor-pointer"
                  >
                    {buying === item.id ? 'Buying...' : 'Purchase'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Target Selector Modal for Hacking Services */}
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

      {/* Unboxed Cards Modal */}
      {unboxedCards && (
        <div
          className="fixed inset-0 z-[99999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-orbit-fade-in"
          onClick={() => setUnboxedCards(null)}
        >
          <div
            className="bg-surface-raised border border-retro-border rounded-lg p-5 max-w-sm w-full text-center space-y-3 shadow-xl animate-orbit-pop"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-10 rounded-lg bg-retro-accent/10 border border-retro-accent/20 flex items-center justify-center mx-auto text-retro-accent">
              <Sparkles className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-medium text-retro-fg">Pack Opened</h3>
              <p className="text-xs text-retro-muted">New card added to your collection</p>
            </div>
            <div className="space-y-2">
              {unboxedCards.map((card, idx) => (
                <div key={idx} className="bg-surface-interactive border border-retro-border rounded-lg p-3 flex items-center gap-3 text-left">
                  <div className="w-10 h-10 rounded bg-surface-canvas overflow-hidden shrink-0 border border-retro-border">
                    {card.content_url ? (
                      <ObjectImage contentUrl={card.content_url} objectId={card.id} identity={identity ?? null} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <Box className="w-5 h-5 text-retro-muted m-auto mt-2.5" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-xs text-retro-body truncate">{card.title}</div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-retro-accent/10 text-retro-accent">
                        {card.rarity}
                      </span>
                      <span className="text-[10px] font-medium text-retro-accent font-mono">+{card.score} g$</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setUnboxedCards(null)}
              className="w-full py-2.5 bg-retro-accent hover:bg-retro-accent-hover text-black font-medium text-xs rounded-lg cursor-pointer transition-colors"
            >
              Continue
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
