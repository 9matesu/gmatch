-- Persistent bot duelist profiles. Unlike the ephemeral bot pool derived from
-- the `bot_names` SystemMeta list, each row is an independently editable bot
-- identity (name, tags, picture) that admins manage via /api/admin/bots.
-- The `bot_names` config remains a fallback for fresh databases that have not
-- been seeded yet.

CREATE TABLE IF NOT EXISTS Bots (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',      -- JSON array of booru search tags
  pfp_url TEXT,                          -- picture resolved from the bot's tags
  color TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bots_enabled ON Bots(enabled, sort_order);