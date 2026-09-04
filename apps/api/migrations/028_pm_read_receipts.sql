-- Per-conversation read receipts so the sidebar/footer message badge shows a
-- true unread count (Instagram-style) instead of total received messages.
CREATE TABLE IF NOT EXISTS PmReadReceipts (
  user_id TEXT NOT NULL,
  peer_id TEXT NOT NULL,
  last_read_at DATETIME NOT NULL,
  PRIMARY KEY (user_id, peer_id)
);
