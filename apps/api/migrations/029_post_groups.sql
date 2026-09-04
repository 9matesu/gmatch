-- Multi-image posts: all media rows published together share one grouping key,
-- so the feed can coalesce them into a single post with multiple images.
ALTER TABLE Objects ADD COLUMN post_group TEXT;
CREATE INDEX IF NOT EXISTS idx_objects_post_group ON Objects(post_group);