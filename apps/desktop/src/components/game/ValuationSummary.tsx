"use client";

import { useMemo } from 'react';
import type { MatchSnapshot, OrbitObject } from '@orbit/shared';
import { computeCardRarity, checkRarityPromotion } from '@orbit/shared';
import { ObjectImage } from '../ObjectImage';
import { Trophy, Sparkles, Award, ArrowRight, Zap, Heart, X, Check } from 'lucide-react';

interface IdentityLike {
  orbitId: string;
  publicKeyHex: string;
  privateKeyHex: string;
}

interface CardOfTheMatch {
  id: string;
  url?: string | null;
  delta: number;
  isMine: boolean;
}

interface PromotionItem {
  id: string;
  oldRarity: string;
  newRarity: string;
}

interface MyCardDelta {
  round: number;
  cardId: string;
  cardUrl?: string | null;
  vote?: string | null;
  delta: number;
  prevScore: number;
  newScore: number;
}

interface OppCardDelta {
  round: number;
  cardId: string;
  cardUrl?: string | null;
  vote?: string | null;
  delta: number;
}

interface SummaryResult {
  myDelta: number;
  oppDelta: number;
  prevDeckValue: number;
  currentDeckValue: number;
  myCardDeltas: MyCardDelta[];
  oppCardDeltas: OppCardDelta[];
  cardOfTheMatch: CardOfTheMatch | null;
  promotions: PromotionItem[];
}

interface ValuationSummaryProps {
  match: MatchSnapshot;
  identity: IdentityLike | null;
  myCards: OrbitObject[];
  onPlayAgain?: () => void;
  onReturnToLobby: () => void;
  submitting?: boolean;
}

