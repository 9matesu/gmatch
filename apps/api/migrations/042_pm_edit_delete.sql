-- Add edited_at column to PrivateMessages for edit functionality
ALTER TABLE PrivateMessages ADD COLUMN edited_at TEXT DEFAULT NULL;