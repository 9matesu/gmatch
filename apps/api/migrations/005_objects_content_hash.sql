-- Add content_hash to dedup byte-identical image uploads per owner.
-- Stored as a lowercase SHA-256 hex digest; indexed with owner_id to
-- make the dedup lookup cheap.
ALTER TABLE Objects ADD COLUMN content_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_objects_owner_content_hash ON Objects (owner_id, content_hash);
