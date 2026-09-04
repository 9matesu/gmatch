CREATE TABLE IF NOT EXISTS StoreUnlocks (
  user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  unlocked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_store_unlocks_user ON StoreUnlocks(user_id);
