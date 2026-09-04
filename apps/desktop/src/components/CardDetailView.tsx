"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Heart, Clock, User, Tag, TrendingUp, History, Coins, ChevronUp, ChevronDown } from 'lucide-react';
import { orbitFetch } from '../utils/api';
import type { OrbitIdentity } from '@orbit/crypto';
import { computeCashoutPayout, clampCashoutRateBps, DEFAULT_CASHOUT_RATE_BPS, formatGc } from '@orbit/shared';

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

interface CardHistoryRecord {
  id: string;
  cardId: string;
  event: string;
  fromUser: string | null;
  toUser: string | null;
  meta: any;
  createdAt: string;
}

interface CardDetailViewProps {
  cardId: string;
  identity: OrbitIdentity | null;
  onClose: () => void;
  toast?: (msg: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  onOpenProfile?: (userId: string) => void;
}

export function CardDetailView({ cardId, identity, onClose, toast, onOpenProfile }: CardDetailViewProps) {
  const [card, setCard] = useState<CardRecord | null>(null);
  const [history, setHistory] = useState<CardHistoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cashoutRate, setCashoutRate] = useState<number>(DEFAULT_CASHOUT_RATE_BPS);
  const [cashingOut, setCashingOut] = useState(false);
  const [confirmCashout, setConfirmCashout] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(true);
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
      // Load card details
      const cardRes = await orbitFetch(`/api/cards/${cardId}`, {}, identity);
      if (!cardRes.ok) {
        throw new Error('Failed to load card details');
      }
      const cardData = await cardRes.json();
      setCard(cardData.card);

      // Load card history
      const historyRes = await orbitFetch(`/api/cards/${cardId}/history`, {}, identity);
      if (historyRes.ok) {
        const historyData = await historyRes.json();
        setHistory(historyData.history || []);
      }

      // Load the current cashout rate so the payout preview is accurate.
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

