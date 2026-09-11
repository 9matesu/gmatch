"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Heart, Tag, TrendingUp, Coins } from 'lucide-react';
import { orbitFetch } from '../utils/api';
import { userFacingError } from '../utils/userError';
import type { OrbitIdentity } from '@orbit/crypto';
import { computeCashoutPayout, clampCashoutRateBps, DEFAULT_CASHOUT_RATE_BPS, formatGc } from '@orbit/shared';
import { ObjectImage } from './ObjectImage';

interface CardRecord {
  id: string;
  creatorId: string;
  mediaObjectId: string;
  name: string | null;
  tags?: string[];
  description?: string | null;
  frame?: string;
  accentColor?: string;
  rarity: string;
  value: number;
  likeCount: number;
  marketStatus: string;
  moderationState: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  contentUrl?: string | null;
  mimeType?: string | null;
  caption?: string | null;
}

interface CardDetailViewProps {
  cardId: string;
  identity: OrbitIdentity | null;
  onClose: () => void;
  toast?: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  onOpenProfile?: (userId: string) => void;
}

/**
 * Card info modal — the community-store workhorse (Steam style):
 * owners list cards for g$ or cash out; anyone can browse a listing and
 * buy it. Media renders through ObjectImage (signed fetch) so private
 * objects actually show up.
 */
