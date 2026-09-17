-- Migration 054: host-authored server tags. Display-only metadata for the
-- server browser (chips + search); never fed to booru tag queries.
ALTER TABLE ServerDirectory ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
