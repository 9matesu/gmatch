-- goonMatch post engagement: a generalized comment ledger (reusable across any
-- Object/Posts row, not just lobby board images), per-comment likes (IG-style
-- heart on a reply), and the per-user bookmark Saves table. The existing
-- LobbyComments table is intentionally preserved untouched so the lobby image
-- board keeps its independent ledger during the goonMatch pivot.</p>

CREATE TABLE IF NOT EXISTS Comments (
  id TEXT PRIMARY KEY,
  object_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  parent_comment_id TEXT,
  body TEXT NOT NULL,
  like_count INTEGER NOT NULL DEFAULT 0,
  hidden_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_comments_object ON Comments(object_id, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON Comments(parent_comment_id);
CREATE INDEX IF NOT EXISTS idx_comments_author ON Comments(author_id, created_at);

CREATE TABLE IF NOT EXISTS CommentLikes (
  comment_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(comment_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_comment_likes_comment ON CommentLikes(comment_id);

CREATE TABLE IF NOT EXISTS Saves (
  user_id TEXT NOT NULL,
  object_id TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, object_id)
);
CREATE INDEX IF NOT EXISTS idx_saves_user ON Saves(user_id, created_at);