export function CardDetailView({ cardId, identity, onClose, toast, onOpenProfile }: CardDetailViewProps) {
  const [card, setCard] = useState<CardRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cashoutRate, setCashoutRate] = useState<number>(DEFAULT_CASHOUT_RATE_BPS);
  const [cashingOut, setCashingOut] = useState(false);
  const [confirmCashout, setConfirmCashout] = useState(false);
  const [listPrice, setListPrice] = useState('');
  const [marketBusy, setMarketBusy] = useState(false);
  const [listingPrice, setListingPrice] = useState<number | null>(null);
  const [buying, setBuying] = useState(false);
  const inflightRef = useRef(false);

  const refreshCardData = useCallback(async (initial: boolean) => {
    if (!cardId || !identity) return;
    if (inflightRef.current) return;
    inflightRef.current = true;

    if (initial) {
      setLoading(true);
      setError(null);
    }

    try {
      const cardRes = await orbitFetch(`/api/cards/${cardId}`, {}, identity);
      if (!cardRes.ok) {
        throw new Error('Failed to load card details');
      }
      const cardData = await cardRes.json();
      setCard(cardData.card);

      // Open listings carry the ask price; pull it from the market feed.
      if (cardData.card?.marketStatus === 'listed') {
        const marketRes = await orbitFetch('/api/cards/market?limit=100', {}, identity);
        if (marketRes.ok) {
          const marketData = await marketRes.json();
          const listing = (Array.isArray(marketData?.listings) ? marketData.listings : []).find((l: { cardId?: string }) => l.cardId === cardId);
          setListingPrice(typeof listing?.price === 'number' ? listing.price : null);
        }
      } else {
        setListingPrice(null);
      }

      const rateRes = await orbitFetch('/api/economy/cashout-rate', {}, identity);
      if (rateRes.ok) {
        const rateData = await rateRes.json();
        setCashoutRate(clampCashoutRateBps(rateData?.rateBps));
      }
    } catch (err) {
      if (initial) {
        setError(err instanceof Error ? err.message : 'Failed to load card data');
        toast?.('Failed to load card details', 'error');
      }
    } finally {
      inflightRef.current = false;
      if (initial) setLoading(false);
    }
  }, [cardId, identity, toast]);

  useEffect(() => {
    if (!cardId || !identity) return;
    void refreshCardData(true);
  }, [cardId, identity, refreshCardData]);

  // Refresh after mutations elsewhere (no idle polling).
  useEffect(() => {
    const onCardsRefresh = () => void refreshCardData(false);
    window.addEventListener('orbit-cards-refresh', onCardsRefresh);
    return () => window.removeEventListener('orbit-cards-refresh', onCardsRefresh);
  }, [refreshCardData]);

  const isOwner = Boolean(identity && card && identity.orbitId === card.ownerId);
  const canBuy = Boolean(card && !isOwner && card.marketStatus === 'listed' && listingPrice !== null);

  const mutateCard = async (
    action: 'list' | 'cancel' | 'buy',
    body?: Record<string, unknown>,
    okMsg?: string,
  ): Promise<boolean> => {
    if (!identity || !card || marketBusy || buying) return false;
    const setBusy = action === 'buy' ? setBuying : setMarketBusy;
    setBusy(true);
    try {
      const res = await orbitFetch(`/api/cards/${card.id}/${action}`, {
        method: 'POST',
        ...(body ? { body: JSON.stringify(body) } : {}),
      }, identity);
      const data = await res.json().catch(() => ({}) as { error?: string; card?: CardRecord });
      if (!res.ok) {
        toast?.(userFacingError(null, { status: res.status, fallback: data.error || 'Operation failed' }), 'error');
        return false;
      }
      toast?.(okMsg || 'Done!', 'success');
      if (data.card) setCard(data.card);
      window.dispatchEvent(new CustomEvent('orbit-cards-refresh'));
      window.dispatchEvent(new CustomEvent('orbit-score-refresh'));
      return true;
    } catch (e: unknown) {
      toast?.(userFacingError(e, { fallback: 'Network error — try again' }), 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleBuy = async () => {
    const ok = await mutateCard('buy', { idempotency_key: crypto.randomUUID() }, `Bought for ${formatGc(listingPrice ?? 0)} g$`)
    if (ok) onClose();
  };

  const handleCashOut = async () => {
    if (!identity || !card || cashingOut) return;
    setCashingOut(true);
    try {
      const res = await orbitFetch(`/api/cards/${card.id}/cashout`, {
        method: 'POST',
        body: JSON.stringify({ idempotency_key: crypto.randomUUID() }),
      }, identity);
      const data = await res.json().catch(() => ({ error: 'Cashout failed' }));
      if (!res.ok) {
        toast?.(data.error || 'Cashout failed', 'error');
        return;
      }
      toast?.(`Cashed out for ${formatGc(data.payout)}.`, 'success');
      setConfirmCashout(false);
      window.dispatchEvent(new CustomEvent('orbit-cards-refresh'));
      window.dispatchEvent(new CustomEvent('orbit-score-refresh'));
      void refreshCardData(false);
    } catch (e: unknown) {
      toast?.(userFacingError(e, { fallback: 'Cashout error' }), 'error');
    } finally {
      setCashingOut(false);
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
        <div className="glass-card p-8 max-w-2xl w-full mx-4">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-surface-elevated rounded w-3/4"></div>
            <div className="h-64 bg-surface-elevated rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !card) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
        <div className="glass-card p-8 max-w-2xl w-full mx-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-retro-fg">Card details</h2>
            <button onClick={onClose} className="glass-action glass-action-danger h-8 w-8 rounded-lg flex items-center justify-center cursor-pointer">
              <X className="w-6 h-6" />
            </button>
          </div>
          <div className="text-center py-8">
            <p className="text-red-400">{error || 'Card not found'}</p>
          </div>
        </div>
      </div>
    );
  }

  const statusLabel = card.marketStatus === 'none' ? 'Not Listed' : card.marketStatus === 'cashed_out' ? 'Cashed Out' : card.marketStatus === 'listed' ? 'On Market' : card.marketStatus;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 overflow-y-auto" onClick={onClose}>
      <div className="glass-card max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="glass-header flex items-center justify-between px-5 py-4 shrink-0">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-retro-fg truncate">{card.name || 'Unnamed Card'}</h2>
            <p className="text-xs text-retro-muted mt-0.5">
              {new Date(card.createdAt).toLocaleDateString()} · <span className="capitalize">{statusLabel}</span>
            </p>
          </div>
          <button onClick={onClose} aria-label="Close card details" className="glass-action glass-action-danger h-8 w-8 rounded-lg flex items-center justify-center cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Card media — ObjectImage does the signed object fetch (raw
              /api/objects URLs are auth-protected and fail as plain <img>). */}
          <div className="flex justify-center">
            <div className="glass-card max-w-sm w-full overflow-hidden rounded-lg">
              <ObjectImage
                objectId={card.mediaObjectId}
                contentUrl={card.contentUrl}
                mimeType={card.mimeType}
                identity={identity}
                alt={card.name || 'Card'}
                className="w-full aspect-[3/3.4] object-cover"
                videoClassName="w-full aspect-[3/3.4] object-cover"
              />
            </div>
          </div>

          {/* Compact stat row */}
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="glass-inset px-2.5 py-1.5 rounded-full capitalize text-retro-fg font-semibold">
              <Tag className="w-3.5 h-3.5 inline mr-1 text-retro-muted" />{card.rarity}
            </span>
            <span className="glass-inset px-2.5 py-1.5 rounded-full text-retro-fg font-semibold">
              <TrendingUp className="w-3.5 h-3.5 inline mr-1 text-retro-muted" />{formatGc(card.value ?? 0)} g$
            </span>
            <span className="glass-inset px-2.5 py-1.5 rounded-full text-retro-fg font-semibold">
              <Heart className="w-3.5 h-3.5 inline mr-1 text-retro-muted" />{card.likeCount}
            </span>
            {card.creatorId && (
              <button
                type="button"
                onClick={() => onOpenProfile?.(card.creatorId)}
                disabled={!onOpenProfile}
                className={`glass-inset ml-auto px-2.5 py-1.5 rounded-full text-xs font-mono text-retro-muted ${onOpenProfile ? 'cursor-pointer' : 'cursor-default'}`}
                title="View creator"
              >
                by {card.creatorId.slice(0, 8)}…
              </button>
            )}
          </div>

          {(card.description || card.caption || (card.tags && card.tags.length > 0)) && (
            <div className="space-y-2">
              {(card.caption || card.description) && <p className="text-sm text-retro-body">{card.caption || card.description}</p>}
              {card.tags && card.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {card.tags.map((tag) => (
                    <span key={tag} className="text-[10px] rounded-full border px-2 py-0.5" style={{ borderColor: `${card.accentColor || '#9FE3FF'}88`, color: card.accentColor || '#9FE3FF' }}>
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Market actions */}
          {canBuy && (
            <div className="glass-inset flex items-center justify-between gap-3 p-4">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-retro-muted font-bold">Community market price</div>
                <div className="text-lg font-black font-mono text-cyan-300 tabular-nums">{formatGc(listingPrice ?? 0)} g$</div>
              </div>
              <button
                type="button"
                disabled={buying}
                onClick={() => void handleBuy()}
                className="glass-action glass-action-primary px-5 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider cursor-pointer"
              >
                {buying ? 'Buying…' : 'Buy Now'}
              </button>
            </div>
          )}

          {isOwner && card.marketStatus === 'cashed_out' && (
            <div className="text-xs text-retro-fg font-semibold flex items-center gap-2">
              <Coins className="w-4 h-4" /> This card was cashed out for g$.
            </div>
          )}

          {isOwner && card.marketStatus !== 'cashed_out' && (
            <div className="space-y-3 pt-3 border-t border-white/10">
              <div className="flex gap-3">
                {card.marketStatus === 'none' && (
                  <button
                    type="button"
                    disabled={marketBusy || !/^\d+$/.test(listPrice) || Number(listPrice) <= 0}
                    onClick={() => { void mutateCard('list', { price: Number(listPrice) }, `Listed for ${formatGc(Number(listPrice))} g$`) }}
                    className="glass-action glass-action-primary flex-1 py-2 px-4 rounded-lg font-semibold cursor-pointer disabled:opacity-40"
                  >
                    List for Sale
                  </button>
                )}
                {card.marketStatus === 'listed' && (
                  <>
                    <div className="flex-1 text-xs text-cyan-300 font-semibold self-center">
                      Listed for {formatGc(listingPrice ?? (Number(listPrice) > 0 ? Number(listPrice) : 0))} g$
                    </div>
                    <button
                      type="button"
                      disabled={marketBusy}
                      onClick={() => { void mutateCard('cancel', undefined, 'Listing cancelled') }}
                      className="glass-action glass-action-danger flex-1 py-2 px-4 rounded-lg font-semibold cursor-pointer disabled:opacity-40"
                    >
                      Cancel Listing
                    </button>
                  </>
                )}
              </div>

              {card.marketStatus === 'none' && (
                <div className="flex items-center gap-2">
                  <label className="text-xs text-retro-muted" htmlFor="card-list-price">List price (g$)</label>
                  <input
                    id="card-list-price"
                    name="list price"
                    type="number"
                    min={1}
                    aria-label="List price in g$"
                    value={listPrice}
                    onChange={(e) => setListPrice(e.target.value)}
                    className="glass-field flex-1 px-3 py-2 text-xs font-mono"
                  />
                </div>
              )}

              {card.marketStatus === 'none' && (
                <div className="glass-inset p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm">
                      <div className="text-retro-muted text-xs mb-0.5">Cash out value</div>
                      <div className="font-bold text-retro-fg">
                        {formatGc(computeCashoutPayout(card.value ?? 0, cashoutRate))}
                        <span className="ml-2 text-[10px] text-retro-muted font-mono">({(cashoutRate / 100).toFixed(1)}% rate)</span>
                      </div>
                    </div>
                    {confirmCashout ? (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={cashingOut}
                          onClick={handleCashOut}
                          className="glass-action glass-action-primary disabled:opacity-50 py-2 px-3 rounded-lg text-xs font-bold cursor-pointer"
                        >
                          {cashingOut ? 'Cashing out…' : 'Confirm'}
                        </button>
                        <button type="button" onClick={() => setConfirmCashout(false)} className="glass-action text-xs px-3 py-1.5 rounded-lg cursor-pointer">
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmCashout(true)}
                        className="glass-action glass-action-primary py-2 px-4 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                      >
                        <Coins className="w-3.5 h-3.5" /> Cash Out Card
                      </button>
                    )}
                  </div>
                  <p className="text-[10px] text-retro-muted mt-2">
                    Listing sells it to another player for g$; cashing out burns it for a fixed payout instead.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