  // Live valuation: poll the card so the g$ value stays current while open.
  useEffect(() => {
    if (!cardId || !identity) return;
    const interval = setInterval(() => void refreshCardData(false), 5000);
    const onCardsRefresh = () => void refreshCardData(false);
    const onScoreRefresh = () => void refreshCardData(false);
    window.addEventListener('orbit-cards-refresh', onCardsRefresh);
    window.addEventListener('orbit-score-refresh', onScoreRefresh);
    return () => {
      clearInterval(interval);
      window.removeEventListener('orbit-cards-refresh', onCardsRefresh);
      window.removeEventListener('orbit-score-refresh', onScoreRefresh);
    };
  }, [cardId, identity, refreshCardData]);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString();
  };

  const getEventLabel = (event: string) => {
    const labels: Record<string, string> = {
      created: 'Created',
      transferred: 'Transferred',
      listed: 'Listed for Sale',
      sold: 'Sold',
      cancelled: 'Listing Cancelled',
      liked: 'Liked',
      cashed_out: 'Cashed Out',
    };
    return labels[event] || event;
  };

  const getEventColor = (event: string) => {
    const colors: Record<string, string> = {
      created: 'text-green-400',
      transferred: 'text-blue-400',
      listed: 'text-yellow-400',
      sold: 'text-purple-400',
      cancelled: 'text-red-400',
      liked: 'text-pink-400',
      cashed_out: 'text-amber-400',
    };
    return colors[event] || 'text-retro-muted';
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
      toast?.(`Cashed out for ${formatGc(data.payout)}!`, 'success');
      setConfirmCashout(false);
      // Refresh collection, wallet, and this card's status.
      window.dispatchEvent(new CustomEvent('orbit-cards-refresh'));
      window.dispatchEvent(new CustomEvent('orbit-score-refresh'));
      // Reload card + history to reflect the cashed-out state.
      const [cardRes, historyRes] = await Promise.all([
        orbitFetch(`/api/cards/${card.id}`, {}, identity),
        orbitFetch(`/api/cards/${card.id}/history`, {}, identity),
      ]);
      if (cardRes.ok) {
        const cd = await cardRes.json();
        setCard(cd.card);
      }
      if (historyRes.ok) {
        const hd = await historyRes.json();
        setHistory(hd.history || []);
      }
    } catch (e: any) {
      toast?.(e?.message || 'Cashout error', 'error');
    } finally {
      setCashingOut(false);
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
        <div className="bg-surface-canvas border border-zinc-800 rounded-lg p-8 max-w-2xl w-full mx-4">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-surface-elevated rounded w-3/4"></div>
            <div className="h-64 bg-surface-elevated rounded"></div>
            <div className="space-y-2">
              <div className="h-4 bg-surface-elevated rounded"></div>
              <div className="h-4 bg-surface-elevated rounded w-5/6"></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !card) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
        <div className="bg-surface-canvas border border-zinc-800 rounded-lg p-8 max-w-2xl w-full mx-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-retro-fg">Card Details</h2>
            <button
              onClick={onClose}
              className="text-retro-muted hover:text-retro-body transition-colors"
            >
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 overflow-y-auto">
      <div className="bg-surface-canvas border border-zinc-800 rounded-lg max-w-4xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-zinc-800">
          <div>
            <h2 className="text-2xl font-bold text-retro-fg">
              {card.name || 'Unnamed Card'}
            </h2>
            <p className="text-sm text-retro-muted mt-1">
              Created {formatDate(card.createdAt)}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-retro-muted hover:text-retro-body transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 overflow-y-auto max-h-[70vh] pr-2">
          {/* Card Image */}
          {card.contentUrl && (
            <div className="flex justify-center">
              <div className="max-w-md w-full">
                {card.mimeType?.startsWith('video/') ? (
                  <video
                    src={card.contentUrl}
                    controls
                    className="w-full rounded-lg border border-zinc-700"
                  />
                ) : (
                  <img
                    src={card.contentUrl}
                    alt={card.name || 'Card'}
                    className="w-full rounded-lg border border-zinc-700"
                  />
                )}
              </div>
            </div>
          )}

          {/* Metadata Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-surface-elevated/50 rounded-lg p-4">
              <div className="flex items-center gap-2 text-retro-muted text-sm mb-1">
                <Tag className="w-4 h-4" />
                Rarity
              </div>
              <div className="text-lg font-bold text-retro-fg capitalize">
                {card.rarity}
              </div>
            </div>

            <div className="bg-surface-elevated/50 rounded-lg p-4">
              <div className="flex items-center gap-2 text-retro-muted text-sm mb-1">
                <TrendingUp className="w-4 h-4" />
                Value
              </div>
              <div className="text-lg font-bold text-retro-fg">
                {formatGc(card.value ?? 0)}
              </div>
            </div>

            <div className="bg-surface-elevated/50 rounded-lg p-4">
              <div className="flex items-center gap-2 text-retro-muted text-sm mb-1">
                <Heart className="w-4 h-4" />
                Likes
              </div>
              <div className="text-lg font-bold text-retro-fg">
                {card.likeCount}
              </div>
            </div>

            <div className="bg-surface-elevated/50 rounded-lg p-4">
              <div className="flex items-center gap-2 text-retro-muted text-sm mb-1">
                <Clock className="w-4 h-4" />
                Status
              </div>
              <div className="text-lg font-bold text-retro-fg capitalize">
                {card.marketStatus === 'none' ? 'Not Listed' : card.marketStatus === 'cashed_out' ? 'Cashed Out' : card.marketStatus}
              </div>
            </div>
          </div>

          {/* Ownership Info */}
          <div className="bg-surface-elevated/50 rounded-lg p-4">
            <div className="flex items-center gap-2 text-retro-muted text-sm mb-2">
              <User className="w-4 h-4" />
              Ownership
            </div>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between items-center gap-3">
                <span className="text-retro-muted">Creator:</span>
                {onOpenProfile ? (
                  <button
                    type="button"
                    onClick={() => onOpenProfile(card.creatorId)}
                    title="View creator's profile"
                    className="text-retro-body font-mono text-xs hover:text-retro-fg hover:underline cursor-pointer"
                  >
                    {card.creatorId.slice(0, 8)}...{card.creatorId.slice(-4)}
                  </button>
                ) : (
                  <span className="text-retro-body font-mono text-xs">
                    {card.creatorId.slice(0, 8)}...{card.creatorId.slice(-4)}
                  </span>
                )}
              </div>
              <div className="flex justify-between items-center gap-3">
                <span className="text-retro-muted">Current Owner:</span>
                {onOpenProfile ? (
                  <button
                    type="button"
                    onClick={() => onOpenProfile(card.ownerId)}
                    title="View owner's profile"
                    className="text-retro-body font-mono text-xs hover:text-retro-fg hover:underline cursor-pointer"
                  >
                    {card.ownerId.slice(0, 8)}...{card.ownerId.slice(-4)}
                  </button>
                ) : (
                  <span className="text-retro-body font-mono text-xs">
                    {card.ownerId.slice(0, 8)}...{card.ownerId.slice(-4)}
                  </span>
                )}
              </div>
              {identity?.orbitId === card.ownerId && (
                <div className="mt-2 text-xs text-green-400 font-semibold">
                  ✓ You own this card
                </div>
              )}
            </div>
          </div>

          {/* Caption */}
          {card.caption && (
            <div className="bg-surface-elevated/50 rounded-lg p-4">
              <div className="text-retro-muted text-sm mb-2">Caption</div>
              <p className="text-retro-body">{card.caption}</p>
            </div>
          )}

          {/* Description & Tags */}
          {(card.description || (card.tags && card.tags.length > 0)) && (
            <div className="bg-surface-elevated/50 rounded-lg p-4">
              {card.description && (
                <>
                  <div className="text-retro-muted text-sm mb-2">Description</div>
                  <p className="text-retro-body mb-3">{card.description}</p>
                </>
              )}
              {card.tags && card.tags.length > 0 && (
                <>
                  <div className="text-retro-muted text-sm mb-2">Tags</div>
                  <div className="flex flex-wrap gap-1.5">
                    {card.tags.map((tag) => (
                      <span
                        key={tag}
                        className="text-[10px] rounded-full border px-2 py-1"
                        style={{ borderColor: `${card.accentColor || '#9FE3FF'}88`, color: card.accentColor || '#9FE3FF' }}
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* History Timeline */}
          {history.length > 0 && (
            <div className="bg-surface-elevated/50 rounded-lg p-4">
              <div className="flex items-center justify-between gap-2 text-retro-muted text-sm mb-4">
                <div className="flex items-center gap-2">
                  <History className="w-4 h-4" />
                  Ownership History
                </div>
                <button
                  type="button"
                  onClick={() => setHistoryOpen(!historyOpen)}
                  className="flex items-center gap-1 text-xs text-retro-muted hover:text-retro-fg transition-colors px-2 py-1 rounded"
                  aria-label={historyOpen ? 'Collapse history' : 'Expand history'}
                >
                  {historyOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  <span className="hidden sm:inline">{historyOpen ? 'Hide' : `Show (${history.length})`}</span>
                </button>
              </div>
              {historyOpen && (
                <div className="space-y-3">
                  {history.map((entry) => (
                    <div key={entry.id} className="flex gap-3 pb-3 border-b border-zinc-700 last:border-0">
                      <div className="flex-shrink-0 w-2 h-2 rounded-full bg-zinc-600 mt-2"></div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`font-semibold ${getEventColor(entry.event)}`}>
                            {getEventLabel(entry.event)}
                          </span>
                          <span className="text-xs text-retro-muted">
                            {formatDate(entry.createdAt)}
                          </span>
                        </div>
                        {entry.fromUser && (
                          <div className="text-xs text-retro-muted mt-1">
                            From: <span className="font-mono">{entry.fromUser.slice(0, 8)}...</span>
                          </div>
                        )}
                        {entry.toUser && (
                          <div className="text-xs text-retro-muted">
                            To: <span className="font-mono">{entry.toUser.slice(0, 8)}...</span>
                          </div>
                        )}
                        {entry.meta && typeof entry.meta === 'object' && Object.keys(entry.meta).length > 0 && (
                          <div className="text-xs text-retro-muted mt-1">
                            Details: {JSON.stringify(entry.meta)}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          {identity?.orbitId === card.ownerId && (
            <div className="space-y-3 pt-4 border-t border-zinc-800">
              {card.marketStatus === 'cashed_out' ? (
                <div className="text-xs text-amber-400 font-semibold flex items-center gap-2">
                  <Coins className="w-4 h-4" />
                  This card was cashed out for g$.
                </div>
              ) : (
                <>
                  <div className="flex gap-3">
                    {card.marketStatus === 'none' && (
                      <button
                        onClick={() => {
                          toast?.('List for sale feature coming soon', 'info');
                        }}
                        className="flex-1 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 font-semibold py-2 px-4 rounded-lg transition-colors"
                      >
                        List for Sale
                      </button>
                    )}
                    {card.marketStatus === 'listed' && (
                      <button
                        onClick={() => {
                          toast?.('Cancel listing feature coming soon', 'info');
                        }}
                        className="flex-1 bg-red-500/20 hover:bg-red-500/30 text-red-300 font-semibold py-2 px-4 rounded-lg transition-colors"
                      >
                        Cancel Listing
                      </button>
                    )}
                    <button
                      onClick={() => {
                        toast?.('Transfer feature coming soon', 'info');
                      }}
                      className="flex-1 bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 font-semibold py-2 px-4 rounded-lg transition-colors"
                    >
                      Transfer
                    </button>
                  </div>

                  {card.marketStatus === 'none' && (
                    <div className="bg-surface-elevated/50 rounded-lg p-4 border border-amber-500/20">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm">
                          <div className="text-retro-muted text-xs mb-0.5">Cash out value</div>
                          <div className="font-bold text-retro-fg">
                            {formatGc(computeCashoutPayout(card.value ?? 0, cashoutRate))}
                            <span className="ml-2 text-[10px] text-amber-400 font-mono">
                              ({(cashoutRate / 100).toFixed(1)}% rate)
                            </span>
                          </div>
                        </div>
                        {confirmCashout ? (
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              disabled={cashingOut}
                              onClick={handleCashOut}
                              className="bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-black font-bold py-2 px-3 rounded-lg text-xs transition-colors"
                            >
                              {cashingOut ? 'Cashing out…' : 'Confirm'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmCashout(false)}
                              className="text-retro-muted hover:text-retro-body text-xs px-2 py-1"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmCashout(true)}
                            className="bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 font-bold py-2 px-4 rounded-lg text-xs transition-colors flex items-center gap-1.5"
                          >
                            <Coins className="w-3.5 h-3.5" />
                            Cash Out Card
                          </button>
                        )}
                      </div>
                      <p className="text-[10px] text-retro-muted mt-2">
                        Cashing out burns this card from your collection in exchange for g$.
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
