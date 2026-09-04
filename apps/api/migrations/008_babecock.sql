-- Babecock minigame: open rounds with a host OP picture + joiner entries,
-- then a 1-hour gallery of finished rounds.

CREATE TABLE IF NOT EXISTS BabecockRounds (
  id TEXT PRIMARY KEY,
  host_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  phase_deadline INTEGER NOT NULL,
  gallery_expires_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_babecock_rounds_status ON BabecockRounds(status, phase_deadline);

CREATE TABLE IF NOT EXISTS BabecockEntries (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  content_url TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'image/jpeg',
  caption TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_babecock_entries_round ON BabecockEntries(round_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_babecock_entries_round_user ON BabecockEntries(round_id, user_id);
