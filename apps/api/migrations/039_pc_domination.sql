-- PC Domination settings for users
-- Allows users to opt-in to remote control features from trusted partners

ALTER TABLE Users ADD COLUMN pc_domination_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE Users ADD COLUMN pc_domination_settings TEXT NOT NULL DEFAULT '{}';

-- Index for finding users who have domination enabled
CREATE INDEX IF NOT EXISTS idx_users_pc_domination ON Users(pc_domination_enabled);

-- Domination action log for audit trail
CREATE TABLE IF NOT EXISTS DominationActions (
  id TEXT PRIMARY KEY,
  dominator_id TEXT NOT NULL,
  victim_id TEXT NOT NULL,
  action TEXT NOT NULL,           -- 'wallpaper', 'game_bg', 'popup_video', 'message', 'text_overlay', 'blur', 'camera'
  payload TEXT,                   -- JSON: { url, text, duration, intensity }
  status TEXT NOT NULL DEFAULT 'sent', -- 'sent', 'executed', 'failed', 'denied'
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  executed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_domination_actions_victim ON DominationActions(victim_id, created_at);
CREATE INDEX IF NOT EXISTS idx_domination_actions_dominator ON DominationActions(dominator_id, created_at);
CREATE INDEX IF NOT EXISTS idx_domination_actions_status ON DominationActions(status);