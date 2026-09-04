-- Match archive: server-persisted record of every resolved 1v1 duel. When a
-- match ends (win/draw/no_match/forfeit/quit/expired/admin_ended), the full
-- result — final score, both participants, round-by-round history and outcome —
-- is copied here so it survives the GameMatches cleanup sweep (which deletes
-- rows a few seconds after the result phase). The archive powers the
-- admin-only match report / history browser; it is never exposed to players.

CREATE TABLE IF NOT EXISTS MatchArchive (
  id TEXT PRIMARY KEY,
  user_a TEXT NOT NULL,
  user_b TEXT NOT NULL,
  user_a_name TEXT,
  user_a_pfp TEXT,
  user_b_name TEXT,
  user_b_pfp TEXT,
  score_a INTEGER NOT NULL DEFAULT 0,
  score_b INTEGER NOT NULL DEFAULT 0,
  result TEXT NOT NULL,
  rounds_history TEXT,
  matched INTEGER NOT NULL DEFAULT 0,
  perfect INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  ended_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_match_archive_ended ON MatchArchive(ended_at);
CREATE INDEX IF NOT EXISTS idx_match_archive_user_a ON MatchArchive(user_a, ended_at);
CREATE INDEX IF NOT EXISTS idx_match_archive_user_b ON MatchArchive(user_b, ended_at);
CREATE INDEX IF NOT EXISTS idx_match_archive_result ON MatchArchive(result, ended_at);