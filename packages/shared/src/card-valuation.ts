export type CardRarity = 'common' | 'copper' | 'silver' | 'gold' | 'diamond';

export type CardVoteAction = 'like' | 'reject' | 'boost';

export interface CardRarityDetails {
  rarity: CardRarity;
  label: string;
  minScore: number;
  maxScore: number;
  borderClass: string;
  badgeClass: string;
  glowColor: string;
  accentColor: string;
}

export const RARITY_TIERS: Record<CardRarity, CardRarityDetails> = {
  common: {
    rarity: 'common',
    label: 'Common',
    minScore: 0,
    maxScore: 99,
    borderClass: 'border-zinc-700 bg-zinc-900/50',
    badgeClass: 'bg-zinc-800 text-zinc-300 border-zinc-700',
    glowColor: 'rgba(113, 113, 122, 0.2)',
    accentColor: '#71717a',
  },
  copper: {
    rarity: 'copper',
    label: 'Copper',
    minScore: 100,
    maxScore: 499,
    borderClass: 'border-amber-700/80 bg-amber-950/20',
    badgeClass: 'bg-amber-900/80 text-amber-200 border-amber-700',
    glowColor: 'rgba(180, 83, 9, 0.3)',
    accentColor: '#b45309',
  },
  silver: {
    rarity: 'silver',
    label: 'Silver',
    minScore: 500,
    maxScore: 1499,
    borderClass: 'border-slate-300 bg-slate-900/40 shadow-[0_0_8px_rgba(203,213,225,0.25)]',
    badgeClass: 'bg-slate-300 text-slate-900 border-slate-400 font-black',
    glowColor: 'rgba(203, 213, 225, 0.4)',
    accentColor: '#cbd5e1',
  },
  gold: {
    rarity: 'gold',
    label: 'Gold',
    minScore: 1500,
    maxScore: 4999,
    borderClass: 'border-yellow-400 bg-yellow-950/30 shadow-[0_0_12px_rgba(250,204,21,0.35)]',
    badgeClass: 'bg-yellow-400 text-black border-yellow-300 font-black',
    glowColor: 'rgba(250, 204, 21, 0.5)',
    accentColor: '#facc15',
  },
  diamond: {
    rarity: 'diamond',
    label: 'Diamond',
    minScore: 5000,
    maxScore: Infinity,
    borderClass: 'border-cyan-300 bg-cyan-950/30 shadow-[0_0_20px_rgba(103,232,249,0.5)] animate-pulse',
    badgeClass: 'bg-gradient-to-r from-cyan-400 via-sky-300 to-indigo-400 text-black border-cyan-200 font-black',
    glowColor: 'rgba(103, 232, 249, 0.7)',
    accentColor: '#67e8f9',
  },
};

export const VOTE_POINTS: Record<CardVoteAction, number> = {
  like: 10,
  reject: -5,
  boost: 25,
};

export const DEFAULT_BOOST_CHARGES = 1;

/**
 * Determine dynamic card rarity based on persistent reputation score.
 */
export function computeCardRarity(score: number | undefined | null): CardRarityDetails {
  const s = Math.max(0, Math.floor(score ?? 0));
  if (s >= 5000) return RARITY_TIERS.diamond;
  if (s >= 1500) return RARITY_TIERS.gold;
  if (s >= 500) return RARITY_TIERS.silver;
  if (s >= 100) return RARITY_TIERS.copper;
  return RARITY_TIERS.common;
}

/**
 * Check if adding delta points crosses a rarity threshold.
 */
export function checkRarityPromotion(
  oldScore: number,
  newScore: number
): { promoted: boolean; oldRarity: CardRarity; newRarity: CardRarity } {
  const oldRarity = computeCardRarity(oldScore).rarity;
  const newRarity = computeCardRarity(newScore).rarity;
  const order: CardRarity[] = ['common', 'copper', 'silver', 'gold', 'diamond'];
  const oldIdx = order.indexOf(oldRarity);
  const newIdx = order.indexOf(newRarity);
  return {
    promoted: newIdx > oldIdx,
    oldRarity,
    newRarity,
  };
}

export interface DeckPortfolioCard {
  id: string;
  score: number;
  rarity: CardRarity;
  content_url?: string | null;
  caption?: string | null;
}

