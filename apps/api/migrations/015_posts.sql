-- gMatch posts: public-by-default content flag and denormalized engagement
-- counters (like / comment / share). Posts reuse the existing Objects table —
-- a "post" is an Objects row with is_public=1 — so the entire blob storage,
-- signed-URL fetcher, magic-byte validation, content-hash dedup, and the
-- existing proxy pipeline get reused unchanged. The denormalized count
-- columns are kept by app code on each like/comment/share and are also used
-- for feed-related ranking queries.</p>

ALTER TABLE Objects ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0;
ALTER TABLE Objects ADD COLUMN post_caption TEXT;
ALTER TABLE Objects ADD COLUMN location TEXT;
ALTER TABLE Objects ADD COLUMN shared_from TEXT;
ALTER TABLE Objects ADD COLUMN like_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE Objects ADD COLUMN comment_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE Objects ADD COLUMN share_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_objects_public_feed ON Objects(is_public, created_at);
CREATE INDEX IF NOT EXISTS idx_objects_trending ON Objects(is_public, like_count, comment_count, created_at);
CREATE INDEX IF NOT EXISTS idx_objects_shared_from ON Objects(shared_from);
