import { describe, it, expect } from 'vitest';
import {
  computeCardRarity,
  checkRarityPromotion,
  computeDeckValuation,
  calculateDiscoveryReward,
  VOTE_POINTS,
} from './card-valuation';

describe('Card Valuation & Dynamic Rarity Engine', () => {
  it('computes 5 dynamic rarity tiers correctly according to thresholds', () => {
    expect(computeCardRarity(0).rarity).toBe('common');
    expect(computeCardRarity(99).rarity).toBe('common');
    expect(computeCardRarity(100).rarity).toBe('copper');
    expect(computeCardRarity(499).rarity).toBe('copper');
    expect(computeCardRarity(500).rarity).toBe('silver');
    expect(computeCardRarity(1499).rarity).toBe('silver');
    expect(computeCardRarity(1500).rarity).toBe('gold');
    expect(computeCardRarity(4999).rarity).toBe('gold');
    expect(computeCardRarity(5000).rarity).toBe('diamond');
    expect(computeCardRarity(25000).rarity).toBe('diamond');
  });

  it('detects rarity promotions accurately', () => {
    expect(checkRarityPromotion(95, 105).promoted).toBe(true);
    expect(checkRarityPromotion(95, 105).oldRarity).toBe('common');
    expect(checkRarityPromotion(95, 105).newRarity).toBe('copper');

    expect(checkRarityPromotion(490, 515).promoted).toBe(true);
    expect(checkRarityPromotion(490, 515).oldRarity).toBe('copper');
    expect(checkRarityPromotion(490, 515).newRarity).toBe('silver');

    expect(checkRarityPromotion(1490, 1515).promoted).toBe(true);
    expect(checkRarityPromotion(1490, 1515).newRarity).toBe('gold');

    expect(checkRarityPromotion(4980, 5005).promoted).toBe(true);
    expect(checkRarityPromotion(4980, 5005).newRarity).toBe('diamond');

    // No promotion within same tier
    expect(checkRarityPromotion(100, 200).promoted).toBe(false);
    // Demotions are not promotions
    expect(checkRarityPromotion(520, 480).promoted).toBe(false);
  });

  it('computes deck portfolio aggregates', () => {
    const deck = [
      { id: 'c1', score: 50 },
      { id: 'c2', score: 250 },
      { id: 'c3', score: 1200 },
      { id: 'c4', score: 3000 },
      { id: 'c5', score: 7500 },
    ];

    const portfolio = computeDeckValuation(deck);
    expect(portfolio.totalCards).toBe(5);
    expect(portfolio.totalValue).toBe(12000);
    expect(portfolio.averageValue).toBe(2400);
    expect(portfolio.highestValueCard?.id).toBe('c5');
    expect(portfolio.highestValueCard?.rarity).toBe('diamond');
    expect(portfolio.lowestValueCard?.id).toBe('c1');
    expect(portfolio.lowestValueCard?.rarity).toBe('common');
    expect(portfolio.rarityDistribution).toEqual({
      common: 1,
      copper: 1,
      silver: 1,
      gold: 1,
      diamond: 1,
    });
  });

  it('awards higher discovery influence for conviction boost votes', () => {
    expect(calculateDiscoveryReward(VOTE_POINTS.boost, 'boost')).toBe(20);
    expect(calculateDiscoveryReward(VOTE_POINTS.like, 'like')).toBe(3);
    expect(calculateDiscoveryReward(VOTE_POINTS.reject, 'reject')).toBe(0);
  });
});
