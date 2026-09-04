"use client";

import { useState, useEffect, useCallback } from 'react';
import { STORE_ITEMS, type StoreItem, type User } from '@orbit/shared';
import { orbitFetch } from '../utils/api';
import type { OrbitIdentity } from '@orbit/crypto';
import type { ActiveHackSession } from './home/HomeFooter';
import { ObjectImage } from './ObjectImage';
import {
  ShoppingBag,
  X,
  Package,
  Zap,
  Check,
  Coins,
  Sparkles,
  Box,
  EyeOff,
  Skull,
  Flame,
  ShieldAlert,
  ArrowRightLeft,
  Heart,
  Loader2,
} from 'lucide-react';
import { TargetSelectorModal } from './hacks/TargetSelectorModal';
import { playPress, playWin } from '../utils/sounds';
import { useToast } from './Toast';

interface OpenedCard {
  id: string;
  title: string;
  rarity: string;
  score: number;
  content_url: string;
}

interface MarketplaceCard {
  listingId: string;
  cardId: string;
  price: number;
  sellerId: string;
  listedAt: string;
  contentUrl: string | null;
  mimeType: string | null;
  name: string | null;
  rarity: string;
  value: number;
  likeCount: number;
  creatorId: string;
}

export function StoreModal({
  points,
  onClose,
  onPurchase,
  onUseConsumable,
  onDeployHack,
  identity,
  users = [],
  profilePics = {},
}: {
  points: number;
  onClose: () => void;
  onPurchase?: (item: StoreItem) => void;
  onUseConsumable?: (item: StoreItem) => void;
  onDeployHack?: (session: ActiveHackSession) => void;
  identity?: OrbitIdentity | null;
  users?: User[];
  profilePics?: Record<string, string>;
}) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<'all' | 'hack' | 'pack' | 'marketplace' | 'inventory'>('all');
  const [storeItems, setStoreItems] = useState<StoreItem[]>(STORE_ITEMS);
  const [marketplaceCards, setMarketplaceCards] = useState<MarketplaceCard[]>([]);
  const [marketplaceLoading, setMarketplaceLoading] = useState(false);
  const [marketplaceError, setMarketplaceError] = useState<string | null>(null);
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
  const [targetModalItem, setTargetModalItem] = useState<StoreItem | null>(null);

  const loadMarketplace = useCallback(async () => {
    if (!identity) return;
    setMarketplaceLoading(true);
    setMarketplaceError(null);
    try {
      const res = await orbitFetch('/api/cards/market', {}, identity);
      if (!res.ok) throw new Error('Failed to load marketplace');
      const data = await res.json();
      const listings = Array.isArray(data?.listings) ? data.listings : [];
      const cards: MarketplaceCard[] = listings.map((l: any) => ({
        listingId: l.listingId,
        cardId: l.cardId,
        price: Number(l.price),
        sellerId: l.sellerId,
        listedAt: l.listedAt,
        contentUrl: l.card?.contentUrl ?? null,
        mimeType: l.card?.mimeType ?? null,
        name: l.card?.name ?? null,
        rarity: l.card?.rarity ?? 'common',
        value: Number(l.card?.value ?? 0),
        likeCount: Number(l.card?.likeCount ?? 0),
        creatorId: l.card?.creatorId ?? '',
      }));
      setMarketplaceCards(cards);
    } catch (err: any) {
      setMarketplaceError(err?.message || 'Failed to load marketplace');
    } finally {
      setMarketplaceLoading(false);
    }
  }, [identity]);

  // Load dynamic store items
  const loadStoreItems = useCallback(async () => {
    if (!identity) return;
    try {
      const res = await orbitFetch('/api/users/store/items', {}, identity);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data?.items)) {
          setStoreItems(data.items);
        }
      }
    } catch { }
  }, [identity]);

  useEffect(() => {
    loadStoreItems();
    loadMarketplace();
  }, [loadStoreItems, loadMarketplace]);

  useEffect(() => {
    if (!identity) return;
    let cancelled = false;
    orbitFetch('/api/users/store/inventory', {}, identity)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: Array<{ item_id: string; quantity: number }>) => {
        if (cancelled || !Array.isArray(rows)) return;
        setInventory((prev) => {
          const next = { ...prev };
          for (const row of rows) {
            next[row.item_id] = Number(row.quantity || 0);
          }
          return next;
        });
      })
      .catch(() => { });
    return () => {
      cancelled = true;
    };
  }, [identity]);

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

  const handleBuy = async (item: StoreItem, targetUserId?: string, targetUserName?: string) => {
    if (points < item.cost) return;
    setBuying(item.id);

    try {
      if (identity) {
        const res = await orbitFetch('/api/users/store/purchase', {
          method: 'POST',
          body: JSON.stringify({ item_id: item.id, target_id: targetUserId || '', idempotency_key: crypto.randomUUID() }),
        }, identity);

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Purchase failed' }));
          toast(err.error || 'Purchase failed', 'error');
          setBuying(null);
          return;
        }
      }

      playWin();
      toast('Purchase successful!', 'success');
      onPurchase?.(item);

      if (item.category === 'hack' && targetUserId) {
        const hackSession: ActiveHackSession = {
          itemId: item.id,
          itemName: item.name,
          targetUserId,
          targetUserName: targetUserName || 'Target Player',
          expiresAt: new Date().getTime() + 180000,
        };
        onDeployHack?.(hackSession);
        onClose();
        return;
      }

      if (item.consumable) {
        setInventory((prev) => ({ ...prev, [item.id]: (prev[item.id] || 0) + 1 }));
      } else {
        setUnlocked((prev) => {
          const next = new Set(prev).add(item.id);
          try {
            localStorage.setItem('orbit_unlocked_store', JSON.stringify(Array.from(next)));
          } catch { }
          return next;
        });
      }
    } catch (e: any) {
      toast(e?.message || 'Error processing purchase', 'error');
    } finally {
      setBuying(null);
    }
  };

  const handleBuyMarketCard = async (card: MarketplaceCard) => {
    if (points < card.price) {
      toast(`Need g$ ${card.price.toLocaleString()} to buy this card`, 'error');
      return;
    }
    if (!identity) return;

    setBuying(card.cardId);
    try {
      const res = await orbitFetch(`/api/cards/${card.cardId}/buy`, {
        method: 'POST',
        body: JSON.stringify({ idempotency_key: crypto.randomUUID() }),
      }, identity);

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Purchase failed' }));
        toast(err.error || 'Failed to purchase card', 'error');
        return;
      }

      playWin();
      toast(`Acquired "${card.name || 'Card'}" from the marketplace!`, 'success');
      window.dispatchEvent(new CustomEvent('orbit-cards-refresh'));
      window.dispatchEvent(new CustomEvent('orbit-score-refresh'));
      loadMarketplace();
    } catch (e: any) {
      toast(e?.message || 'Error purchasing card', 'error');
    } finally {
      setBuying(null);
    }
  };

  const handleOpenPack = async (item: StoreItem) => {
    if ((inventory[item.id] || 0) <= 0 || openingPack) return;
    setOpeningPack(item.id);

    try {
      if (!identity) {
        toast('Sign in to open packs', 'error');
        return;
      }
      const res = await orbitFetch('/api/users/store/open-pack', {
        method: 'POST',
        body: JSON.stringify({ item_id: item.id, idempotency_key: crypto.randomUUID() }),
      }, identity);

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to open pack' }));
        toast(err.error || 'Failed to open pack', 'error');
        return;
      }

      const data = await res.json();
      setInventory((prev) => ({ ...prev, [item.id]: Math.max(0, (prev[item.id] || 1) - 1) }));
      setUnboxedCards(Array.isArray(data.cards) ? data.cards : []);
      window.dispatchEvent(new CustomEvent('orbit-cards-refresh'));
    } catch (err: any) {
      toast(err.message || 'Error opening booster pack', 'error');
    } finally {
      setOpeningPack(null);
    }
  };

  const getItemIcon = (item: StoreItem) => {
    if (item.category === 'hack') {
      if (item.id === 'item-hack-deny') return <EyeOff className="w-5 h-5 text-rose-500" />;
      if (item.id === 'item-hack-takeover') return <Skull className="w-5 h-5 text-cyan-300" />;
      if (item.id === 'item-hack-mobile') return <Flame className="w-5 h-5 text-cyan-400 animate-pulse" />;
      return <ShieldAlert className="w-5 h-5 text-red-500" />;
    }
    if (item.category === 'pack') return <Box className="w-5 h-5 text-cyan-300" />;
    return <Sparkles className="w-5 h-5 text-retro-muted" />;
  };

  const filtered = activeTab === 'all' ? storeItems : storeItems.filter((i) => i.category === activeTab);
  const ownedConsumables = activeTab === 'inventory' ? storeItems.filter((i) => i.consumable && (inventory[i.id] || 0) > 0) : [];

  return (
    <div
      className="fixed inset-0 z-[9999] bg-black/75 backdrop-blur-md flex items-center justify-center p-4 animate-orbit-fade-in select-none font-sans"
      onClick={onClose}
    >
      <div
        className="bg-surface-raised border border-border-glass rounded-3xl max-w-lg w-full max-h-[88vh] flex flex-col shadow-2xl overflow-hidden text-retro-fg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border-glass bg-surface-raised">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-cyan-500 via-teal-500 to-amber-500 flex items-center justify-center text-white shadow-sm">
              <ShoppingBag className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-medium text-retro-fg">Store</h2>
              <p className="text-[10px] text-retro-muted">Buy/Sell liked cards, hacks &amp; celebrity lootboxes with Goon Dollars</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-retro-muted hover:text-retro-fg p-1.5 rounded-full hover:bg-surface-interactive transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Balance HUD */}
        <div className="px-4 py-3 border-b border-border-glass bg-surface-raised flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Coins className="w-4 h-4 text-amber-500" />
            <span className="text-xs font-semibold text-retro-muted">Balance:</span>
            <span className="text-sm font-medium font-mono text-retro-fg tabular-nums">g$ {points.toLocaleString()}</span>
          </div>
          <span className="text-[10px] text-[#8e8e8e] font-medium">Win 1v1 duels or get likes to earn Goon Dollars</span>
        </div>

        {/* Filter tabs */}
        <div className="flex items-center gap-1 p-2 border-b border-border-glass bg-surface-raised text-xs font-semibold overflow-x-auto styled-scrollbar">
          {(['all', 'hack', 'pack', 'marketplace', 'inventory'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => { playPress(750); setActiveTab(tab); }}
              className={`px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap cursor-pointer flex items-center gap-1.5 text-[11px] font-medium ${activeTab === tab
                  ? 'bg-surface-interactive text-retro-fg border border-retro-border'
                  : 'text-retro-muted hover:text-retro-fg'
                }`}
            >
              {tab === 'hack' && <Skull className="w-3.5 h-3.5" />}
              {tab === 'pack' && <Box className="w-3.5 h-3.5" />}
              {tab === 'marketplace' && <ArrowRightLeft className="w-3.5 h-3.5" />}
              {tab === 'inventory' && <Package className="w-3.5 h-3.5" />}
              <span>
                {tab === 'hack'
                  ? 'Hacking Perks'
                  : tab === 'pack'
                    ? 'Lootboxes'
                    : tab === 'marketplace'
                      ? 'Card Marketplace'
                      : tab === 'inventory'
                        ? 'My Inventory'
                        : 'All Items'}
              </span>
            </button>
          ))}
        </div>

        {/* Item list / Marketplace List */}
        <div className="flex-1 overflow-y-auto p-3.5 space-y-2.5 styled-scrollbar bg-surface-raised">
          {activeTab === 'marketplace' ? (
            <div className="space-y-3">
              <div className="bg-cyan-500/10 border border-cyan-500/30 p-3 rounded-2xl flex items-center justify-between text-xs">
                <div>
                  <span className="font-extrabold text-cyan-300 block">Community Card Marketplace</span>
                  <span className="text-[10px] text-cyan-300">Cards listed by other players — prices set by sellers</span>
                </div>
                <button
                  type="button"
                  onClick={loadMarketplace}
                  disabled={marketplaceLoading}
                  className="px-2.5 py-1 rounded-xl bg-cyan-500 hover:bg-cyan-600 text-white font-bold text-[10px] flex items-center gap-1 disabled:opacity-50"
                >
                  {marketplaceLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : '↻'}
                  <span>Refresh</span>
                </button>
              </div>

              {marketplaceError ? (
                <div className="text-center py-10 text-xs text-red-400 space-y-2 bg-surface-raised rounded-2xl border border-border-glass p-6">
                  <p>{marketplaceError}</p>
                  <button
                    type="button"
                    onClick={loadMarketplace}
                    className="px-3 py-1 bg-surface-interactive hover:bg-[#3f3f46] text-retro-body border border-border-glass rounded-lg font-semibold text-[11px]"
                  >
                    Retry
                  </button>
                </div>
              ) : marketplaceLoading && marketplaceCards.length === 0 ? (
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="bg-surface-raised border border-border-glass rounded-2xl p-3 flex items-center gap-3 animate-pulse">
                      <div className="w-14 h-14 rounded-xl bg-surface-interactive shrink-0" />
                      <div className="flex-1 space-y-2">
                        <div className="h-3 bg-surface-interactive rounded w-3/4" />
                        <div className="h-2 bg-surface-interactive rounded w-1/2" />
                      </div>
                      <div className="w-16 h-8 bg-surface-interactive rounded" />
                    </div>
                  ))}
                </div>
              ) : marketplaceCards.length === 0 ? (
                <div className="text-center py-10 text-xs text-retro-muted space-y-2 bg-surface-raised rounded-2xl border border-border-glass p-6">
                  <Box className="w-8 h-8 text-zinc-600 mx-auto" />
                  <p>No cards listed for sale yet</p>
                  <p className="text-[10px] text-zinc-600">List your cards from the Collection tab</p>
                </div>
              ) : (
                marketplaceCards.map((card) => {
                  const canAfford = points >= card.price;
                  const isBuying = buying === card.cardId;
                  return (
                    <div
                      key={card.listingId}
                      className="bg-surface-raised border border-border-glass hover:border-cyan-500/50 rounded-2xl p-3 flex items-center gap-3 transition-all shadow-xs"
                    >
                      <div className="w-14 h-14 rounded-xl bg-black overflow-hidden shrink-0 border border-border-glass relative">
                        {card.contentUrl ? (
                          <img src={card.contentUrl} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <Box className="w-6 h-6 text-zinc-600 m-auto mt-3" />
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-extrabold text-retro-fg text-xs truncate">{card.name || 'Unnamed Card'}</span>
                          <span className="text-[8px] font-medium px-1.5 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300">
                            {card.rarity}
                          </span>
                        </div>
                        <div className="text-[10px] text-retro-muted flex items-center gap-2 mt-0.5">
                          <span className="flex items-center gap-0.5 text-rose-500 font-bold">
                            <Heart className="w-3 h-3 fill-current" />
                            <span>{card.likeCount}</span>
                          </span>
                          <span className="text-zinc-600">•</span>
                          <span>Value: {card.value}</span>
                        </div>
                      </div>

                      <div className="shrink-0 flex flex-col items-end gap-1">
                        <span className="text-xs font-medium font-mono text-cyan-300">g$ {card.price.toLocaleString()}</span>
                        <button
                          type="button"
                          disabled={!canAfford || isBuying}
                          onClick={() => handleBuyMarketCard(card)}
                          className={`px-3 py-1 text-xs font-bold rounded-xl transition-all cursor-pointer uppercase flex items-center gap-1 ${canAfford
                              ? 'bg-cyan-500 hover:bg-cyan-600 text-white shadow-xs'
                              : 'bg-zinc-700 text-retro-muted cursor-not-allowed'
                            }`}
                        >
                          {isBuying ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                          <span>{isBuying ? 'Buying...' : 'Buy Card'}</span>
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          ) : activeTab === 'inventory' ? (
            ownedConsumables.length === 0 ? (
              <div className="text-center py-10 text-xs text-[#8e8e8e] space-y-2 bg-surface-raised rounded-2xl border border-border-glass p-6">
                <Package className="w-8 h-8 text-[#a8a8a8] mx-auto" />
                <p>No packs or items in your inventory yet. Purchase a Lootbox from the Store!</p>
              </div>
            ) : (
              ownedConsumables.map((item) => {
                const count = inventory[item.id] || 0;
                const isPack = item.category === 'pack' || item.id.startsWith('item-pack-');
                return (
                  <div
                    key={item.id}
                    className="bg-surface-raised border border-border-glass hover:border-border-glass rounded-2xl p-3 flex items-center gap-3 transition-colors shadow-xs"
                  >
                    <div className="w-10 h-10 rounded-xl bg-surface-interactive border border-border-glass flex items-center justify-center text-retro-body font-bold shrink-0">
                      {getItemIcon(item)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-extrabold text-retro-fg text-xs truncate">{item.name}</span>
                        <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                          ×{count}
                        </span>
                      </div>
                      <div className="text-[11px] text-retro-muted line-clamp-2 mt-0.5">{item.desc}</div>
                    </div>
                    {isPack ? (
                      <button
                        type="button"
                        disabled={Boolean(openingPack)}
                        onClick={() => handleOpenPack(item)}
                        className="px-3 py-1.5 text-xs font-medium bg-retro-accent hover:bg-retro-accent-hover text-black rounded-lg cursor-pointer transition-colors flex items-center gap-1 disabled:opacity-40"
                      >
                        <Sparkles className="w-3.5 h-3.5 fill-current" />
                        <span>{openingPack === item.id ? 'Opening...' : 'Open Lootbox'}</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          if (item.category === 'hack') {
                            setTargetModalItem(item);
                          } else {
                            onUseConsumable?.(item);
                          }
                        }}
                        className="px-3 py-1.5 text-xs font-medium bg-rose-500/15 hover:bg-rose-500/20 text-rose-400 rounded-lg cursor-pointer transition-colors flex items-center gap-1"
                      >
                        <Zap className="w-3.5 h-3.5 fill-current" />
                        <span>Use</span>
                      </button>
                    )}
                  </div>
                );
              })
            )
          ) : (
            filtered.map((item) => {
              const isOwned = !item.consumable && unlocked.has(item.id);
              const count = item.consumable ? (inventory[item.id] || 0) : 0;
              const canAfford = points >= item.cost;
              const isHack = item.category === 'hack';
              return (
                <div
                  key={item.id}
                  className={`border rounded-2xl p-3 flex items-center gap-3 transition-colors shadow-xs ${isHack
                      ? 'bg-rose-50/60 border-rose-200 hover:border-rose-300'
                      : 'bg-surface-raised border-border-glass hover:border-border-glass'
                    }`}
                >
                  <div className="w-10 h-10 rounded-xl bg-surface-interactive border border-border-glass flex items-center justify-center font-bold shrink-0">
                    {getItemIcon(item)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-extrabold text-retro-fg text-xs truncate">{item.name}</span>
                      {item.badge && (
                        <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-surface-interactive text-retro-muted border border-border-glass">
                          {item.badge}
                        </span>
                      )}
                      {count > 0 && (
                        <span className="text-[8px] font-bold px-1.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">
                          ×{count}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-retro-muted line-clamp-2 mt-0.5">{item.desc}</div>
                  </div>

                  <div className="shrink-0 flex items-center gap-2">
                    <span className="text-xs font-medium font-mono text-retro-fg">g$ {item.cost.toLocaleString()}</span>
                    {isOwned ? (
                      <span className="px-2.5 py-1 text-xs font-bold bg-emerald-100 text-emerald-700 rounded-xl border border-emerald-200 flex items-center gap-1">
                        <Check className="w-3 h-3" />
                        <span>Owned</span>
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={!canAfford || buying === item.id}
                        onClick={() => {
                          if (isHack) {
                            setTargetModalItem(item);
                          } else {
                            handleBuy(item);
                          }
                        }}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer flex items-center gap-1 ${canAfford
                            ? isHack
                              ? 'bg-rose-600 hover:bg-rose-700 text-white shadow-xs'
                              : 'bg-gradient-to-r from-cyan-500 via-teal-500 to-amber-500 hover:opacity-95 text-white shadow-xs'
                            : 'bg-[#e4e4e7] text-[#a1a1aa] cursor-not-allowed'
                          }`}
                      >
                        <span>{buying === item.id ? 'Purchasing...' : isHack ? 'Deploy Hack' : 'Buy'}</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer info */}
        <div className="p-3 border-t border-border-glass bg-surface-raised text-center text-[10px] text-[#8e8e8e]">
          Purchases are instantly applied to your decentralized Orbit profile.
        </div>
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
            const targetId = targetUser.id || (targetUser as any).orbitId;
            const targetName = targetUser.display_name || (targetUser as any).name;
            handleBuy(itemToBuy, targetId, targetName);
          }}
        />
      )}

      {/* Unboxed Cards Modal */}
      {unboxedCards && (
        <div
          className="fixed inset-0 z-[10000] bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-orbit-fade-in"
          onClick={() => setUnboxedCards(null)}
        >
          <div
            className="bg-surface-raised border border-border-glass rounded-3xl p-6 max-w-sm w-full text-center space-y-4 shadow-2xl animate-orbit-pop text-retro-fg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-12 h-12 rounded-2xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center mx-auto text-cyan-300">
              <Sparkles className="w-6 h-6 animate-spin" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-medium text-retro-fg">Pack Opened</h3>
              <p className="text-xs text-retro-muted">New collectible cards added to your collection</p>
            </div>
            <div className="space-y-2">
              {unboxedCards.map((card, idx) => (
                <div key={idx} className="bg-surface-raised border border-border-glass rounded-2xl p-3 flex items-center gap-3 text-left">
                  <div className="w-12 h-12 rounded-xl bg-black overflow-hidden shrink-0 border border-border-glass">
                    {card.content_url ? (
                      <ObjectImage contentUrl={card.content_url} objectId={card.id} identity={identity ?? null} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <Box className="w-6 h-6 text-purple-400 m-auto mt-3" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-extrabold text-xs text-retro-fg truncate">{card.title}</div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[9px] font-medium uppercase px-1.5 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                        {card.rarity}
                      </span>
                      <span className="text-[10px] font-medium text-amber-600 font-mono">+{card.score} Goon Dollars</span>
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
              Collect &amp; Continue
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
