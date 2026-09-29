-- 057: Purge cards backed by chat/post/story/avatar media, including
--     market-adopted ones.
--
-- 056 already removed cards whose backing media was a post, story, chat
-- attachment or avatar — but it EXEMPTED any card with a purchase, transfer or
-- cashout in its history, so a card adopted on the market from chat-backed
-- media survived and kept rendering in the new owner's collection. The creation
-- guard in cards.ts has since been extended to the read path, but the rows were
-- already there.
--
-- This removes them too. Backing Objects rows are untouched: the chat messages
-- and DMs that reference them stay intact and readable. DeckCards /
-- MarketListings / CardOwnership / CardHistory rows keyed to a surviving card
-- id are kept; only the survivors' own dangling references are swept.
--
-- Idempotent and rerunnable. Safe to run before or after 056.

-- 1. The chat-backed cards themselves. Unlike 056 there is no history
--    exemption: these were never legitimately mintable, so holding one on the
--    market is not a reason to keep it.
DELETE FROM Cards
WHERE EXISTS (
  SELECT 1 FROM Objects o
  WHERE o.id = Cards.media_object_id
    AND (COALESCE(o.is_chat, 0) = 1
      OR COALESCE(o.is_public, 0) = 1
      OR COALESCE(o.is_story, 0) = 1
      OR COALESCE(o.is_avatar, 0) = 1)
);

-- 2. Dangling references left by the purge (or by an earlier partial cleanup).
--    Reuses 056's step 2 verbatim so both migrations converge on the same shape.
DELETE FROM DeckCards WHERE card_id NOT IN (SELECT id FROM Cards);
DELETE FROM MarketListings WHERE card_id NOT IN (SELECT id FROM Cards);
DELETE FROM CardOwnership WHERE card_id NOT IN (SELECT id FROM Cards);
DELETE FROM CardHistory WHERE card_id NOT IN (SELECT id FROM Cards);
