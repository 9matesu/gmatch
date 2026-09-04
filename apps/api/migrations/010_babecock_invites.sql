-- Babecock invites: a host can ping a specific user to draw their attention
-- to the currently-open Babecock round. The round stays globally joinable;
-- the invite just surfaces a one-click "Join" affordance to the recipient.

CREATE TABLE IF NOT EXISTS BabecockInvites (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL,
  host_id TEXT NOT NULL,
  invitee_id TEXT NOT NULL,
  -- 'open' | 'accepted' | 'expired' | 'declined'
  status TEXT NOT NULL DEFAULT 'open',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_babecock_invites_invitee ON BabecockInvites(invitee_id, status);
CREATE INDEX IF NOT EXISTS idx_babecock_invites_round ON BabecockInvites(round_id, invitee_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_babecock_invites_round_invitee ON BabecockInvites(round_id, invitee_id);
