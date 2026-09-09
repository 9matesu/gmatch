-- gMatch post likes: Instagram-style single tap like on a public post.
-- Kept separate from the matchmaking Likes table (like/reject/pass decisions)
-- so feed engagement never collides with duel decision bookkeeping. The
-- denormalized Objects.like_count is kept in sync by app code.

CREATE TABLE IF NOT EXISTS PostLikes (
  object_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(object_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_post_likes_object ON PostLikes(object_id, created_at);
CREATE INDEX IF NOT EXISTS idx_post_likes_user ON PostLikes(user_id, created_at);

-- Public posts carry a tag list (comma/newline separated) for feed discovery.
ALTER TABLE Objects ADD COLUMN post_tags TEXT;
