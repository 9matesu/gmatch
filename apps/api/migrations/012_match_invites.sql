-- Match invites: any player can challenge a specific online player to a direct
-- 1v1 matchup (bypassing the auto-pairing queue). The invitee gets a WS-pushed
-- notification with Accept/Decline; on accept both are placed into a fresh
-- GameMatches duel and the queue marks them in_match.

CREATE TABLE IF NOT EXISTS MatchInvites (
  id TEXT PRIMARY KEY,
  inviter_id TEXT NOT NULL,
  invitee_id TEXT NOT NULL,
  -- 'open' | 'accepted' | 'declined' | 'expired'
  status TEXT NOT NULL DEFAULT 'open',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_match_invites_invitee ON MatchInvites(invitee_id, status);
CREATE INDEX IF NOT EXISTS idx_match_invites_inviter ON MatchInvites(inviter_id, status);
-- Only one *open* invite per (inviter, invitee) at a time. Declined/expired
-- rows must not block a future re-invite, hence the partial unique index.
CREATE UNIQUE INDEX IF NOT EXISTS idx_match_invites_pair_open ON MatchInvites(inviter_id, invitee_id) WHERE status = 'open';

-- Server-persisted in-app notifications (survive reload). The client polls this
-- list and receives real-time WS pushes for new rows; the bell in the header
-- reflects unread counts. Rows are capped by the maintenance sweep (cleanup.ts).
CREATE TABLE IF NOT EXISTS Notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  -- 'match_invite' | 'match_result' | 'pm' | 'babecock_invite' | 'system'
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  data TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON Notifications(user_id, read, created_at);