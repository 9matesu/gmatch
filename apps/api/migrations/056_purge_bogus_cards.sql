-- 056: Purge bug-generated cards (auto-mint cleanup).
--
--   Removes cards the user never minted through POST /api/cards:
--   - residue of the retired auto-mint (035 part 3 + backfillFromObjects),
--     including chat/avatar mints those paths never excluded;
--   - nameless cards (NULL, empty, or whitespace-only);
--   - cards whose backing media is a post, story, chat attachment, or avatar.
--   Backing Objects rows are untouched (posts/stories/DMs stay intact).
--   Cards adopted on the market (purchased/transferred/cashed_out history)
--   are never deleted, even when otherwise eligible. Only 'active' cards are
--   purged; burned cards keep their audit trail. Idempotent and rerunnable.
--
--   The Cards delete runs FIRST: dependent-table cleanup is keyed off
--   surviving card ids, so victim detection (which reads CardHistory) cannot
--   be disturbed by an earlier dependent-table pass.

-- 1. The bogus cards themselves.
DELETE FROM Cards
WHERE moderation_state = 'active'
  AND (
    EXISTS (SELECT 1 FROM Objects o WHERE o.id = Cards.media_object_id AND (o.is_public = 1 OR o.is_story = 1 OR o.is_chat = 1 OR o.is_avatar = 1))
    OR Cards.name IS NULL OR TRIM(Cards.name) = ''
    OR (EXISTS (SELECT 1 FROM CardHistory h WHERE h.card_id = Cards.id AND h.event = 'backfilled')
      AND NOT EXISTS (SELECT 1 FROM CardHistory h2 WHERE h2.card_id = Cards.id AND h2.event IN ('created', 'listed', 'delisted')))
  )
  AND NOT EXISTS (SELECT 1 FROM CardHistory h3 WHERE h3.card_id = Cards.id AND h3.event IN ('purchased', 'transferred', 'cashed_out'));

-- 2. Dangling references left by the purge (or earlier partial cleanups).
DELETE FROM DeckCards WHERE card_id NOT IN (SELECT id FROM Cards);
DELETE FROM MarketListings WHERE card_id NOT IN (SELECT id FROM Cards);
DELETE FROM CardOwnership WHERE card_id NOT IN (SELECT id FROM Cards);
DELETE FROM CardHistory WHERE card_id NOT IN (SELECT id FROM Cards);
