-- Image/video attachments in private messages. References an Objects row owned
-- by the sender (or a public object). Rendered client-side via /api/objects/:id.
ALTER TABLE PrivateMessages ADD COLUMN attachment_id TEXT;
CREATE INDEX IF NOT EXISTS idx_pm_attachment ON PrivateMessages(attachment_id);