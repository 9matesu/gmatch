-- Server-persisted lobby chat stream. The client keeps the P2P swarm relay for
-- real-time fan-out, but every message is also stored here so a reload (or a
-- peer that joined late) can replay recent history instead of showing an empty
-- room. Rows are capped at 12 hours by the maintenance sweep (cleanup.ts).

CREATE TABLE IF NOT EXISTS LobbyChat (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL,
  sender_name TEXT,
  body TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_lobbychat_created ON LobbyChat(created_at);