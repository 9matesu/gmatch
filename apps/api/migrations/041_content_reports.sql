-- 041: Unified instant-hide report system.
--
--  1. Users.hidden_at — a reported user's profile stays hidden until the
--     report is resolved by an admin.
--  2. LobbyChat.hidden_at — lobby chat had no moderation column; reports now
--     hide individual chat messages just like every other content type.
--  3. ContentReports — single moderation queue for ALL content (posts, stories,
--     lobby images, comments, private messages, chat, cards, users), replacing
--     the legacy UserReports (users/PMs) and ReportedImages (images/posts)
--     tables. Every report hides its target instantly; admins then resolve with
--     exactly three actions: delete content, ban user + wipe all, or deny +
--     unhide. UNIQUE(reporter_id, target_type, target_id) enforces forever-
--     dedupe at the DB level so one reporter can't spam the queue for a target.

ALTER TABLE Users ADD COLUMN hidden_at DATETIME;

ALTER TABLE LobbyChat ADD COLUMN hidden_at DATETIME;

CREATE TABLE IF NOT EXISTS ContentReports (
  id TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  category TEXT,
  reason TEXT,
  object_id TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  action TEXT,
  resolved_by TEXT,
  resolved_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  hidden_at DATETIME,
  UNIQUE(reporter_id, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS idx_creports_status ON ContentReports(status, created_at);
CREATE INDEX IF NOT EXISTS idx_creports_target ON ContentReports(target_type, target_id);