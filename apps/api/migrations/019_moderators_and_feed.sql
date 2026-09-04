-- Migration 019: Moderators and Content Moderation

ALTER TABLE Users ADD COLUMN is_moderator INTEGER DEFAULT 0;
ALTER TABLE Objects ADD COLUMN is_sensitive INTEGER DEFAULT 0;
ALTER TABLE Objects ADD COLUMN sensitive_reason TEXT;
