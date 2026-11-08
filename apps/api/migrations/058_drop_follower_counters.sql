-- 058: Drop the denormalized follower counters from Users.
--
-- Users.followers_count / Users.following_count were a second copy of the
-- Followers table. Every follow/unfollow bumped them, every cascade delete
-- and account wipe left them stale, and NO public read path used them — the
-- profile, the roster, /me and the follow endpoints all derive
-- COUNT(*) FROM Followers.
--
-- The admin panel was the one reader: it displayed and EDITED the stale
-- column, so an admin could set a follower count that the product ignored.
-- The columns are gone; every count is a COUNT(*) over Followers.
--
-- Migration 017 added these columns, so by the time this migration runs they
-- exist (a database older than 017 has already had 017 applied above).
DROP INDEX IF EXISTS idx_users_followers_count;
ALTER TABLE Users DROP COLUMN followers_count;
ALTER TABLE Users DROP COLUMN following_count;
