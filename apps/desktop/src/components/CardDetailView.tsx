"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Heart, Tag, TrendingUp, Coins, Gift } from 'lucide-react';
import { orbitFetch } from '../utils/api';
import { userFacingError } from '../utils/userError';
import type { OrbitIdentity } from '@orbit/crypto';
import { computeCashoutPayout, clampCashoutRateBps, DEFAULT_CASHOUT_RATE_BPS, formatGc } from '@orbit/shared';
import { GameCard } from './cards/GameCard';
import { computeCardRarity } from '@orbit/shared';
import { isMediaVideo } from '../utils/media';
import { Button, Input } from '../ui/kit';
import {
  classes, CHROME, COLOR, FEEDBACK, GAP, ICON, MONO, PADDING, PADDING_X, PADDING_Y,
  RADIUS, RECIPE, STATUS, TYPE, WEIGHT,
} from '../ui/tokens';

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
  /** Open market ask, joined by GET /api/cards/:id (may be outside the market feed's first page). */
  listingPrice?: number | null;
}

interface CardDetailViewProps {
  cardId: string;
  identity: OrbitIdentity | null;
  onClose: () => void;
  toast?: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  onOpenProfile?: (userId: string) => void;
  onGiftCard?: (card: CardRecord) => void;
}

/**
 * Card info modal — the community-store workhorse (Steam style):
 * owners list cards for g$ or cash out; anyone can browse a listing and
 * buy it. Media renders through ObjectImage (signed fetch) so private
 * objects actually show up.
 */