export interface DeckPortfolio {
  totalCards: number;
  totalValue: number;
  averageValue: number;
  highestValueCard: DeckPortfolioCard | null;
  lowestValueCard: DeckPortfolioCard | null;
  rarityDistribution: Record<CardRarity, number>;
}

/**
 * Calculate aggregate portfolio valuation metrics for a deck of cards.
 */
export function computeDeckValuation(cards: Array<{ id: string; score?: number; gacha_downloads_count?: number; content_url?: string | null; caption?: string | null }>): DeckPortfolio {
  const dist: Record<CardRarity, number> = {
    common: 0,
    copper: 0,
    silver: 0,
    gold: 0,
    diamond: 0,
  };

  if (!cards || cards.length === 0) {
    return {
      totalCards: 0,
      totalValue: 0,
      averageValue: 0,
      highestValueCard: null,
      lowestValueCard: null,
      rarityDistribution: dist,
    };
  }

  let totalValue = 0;
  let highest: DeckPortfolioCard | null = null;
  let lowest: DeckPortfolioCard | null = null;

  for (const c of cards) {
    const cardScore = Math.max(0, c.score ?? c.gacha_downloads_count ?? 0);
    const rarity = computeCardRarity(cardScore).rarity;
    dist[rarity] += 1;
    totalValue += cardScore;

    const item: DeckPortfolioCard = {
      id: c.id,
      score: cardScore,
      rarity,
      content_url: c.content_url,
      caption: c.caption,
    };

    if (!highest || cardScore > highest.score) {
      highest = item;
    }
    if (!lowest || cardScore < lowest.score) {
      lowest = item;
    }
  }

  return {
    totalCards: cards.length,
    totalValue,
    averageValue: Math.round(totalValue / cards.length),
    highestValueCard: highest,
    lowestValueCard: lowest,
    rarityDistribution: dist,
  };
}

export interface CardEvaluationDelta {
  cardId: string;
  cardUrl?: string | null;
  vote: CardVoteAction | null;
  pointDelta: number;
  previousScore: number;
  newScore: number;
  promoted?: boolean;
  newRarity?: CardRarity;
}

export interface MatchValuationSummary {
  matchId: string;
  playerDeckValueBefore: number;
  playerDeckValueAfter: number;
  playerTotalDelta: number;
  opponentDeckValueBefore: number;
  opponentDeckValueAfter: number;
  opponentTotalDelta: number;
  myCardDeltas: CardEvaluationDelta[];
  opponentCardDeltas: CardEvaluationDelta[];
  cardOfTheMatch: {
    cardId: string;
    cardUrl?: string | null;
    ownerId: string;
    ownerName: string;
    pointDelta: number;
    rarity: CardRarity;
  } | null;
  discoveryInfluenceEarned: number;
  promotions: Array<{ cardId: string; oldRarity: CardRarity; newRarity: CardRarity }>;
}

/**
 * Calculates influence rewards earned by players who discover and vote/boost cards.
 */
export function calculateDiscoveryReward(
  pointDelta: number,
  action: CardVoteAction
): number {
  if (action === 'boost' && pointDelta > 0) {
    return Math.floor(pointDelta * 0.8); // High conviction discovery reward
  }
  if (action === 'like' && pointDelta > 0) {
    return Math.floor(pointDelta * 0.3); // Normal discovery reward
  }
  return 0;
}

const RARITY_RANK: Record<CardRarity, number> = { common: 1, copper: 2, silver: 3, gold: 4, diamond: 5 }

/** Card-driven tier-match economy: winning scales with BOTH cards' rarity
 * (mutual quality pays), losing pays a small consolation scaled to your own
 * card, and a boost costs against your own card's rarity. Single knob. */
export function matchEconomy(
  mineValue: number | null | undefined,
  theirsValue: number | null | undefined,
): { winGp: number; loseGp: number; boostCost: number } {
  const rank = (v: number | null | undefined) => RARITY_RANK[computeCardRarity(v).rarity]
  const rMine = rank(mineValue)
  const rTheirs = rank(theirsValue)
  return { winGp: 50 * rMine * rTheirs, loseGp: 10 * rMine, boostCost: 250 * rMine }
}
