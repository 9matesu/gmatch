DROP INDEX IF EXISTS idx_babecock_entries_round_user;
CREATE INDEX IF NOT EXISTS idx_babecock_entries_round_user ON BabecockEntries(round_id, user_id);