export function CardDetailView({ cardId, identity, onClose, toast, onOpenProfile, onGiftCard }: CardDetailViewProps) {
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

      // The single-card response joins the OPEN listing's ask directly. The
      // market feed is newest-first and capped, so scraping it used to leave a
      // legitimately listed card with no price (and therefore no Buy button)
      // once its listing fell off page one, or whenever that fetch failed.
      const detailPrice = typeof cardData.card?.listingPrice === 'number' ? cardData.card.listingPrice : null;
      setListingPrice(detailPrice);
      if (cardData.card?.marketStatus === 'listed' && detailPrice === null) {
        const marketRes = await orbitFetch('/api/cards/market?limit=100', {}, identity);
        if (marketRes.ok) {
          const marketData = await marketRes.json();
          const listing = (Array.isArray(marketData?.listings) ? marketData.listings : []).find((l: { cardId?: string }) => l.cardId === cardId);
          setListingPrice(typeof listing?.price === 'number' ? listing.price : null);
        }
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
      toast?.(userFacingError(e, { fallback: 'Network error. Try again' }), 'error');
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
      <div className={RECIPE.modalOverlay}>
        <div className={classes(CHROME.overlayPanel, PADDING[8], 'max-w-2xl w-full mx-4')}>
          <div className="animate-pulse space-y-4">
            <div className={classes('h-8 bg-surface-elevated w-3/4', RADIUS.control)}></div>
            <div className={classes('h-64 bg-surface-elevated', RADIUS.control)}></div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !card) {
    return (
      <div className={RECIPE.modalOverlay}>
        <div className={classes(CHROME.overlayPanel, PADDING[8], 'max-w-2xl w-full mx-4')}>
          <div className={classes('flex items-center justify-between mb-4', GAP[2])}>
            <h2 className={classes(TYPE.base, WEIGHT.heading, 'tracking-tight', COLOR.fg)}>Card details</h2>
            <Button variant="danger" size="sm" onClick={onClose} aria-label="Close card details" className="h-8 w-8 p-0">
              <X className={ICON.lg} />
            </Button>
          </div>
          <div className="text-center py-8">
            <p className={STATUS.danger}>{error || 'Card not found'}</p>
          </div>
        </div>
      </div>
    );
  }

  const statusLabel = card.marketStatus === 'none' ? 'Not Listed' : card.marketStatus === 'cashed_out' ? 'Cashed Out' : card.marketStatus === 'listed' ? 'On Market' : card.marketStatus;

  return (
    <div className={classes(RECIPE.modalOverlay, 'overflow-y-auto')} onClick={onClose}>
      <div className={classes(CHROME.overlayPanel, 'max-w-2xl w-full max-h-(--max-h-dialog) flex flex-col overflow-hidden')} onClick={(e) => e.stopPropagation()}>
        <div className={classes(RECIPE.cardHeader, 'shrink-0')}>
          <div className="min-w-0">
            <h2 className={classes(TYPE.title, WEIGHT.bold, COLOR.fg, 'truncate')}>{card.name || 'Unnamed Card'}</h2>
            <p className={classes(TYPE.body, COLOR.muted, 'mt-0.5')}>
              {new Date(card.createdAt).toLocaleDateString()} · <span className="capitalize">{statusLabel}</span>
            </p>
          </div>
          <Button variant="danger" size="sm" onClick={onClose} aria-label="Close card details" className="h-8 w-8 p-0">
            <X className={ICON.md} />
          </Button>
        </div>

        {/* Content */}
        <div className={classes(PADDING[5], 'space-y-4 overflow-y-auto')}>
          {/* The card as a tall card, Pokemon-style holo (react-holo-card-effect). */}
          <div className="flex justify-center">
            <GameCard
              objectId={card.mediaObjectId}
              identity={identity}
              width={300}
              height={340}
              isVideo={Boolean(card.mimeType?.startsWith('video/') || isMediaVideo(card.contentUrl))}
              name={card.name}
              rarity={computeCardRarity(card.value ?? 0)}
              value={card.value ?? 0}
              accentColor={card.accentColor}
              frame={card.frame}
              className="max-w-[300px]"
            />
          </div>

          {/* Compact stat row */}
          <div className={classes('flex items-center flex-wrap', GAP[2], TYPE.body)}>
            <span className={classes(CHROME.badge, 'capitalize', WEIGHT.semibold)}>
              <Tag className={classes(ICON.sm, 'inline mr-1', COLOR.muted)} />{card.rarity}
            </span>
            <span className={classes(CHROME.badge, WEIGHT.semibold)}>
              <TrendingUp className={classes(ICON.sm, 'inline mr-1', COLOR.muted)} />{formatGc(card.value ?? 0)} g$
            </span>
            <span className={classes(CHROME.badge, WEIGHT.semibold)}>
              <Heart className={classes(ICON.sm, 'inline mr-1', COLOR.muted)} />{card.likeCount}
            </span>
            {card.creatorId && (
              <button
                type="button"
                onClick={() => onOpenProfile?.(card.creatorId)}
                disabled={!onOpenProfile}
                className={classes('glass-inset ml-auto', PADDING_X[2.5], PADDING_Y[1.5], RADIUS.pill, TYPE.body, MONO, COLOR.muted, onOpenProfile ? 'cursor-pointer' : 'cursor-default')}
                title="View creator"
              >
                by {card.creatorId.slice(0, 8)}…
              </button>
            )}
          </div>

          {(card.description || card.caption || (card.tags && card.tags.length > 0)) && (
            <div className="space-y-2">
              {(card.caption || card.description) && <p className={FEEDBACK.description}>{card.caption || card.description}</p>}
              {card.tags && card.tags.length > 0 && (
                <div className={classes('flex flex-wrap', GAP[1.5])}>
                  {card.tags.map((tag) => (
                    <span key={tag} className={classes(TYPE.caption, RADIUS.pill, 'border', PADDING_X[2], 'py-0.5')} style={{ borderColor: `${card.accentColor || '#9FE3FF'}88`, color: card.accentColor || '#9FE3FF' }}>
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Market actions */}
          {canBuy && (
            <div className={classes('glass-inset flex items-center justify-between', GAP[3], PADDING[4])}>
              <div>
                <div className={classes(TYPE.caption, 'uppercase', 'tracking-wider', COLOR.muted, WEIGHT.bold)}>Community market price</div>
                <div className={classes(TYPE.title, WEIGHT.heading, MONO, STATUS.info, 'tabular-nums')}>{formatGc(listingPrice ?? 0)} g$</div>
              </div>
              <Button
                type="button"
                variant="primary"
                disabled={buying}
                onClick={() => void handleBuy()}
                className="px-5 uppercase tracking-wider"
              >
                {buying ? 'Buying…' : 'Buy Now'}
              </Button>
            </div>
          )}

          {isOwner && card.marketStatus === 'cashed_out' && (
            <div className={classes(TYPE.body, COLOR.fg, WEIGHT.semibold, 'flex items-center', GAP[2])}>
              <Coins className={ICON.md} /> This card was cashed out for g$.
            </div>
          )}

          {isOwner && card.marketStatus !== 'cashed_out' && (
            <div className={classes('space-y-3 pt-3 border-t', COLOR.edge)}>
              <div className={classes('flex', GAP[3])}>
                {card.marketStatus === 'none' && (
                  <>
                    <Button
                      type="button"
                      variant="primary"
                      disabled={marketBusy || !/^\d+$/.test(listPrice) || Number(listPrice) <= 0}
                      onClick={() => { void mutateCard('list', { price: Number(listPrice) }, `Listed for ${formatGc(Number(listPrice))} g$`) }}
                      className="flex-1"
                    >
                      List for Sale
                    </Button>
                    {onGiftCard && (
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={marketBusy}
                        onClick={() => onGiftCard(card)}
                        className={classes('flex-1', 'flex items-center justify-center', GAP[1.5])}
                      >
                        <Gift className={classes(ICON.sm, STATUS.warning)} />
                        <span>Gift Card</span>
                      </Button>
                    )}
                  </>
                )}
                {card.marketStatus === 'listed' && (
                  <>
                    <div className={classes('flex-1', TYPE.body, STATUS.info, WEIGHT.semibold, 'self-center')}>
                      Listed for {formatGc(listingPrice ?? (Number(listPrice) > 0 ? Number(listPrice) : 0))} g$
                    </div>
                    <Button
                      type="button"
                      variant="danger"
                      disabled={marketBusy}
                      onClick={() => { void mutateCard('cancel', undefined, 'Listing cancelled') }}
                      className="flex-1"
                    >
                      Cancel Listing
                    </Button>
                  </>
                )}
              </div>

              {card.marketStatus === 'none' && (
                <div className={classes('flex items-center', GAP[2])}>
                  <label className={classes(TYPE.body, COLOR.muted)} htmlFor="card-list-price">List price (g$)</label>
                  <Input
                    id="card-list-price"
                    name="list price"
                    type="number"
                    min={1}
                    aria-label="List price in g$"
                    value={listPrice}
                    onChange={(e) => setListPrice(e.target.value)}
                    className={classes('flex-1', MONO)}
                  />
                </div>
              )}

              {card.marketStatus === 'none' && (
                <div className={classes('glass-inset', PADDING[4])}>
                  <div className={classes('flex items-center justify-between', GAP[3])}>
                    <div className={TYPE.sub}>
                      <div className={classes(COLOR.muted, TYPE.body, 'mb-0.5')}>Cash out value</div>
                      <div className={classes(WEIGHT.bold, COLOR.fg)}>
                        {formatGc(computeCashoutPayout(card.value ?? 0, cashoutRate))}
                        <span className={classes('ml-2', TYPE.caption, COLOR.muted, MONO)}>({(cashoutRate / 100).toFixed(1)}% rate)</span>
                      </div>
                    </div>
                    {confirmCashout ? (
                      <div className={classes('flex items-center', GAP[2])}>
                        <Button type="button" variant="primary" disabled={cashingOut} onClick={handleCashOut}>
                          {cashingOut ? 'Cashing out…' : 'Confirm'}
                        </Button>
                        <Button type="button" variant="secondary" onClick={() => setConfirmCashout(false)}>Cancel</Button>
                      </div>
                    ) : (
                      <Button type="button" variant="primary" onClick={() => setConfirmCashout(true)} className={classes('flex items-center', GAP[1.5])}>
                        <Coins className={ICON.sm} /> Cash Out Card
                      </Button>
                    )}
                  </div>
                  <p className={classes(TYPE.caption, COLOR.muted, 'mt-2')}>
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
