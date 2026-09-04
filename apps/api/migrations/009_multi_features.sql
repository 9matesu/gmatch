-- Multi-feature migration: lobby social (comments + likes audit), image/object
-- reports and auto-hide, private messages (server-stored for moderation),
-- playtime + donation acknowledgement, admin audit log, chat/PM hide flags +
-- ban scope, admin-adjustable score columns. Idempotent — safe on snapshots
-- that already have partial pieces.

-- Lobby comments: mini-social media threading on lobby board tiles.
CREATE TABLE IF NOT EXISTS LobbyComments (
  id TEXT PRIMARY KEY,
  image_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  hidden_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_lobbycomments_image ON LobbyComments(image_id, created_at);

-- Lobby likes audit + "who liked" popover. Likes_count stays the denormalised
-- counter on LobbyImages; this table is the per-user ledger.
CREATE TABLE IF NOT EXISTS LobbyLikes (
  user_id TEXT NOT NULL,
  image_id TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, image_id)
);
CREATE INDEX IF NOT EXISTS idx_lobbylikes_image ON LobbyLikes(image_id, created_at);

-- Reports targeting lobby images OR match cards (Objects). Mirrors UserReports
-- but for content rather than users. 5+ pending reports auto-hide via app logic.
CREATE TABLE IF NOT EXISTS ReportedImages (
  id TEXT PRIMARY KEY,
  image_id TEXT NOT NULL,
  reporter_id TEXT NOT NULL,
  target_kind TEXT NOT NULL DEFAULT 'lobby',
  category TEXT,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  resolved_by TEXT,
  resolved_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_reportedimages_status ON ReportedImages(status, created_at);
CREATE INDEX IF NOT EXISTS idx_reportedimages_image ON ReportedImages(image_id);

-- Private messages: server-stored for admin moderation. NOT E2EE — the
-- moderation panel must be able to read and act on these. Documented in
-- docs/SECURITY.md as an explicit departure from the match-card E2EE model.
CREATE TABLE IF NOT EXISTS PrivateMessages (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  -- One of NULL, 'sender', 'recipient'. When both sides delete we garbage-collect.
  deleted_by TEXT,
  hidden_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_pm_recipient ON PrivateMessages(recipient_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pm_sender ON PrivateMessages(sender_id, created_at);

-- Playtime accumulator + donation acknowledgement. Drives the
-- "Buy me a coffee" popup gate (>= 60 min playtime OR >= 12 matches).
CREATE TABLE IF NOT EXISTS Playtime (
  user_id TEXT PRIMARY KEY,
  accumulated_ms INTEGER NOT NULL DEFAULT 0,
  last_match_started_at DATETIME
);

CREATE TABLE IF NOT EXISTS DonationAcknowledgement (
  user_id TEXT PRIMARY KEY,
  acked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Every admin mutation appends a row. Gives the moderation trail every
-- "ban/delete/redact/add-points" action needs.
CREATE TABLE IF NOT EXISTS AdminAuditLog (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_id TEXT,
  target_type TEXT,
  reason TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_admin ON AdminAuditLog(admin_id, created_at);
CREATE INDEX IF NOT EXISTS idx_admin_audit_target ON AdminAuditLog(target_type, target_id);

-- Daily aggregate stats computed by cleanup.ts. Backfills the "played while
-- I was AFK" dashboard.
CREATE TABLE IF NOT EXISTS DailyStats (
  date TEXT PRIMARY KEY,
  active_users INTEGER NOT NULL DEFAULT 0,
  matches_played INTEGER NOT NULL DEFAULT 0,
  peak_concurrent INTEGER NOT NULL DEFAULT 0,
  new_users INTEGER NOT NULL DEFAULT 0,
  banned_users INTEGER NOT NULL DEFAULT 0,
  reports_opened INTEGER NOT NULL DEFAULT 0
);

-- Session event ledger backing the admin history dashboard. Lightweight rows
-- so we can keep ~7 days without ballooning the snapshot.
CREATE TABLE IF NOT EXISTS SessionEvents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  ts DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_session_events_ts ON SessionEvents(ts);
CREATE INDEX IF NOT EXISTS idx_session_events_user ON SessionEvents(user_id, ts);

-- Column adds on existing tables. ALTER TABLE IF NOT EXISTS isn't standard
-- sqlite; we catch the "duplicate column name" error in migrate.ts and skip.

ALTER TABLE LobbyImages ADD COLUMN uploader_name TEXT;
ALTER TABLE LobbyImages ADD COLUMN reports_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE LobbyImages ADD COLUMN hidden_at DATETIME;
ALTER TABLE LobbyImages ADD COLUMN is_proxied INTEGER NOT NULL DEFAULT 0;
ALTER TABLE LobbyImages ADD COLUMN proxied_mime TEXT;

ALTER TABLE Objects ADD COLUMN reported_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE Objects ADD COLUMN hidden_at DATETIME;
ALTER TABLE Objects ADD COLUMN is_proxied INTEGER NOT NULL DEFAULT 0;
ALTER TABLE Objects ADD COLUMN proxied_mime TEXT;

ALTER TABLE Users ADD COLUMN donations_acknowledged_at DATETIME;
ALTER TABLE Users ADD COLUMN last_pm_at DATETIME;
ALTER TABLE Users ADD COLUMN is_anonymous_uploader INTEGER NOT NULL DEFAULT 0;
ALTER TABLE Users ADD COLUMN score_total INTEGER NOT NULL DEFAULT 0;

ALTER TABLE MatchChat ADD COLUMN hidden_at DATETIME;
ALTER TABLE MatchChat ADD COLUMN report_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE Bans ADD COLUMN scope TEXT NOT NULL DEFAULT 'all';
ALTER TABLE Bans ADD COLUMN ban_scope_chat INTEGER NOT NULL DEFAULT 0;
ALTER TABLE Bans ADD COLUMN ban_scope_pm INTEGER NOT NULL DEFAULT 0;

ALTER TABLE LeagueRank ADD COLUMN losses INTEGER NOT NULL DEFAULT 0;

-- Indexes for the new tables.
CREATE INDEX IF NOT EXISTS idx_pm_recipient_created ON PrivateMessages(recipient_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pm_sender_created ON PrivateMessages(sender_id, created_at);
CREATE INDEX IF NOT EXISTS idx_reportedimages_target ON ReportedImages(target_kind, image_id, status);
