-- Migration 049: durable post archiving.
-- Client-only archive state (a memory Set) meant an archived post reappeared
-- on every reload for the author AND never hid from strangers. Column lives
-- in schema.sql for fresh DBs; this upgrades existing snapshots.
ALTER TABLE Objects ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0;
