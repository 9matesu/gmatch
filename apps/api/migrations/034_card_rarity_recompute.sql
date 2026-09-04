-- Recompute persisted card rarity from canonical value so cards whose value
-- crossed a threshold (e.g. via marketplace sales) display the correct tier.
-- Thresholds mirror shared/src/card-valuation.ts RARITY_TIERS.
UPDATE Cards SET rarity = CASE
  WHEN value >= 5000 THEN 'diamond'
  WHEN value >= 1500 THEN 'gold'
  WHEN value >= 500  THEN 'silver'
  WHEN value >= 100  THEN 'copper'
  ELSE 'common'
END;
