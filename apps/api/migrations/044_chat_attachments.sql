-- Migration 044: Chat attachments isolation
-- Mark objects specifically uploaded as chat attachments (DMs & group messages)
-- so they are separated from the player's collectible card collection.

ALTER TABLE Objects ADD COLUMN is_chat INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_objects_is_chat ON Objects(is_chat);
