-- Group message attachments
ALTER TABLE GroupMessages ADD COLUMN attachment_id TEXT;
CREATE INDEX IF NOT EXISTS idx_group_messages_attachment ON GroupMessages(attachment_id);