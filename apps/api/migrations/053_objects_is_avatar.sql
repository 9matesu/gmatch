-- Migration 053: Profile picture (avatar) isolation
-- Mark objects uploaded as avatars/profile photos so they are separated
-- from the player's collectible card collection and excluded from inbox.

ALTER TABLE Objects ADD COLUMN is_avatar INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_objects_is_avatar ON Objects(is_avatar);