export function ValuationSummary({
  match,
  identity,
  myCards,
  onPlayAgain,
  onReturnToLobby,
  submitting = false,
}: ValuationSummaryProps) {
  const opponentName = match.opponent.display_name?.trim() || 'Unknown User';
  const rounds = match.rounds_history || [];

  // Calculate per-card score changes from the match
  const summary: SummaryResult = useMemo(() => {
    // Prefer the server-authoritative valuation summary when the API ships one.
    const vs = match.valuation_summary
    if (vs) {
      const myCardDeltas: MyCardDelta[] = vs.myCardDeltas.map((d) => ({
        round: rounds.findIndex((r) => r.card_a === d.cardId || r.card_b === d.cardId) + 1 || 1,
        cardId: d.cardId,
        cardUrl: d.cardUrl,
        vote: d.vote,
        delta: d.pointDelta,
        prevScore: d.previousScore,
        newScore: d.newScore,
      }))
      const oppCardDeltas: OppCardDelta[] = vs.opponentCardDeltas.map((d) => ({
        round: rounds.findIndex((r) => r.card_a === d.cardId || r.card_b === d.cardId) + 1 || 1,
        cardId: d.cardId,
        cardUrl: d.cardUrl,
        vote: d.vote,
        delta: d.pointDelta,
      }))
      const promotions: PromotionItem[] = (vs.promotions || []).map((p) => ({
        id: p.cardId,
        oldRarity: p.oldRarity,
        newRarity: p.newRarity,
      }))
      return {
        myDelta: vs.playerTotalDelta,
        oppDelta: vs.opponentTotalDelta,
        prevDeckValue: vs.playerDeckValueBefore,
        currentDeckValue: vs.playerDeckValueAfter,
        myCardDeltas,
        oppCardDeltas,
        cardOfTheMatch: vs.cardOfTheMatch
          ? { id: vs.cardOfTheMatch.cardId, url: vs.cardOfTheMatch.cardUrl, delta: vs.cardOfTheMatch.pointDelta, isMine: vs.cardOfTheMatch.ownerId === identity?.orbitId }
          : null,
        promotions,
      }
    }

    const promotions: PromotionItem[] = [];

    const myCardDeltas: MyCardDelta[] = rounds.map((r) => {
      const cardId = r.card_a === match.my_card || match.played_cards.includes(r.card_a || '') ? (r.card_a || '') : (r.card_b || '');
      const theirVote = r.card_a === cardId ? r.decision_b : r.decision_a;
      let delta = 0;
      if (theirVote === 'boost') delta = 25;
      else if (theirVote === 'like') delta = 10;
      else if (theirVote === 'reject') delta = -5;

      // Check promotion
      const cardObj = myCards.find((c) => c.id === cardId);
      const prevScore = Math.max(0, cardObj?.gacha_downloads_count ?? 0);
      const newScore = Math.max(0, prevScore + delta);
      const promo = checkRarityPromotion(prevScore, newScore);
      if (promo.promoted && promo.newRarity) {
        promotions.push({
          id: cardId,
          oldRarity: String(promo.oldRarity || 'Common'),
          newRarity: String(promo.newRarity),
        });
      }

      return {
        round: r.round,
        cardId,
        cardUrl: r.card_a === cardId ? r.card_a_url : r.card_b_url,
        vote: theirVote,
        delta,
        prevScore,
        newScore,
      };
    });
    const myDelta = myCardDeltas.reduce((acc, c) => acc + c.delta, 0);
    const cardOfTheMatch: CardOfTheMatch | null = myCardDeltas.reduce<CardOfTheMatch | null>((best, c) => {
      if (c.cardId && (!best || c.delta > best.delta)) {
        return { id: c.cardId, url: c.cardUrl, delta: c.delta, isMine: true };
      }
      return best;
    }, null);

    const oppCardDeltas: OppCardDelta[] = rounds.map((r) => {
      const cardId = r.card_a === match.my_card || match.played_cards.includes(r.card_a || '') ? (r.card_b || '') : (r.card_a || '');
      const myVote = r.card_a === match.my_card ? r.decision_a : r.decision_b;
      let delta = 0;
      if (myVote === 'boost') delta = 25;
      else if (myVote === 'like') delta = 10;
      else if (myVote === 'reject') delta = -5;

      return {
        round: r.round,
        cardId,
        cardUrl: r.card_a === match.my_card ? r.card_b_url : r.card_a_url,
        vote: myVote,
        delta,
      };
    });
    const oppDelta = oppCardDeltas.reduce((acc, c) => acc + c.delta, 0);

    // Calculate total deck value before and after
    const prevDeckValue = myCards.reduce((acc, c) => acc + (c.gacha_downloads_count ?? 0), 0);
    const currentDeckValue = Math.max(0, prevDeckValue + myDelta);

    return {
      myDelta,
      oppDelta,
      prevDeckValue,
      currentDeckValue,
      myCardDeltas,
      oppCardDeltas,
      cardOfTheMatch,
      promotions,
    };
  }, [rounds, match, myCards]);

  const spotlightCard = summary.cardOfTheMatch;

  return (
    <div className="space-y-4 animate-orbit-slide-up bg-surface-canvas/70 border border-zinc-800 rounded-xl p-4 font-sans text-retro-fg backdrop-blur-md">
      {/* Header: Social Valuation Summary banner */}
      <div className="p-4 bg-surface-canvas/60 border border-zinc-800/80 rounded-xl text-center space-y-2">
        <div className="flex items-center justify-center gap-1.5 text-xs font-bold uppercase tracking-wider text-retro-body">
          <Trophy className="w-4 h-4 text-amber-400" />
          <span>Match Valuation Complete</span>
        </div>
        <div className="text-xl font-extrabold tracking-tight flex items-center justify-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-retro-muted">Portfolio Value:</span>
          <span className="font-mono text-retro-body">{summary.prevDeckValue.toLocaleString()}</span>
          <ArrowRight className="w-4 h-4 text-retro-muted" />
          <span className="font-mono text-retro-fg">{(summary.prevDeckValue + summary.myDelta).toLocaleString()}</span>
          <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded-full border ${summary.myDelta >= 0 ? 'bg-emerald-950/40 text-emerald-300 border-emerald-500/40' : 'bg-red-950/40 text-red-300 border-red-500/40'}`}>
            {summary.myDelta >= 0 ? `+${summary.myDelta}` : summary.myDelta} PTS
          </span>
        </div>
        <div className="text-xs text-retro-muted">
          Your collection gained evaluation from <span className="text-retro-body font-semibold">{opponentName}</span>
        </div>
      </div>

      {/* Rarity Promotions Fanfare */}
      {summary.promotions.length > 0 && (
        <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-center space-y-1">
          <div className="flex items-center justify-center gap-1.5 text-xs font-bold uppercase text-amber-300 tracking-wider">
            <Sparkles className="w-4 h-4 text-amber-400" />
            <span>Rarity Promotion Unlocked</span>
          </div>
          {summary.promotions.map((p) => (
            <div key={p.id} className="text-xs font-medium text-retro-body">
              Card upgraded from <span className="uppercase text-amber-300 font-bold">{p.oldRarity}</span> to <span className="uppercase text-amber-400 font-extrabold">{p.newRarity}</span>
            </div>
          ))}
        </div>
      )}

      {/* Card of the Match Spotlight */}
      {spotlightCard && spotlightCard.delta > 0 && (
        <div className="flex items-center gap-3 p-3 bg-surface-canvas/50 border border-zinc-800 rounded-xl">
          <div className="w-14 h-14 rounded-lg border border-zinc-700 overflow-hidden shrink-0 bg-black">
            <ObjectImage
              contentUrl={spotlightCard.url}
              objectId={spotlightCard.id}
              identity={identity}
              className="w-full h-full object-cover"
            />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-amber-400">
              <Award className="w-3.5 h-3.5" />
              <span>Card of the Match</span>
            </div>
            <div className="text-xs font-bold text-retro-fg truncate mt-0.5">
              {spotlightCard.isMine ? 'Your Card' : `${opponentName}'s Card`}
            </div>
            <div className="text-[11px] text-emerald-400 font-mono font-bold">
              +{spotlightCard.delta} Points Gain
            </div>
          </div>
        </div>
      )}

      {/* Per-Round Valuation Breakdown */}
      <div className="space-y-2">
        <div className="text-[10px] font-bold uppercase tracking-wider text-retro-muted flex justify-between px-1">
          <span>Card Valuation Breakdown</span>
          <span>{rounds.length} Rounds Played</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {/* My Played Cards */}
          <div className="p-3 bg-surface-canvas/50 border border-zinc-800/80 rounded-xl space-y-2">
            <div className="text-xs font-bold text-retro-body border-b border-zinc-800 pb-1.5">
              Your Cards Valuation:
            </div>
            {summary.myCardDeltas.map((c) => {
              const rarity = computeCardRarity(c.newScore);
              return (
                <div key={c.round} className="flex items-center justify-between text-xs py-0.5">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-retro-muted text-[11px]">R{c.round}:</span>
                    <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold uppercase ${rarity.badgeClass}`}>{rarity.label}</span>
                    <span className="text-retro-muted text-[11px] flex items-center gap-1">
                      {c.vote === 'boost' ? <><Zap className="w-3 h-3 text-amber-400" /> Boosted</> : c.vote === 'like' ? <><Heart className="w-3 h-3 text-amber-400 fill-rose-400" /> Liked</> : <><X className="w-3 h-3 text-retro-muted" /> Rejected</>}
                    </span>
                  </div>
                  <span className={`font-mono font-bold text-xs ${c.delta >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {c.delta >= 0 ? `+${c.delta}` : c.delta}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Opponent Cards */}
          <div className="p-3 bg-surface-canvas/50 border border-zinc-800/80 rounded-xl space-y-2">
            <div className="text-xs font-bold text-retro-muted border-b border-zinc-800 pb-1.5">
              {opponentName}&apos;s Cards:
            </div>
            {summary.oppCardDeltas.map((c) => (
              <div key={c.round} className="flex items-center justify-between text-xs py-0.5">
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-retro-muted text-[11px]">R{c.round}:</span>
                  <span className="text-retro-muted text-[11px] flex items-center gap-1">
                    {c.vote === 'boost' ? <><Zap className="w-3 h-3 text-amber-400" /> You Boosted</> : c.vote === 'like' ? <><Heart className="w-3 h-3 text-amber-400 fill-rose-400" /> You Liked</> : <><X className="w-3 h-3 text-retro-muted" /> You Rejected</>}
                  </span>
                </div>
                <span className={`font-mono font-bold text-xs ${c.delta >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {c.delta >= 0 ? `+${c.delta}` : c.delta}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="pt-2 flex flex-col sm:flex-row gap-2">
        <button
          type="button"
          onClick={onReturnToLobby}
          disabled={submitting}
          className="flex-1 py-2.5 text-xs font-semibold uppercase tracking-wider bg-surface-canvas hover:bg-surface-elevated text-retro-body border border-zinc-700 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
        >
          Return to Lobby
        </button>
        {onPlayAgain && (
          <button
            type="button"
            onClick={onPlayAgain}
            disabled={submitting}
            className="flex-1 py-2.5 text-xs font-bold uppercase tracking-wider bg-surface-interactive text-retro-fg hover:bg-white/15 rounded-lg transition-colors cursor-pointer disabled:opacity-50 shadow-md"
          >
            Play Next Duel
          </button>
        )}
      </div>
    </div>
  );
}
