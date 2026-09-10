-- Migration 046: central-node master admin fields on the server directory (plan §5).
-- hidden/blocked let the central master hide or blocklist an entry; master_note
-- is a private admin note; updated_at stamps moderation changes. Constant defaults
-- only (SQLite forbids non-constant defaults on ADD COLUMN).
ALTER TABLE ServerDirectory ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ServerDirectory ADD COLUMN blocked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ServerDirectory ADD COLUMN master_note TEXT;
ALTER TABLE ServerDirectory ADD COLUMN updated_at DATETIME;
