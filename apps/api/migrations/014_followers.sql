-- gMatch followers: asymmetric follow graph (Instagram-style). Unlike the
-- existing Friends table which is a symmetric bidirectional accepted pair, a
-- Follow is one-directional: follower_id subscribed to followee_id's posts.
-- `accepted` is 1 for public follows; for private accounts (Users.is_private)
-- it starts at 0 (pending) and the followee approves it via the request
-- inbox. Self-follows are rejected in app code.

CREATE TABLE IF NOT EXISTS Followers (
  follower_id TEXT NOT NULL,
  followee_id TEXT NOT NULL,
  accepted INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(follower_id, followee_id)
);
CREATE INDEX IF NOT EXISTS idx_followers_followee ON Followers(followee_id, accepted, created_at);
CREATE INDEX IF NOT EXISTS idx_followers_follower ON Followers(follower_id, accepted, created_at);

ALTER TABLE Users ADD COLUMN is_private INTEGER NOT NULL DEFAULT 0;
