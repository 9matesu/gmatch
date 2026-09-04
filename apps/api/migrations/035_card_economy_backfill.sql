-- 035: Bring legacy players/content into the card economy.
--
--   1. Historical likes -> valuation: recompute each object's vote-derived
--      score from the Likes table (VOTE_POINTS: boost +25, like +10,
--      reject -5) and take the MAX with the current value so we never
--      decrease it. Likes placed before the valuation system are now counted;
--      votes already in the column (and download/gacha bumps) are preserved.
--   2. Mirror the recomputed score + like count onto canonical cards so
--      cashout/marketplace/rarity all reflect historical engagement.
--   3. Auto-mint canonical cards for legacy non-public objects (same
--      eligibility as CardService.backfillFromObjects). Public posts and
--      stories stay excluded. Idempotent via NOT EXISTS guards.

-- 1. Vote-derived valuation for every object (monotonic, rerunnable).
UPDATE Objects SET gacha_downloads_count = MAX(
  COALESCE(gacha_downloads_count, 0),
  COALESCE((
    SELECT SUM(CASE l.decision
      WHEN 'boost' THEN 25
      WHEN 'like' THEN 10
      WHEN 'reject' THEN -5
      ELSE 0 END)
    FROM Likes l WHERE l.object_id = Objects.id
  ), 0)
);

-- 2. Mirror recomputed valuation + like counts onto canonical cards.
UPDATE Cards SET
  value = COALESCE((SELECT gacha_downloads_count FROM Objects o WHERE o.id = Cards.media_object_id), 0),
  like_count = COALESCE((SELECT COUNT(*) FROM Likes WHERE Likes.object_id = Cards.media_object_id AND Likes.decision = 'like'), 0),
  updated_at = CURRENT_TIMESTAMP;

-- 3. Auto-card legacy non-public objects (non-story, non-public, no sender,
--    not p2p-imported, not already carded).
INSERT INTO Cards (id, creator_id, media_object_id, name, rarity, value, like_count, market_status, moderation_state, created_at, updated_at)
SELECT
  lower(hex(randomblob(16))),
  o.owner_id,
  o.id,
  CASE WHEN o.caption IS NOT NULL THEN substr(o.caption, 1, 80) ELSE NULL END,
  'common',
  COALESCE(o.gacha_downloads_count, 0),
  (SELECT COUNT(*) FROM Likes WHERE Likes.object_id = o.id AND Likes.decision = 'like'),
  'none',
  'active',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM Objects o
WHERE o.is_story = 0
  AND o.is_public = 0
  AND o.id NOT LIKE 'p2p-obj-%'
  AND o.sender_id IS NULL
  AND o.owner_id IS NOT NULL
  AND (o.content_url IS NOT NULL OR o.mime_type IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM Cards c WHERE c.media_object_id = o.id);

-- 3a. Ownership rows for the freshly minted cards.
INSERT INTO CardOwnership (card_id, owner_id, acquired_at)
SELECT c.id, c.creator_id, CURRENT_TIMESTAMP
FROM Cards c
WHERE NOT EXISTS (SELECT 1 FROM CardOwnership co WHERE co.card_id = c.id);

-- 3b. Backfill history rows, only for cards that have no history yet so
--     upload-created and admin-backfilled cards are left untouched.
INSERT INTO CardHistory (id, card_id, event, from_user, to_user, meta, created_at)
SELECT lower(hex(randomblob(16))), c.id, 'backfilled', NULL, c.creator_id,
       json_object('source', 'backfill_v1'), CURRENT_TIMESTAMP
FROM Cards c
WHERE NOT EXISTS (SELECT 1 FROM CardHistory h WHERE h.card_id = c.id);