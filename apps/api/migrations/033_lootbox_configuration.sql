-- Lootbox configuration v2: a richer lifecycle `state`, custom `tags`, and
-- `draw_config` for customization, plus versioning for released boxes.
--
-- The legacy boolean `released` column stays in place (and stays in sync with
-- `state`) so existing store/open endpoints keep working. Deletion is replaced
-- by archival so players' purchased inventory remains openable.

ALTER TABLE Lootboxes ADD COLUMN state TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE Lootboxes ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
ALTER TABLE Lootboxes ADD COLUMN draw_config TEXT NOT NULL DEFAULT '{}';
ALTER TABLE Lootboxes ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE Lootboxes ADD COLUMN released_at DATETIME;
ALTER TABLE Lootboxes ADD COLUMN archived_at DATETIME;
ALTER TABLE Lootboxes ADD COLUMN created_by TEXT;
ALTER TABLE Lootboxes ADD COLUMN updated_by TEXT;

CREATE INDEX IF NOT EXISTS idx_lootboxes_state ON Lootboxes(state, created_at);

-- Backfill the new `state` from the legacy flag so already-released boxes keep
-- appearing in the store.
UPDATE Lootboxes SET state = 'released', released_at = COALESCE(updated_at, created_at) WHERE released = 1 AND state = 'draft';
