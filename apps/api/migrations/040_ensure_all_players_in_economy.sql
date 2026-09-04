-- 040: Bring every player into the g$ economy.
--
--   1. Backfill persistent XP (Users.score_total) for legacy rows whose
--      reputation was never populated, using the same activity-derived
--      formula the API exposes for pre-column rows (routes/users.ts). Only
--      touches rows still at 0 so actively-maintained values are never
--      clobbered. Idempotent on re-run.
--   2. Ensure every user has a wallet, seeded from their legacy XP so no old
--      player is left outside the g$ economy. INSERT OR IGNORE never
--      overwrites an existing balance.
--   3. Re-sync stale canonical card valuations (Cards.value) that lag their
--      media object's reputation score (e.g. cards minted before valuation
--      seeding). Monotonic MAX so we never decrease value.

-- 1. Backfill legacy XP (persistent reputation) from activity counters.
UPDATE Users SET
  score_total = (COALESCE(objects_sent_count, 0) * 10)
              + (COALESCE(gacha_downloads_received, 0) * 15)
              + (COALESCE(gacha_items_collected, 0) * 5)
              + (COALESCE(likes_received, 0) * 25)
              + (COALESCE(likes_given, 0) * 20)
              + (COALESCE(matches_total, 0) * 100)
WHERE score_total IS NULL OR score_total = 0;

-- 2. Every player gets a wallet seeded from their legacy XP (never overwrites
--    an existing balance).
INSERT OR IGNORE INTO Wallets (user_id, balance)
SELECT id, MAX(COALESCE(score_total, 0), COALESCE(score, 0))
FROM Users
WHERE id NOT IN (SELECT user_id FROM Wallets);

-- 3. Re-sync stale card valuations so card info shows the live g$ value.
UPDATE Cards SET
  value = MAX(value, COALESCE((SELECT gacha_downloads_count FROM Objects o WHERE o.id = Cards.media_object_id), 0)),
  updated_at = CURRENT_TIMESTAMP
WHERE value < COALESCE((SELECT gacha_downloads_count FROM Objects o WHERE o.id = Cards.media_object_id), 0);