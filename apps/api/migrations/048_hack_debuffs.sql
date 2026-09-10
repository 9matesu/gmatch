-- Migration 048: durable hack debuffs.
-- Paid hack effects lived only in a module-level array: restarting the bundled
-- sidecar (every app relaunch!) silently ate active victim debuffs AND killed
-- the attacker's spy-feed session whose purchase already charged g$. Same
-- expiry semantics, now in the DB; the in-memory array is gone.
CREATE TABLE IF NOT EXISTS HackDebuffs (
  id TEXT PRIMARY KEY,
  attacker_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  type TEXT NOT NULL,
  attacker_name TEXT,
  target_name TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hack_debuffs_target ON HackDebuffs(target_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_hack_debuffs_attacker ON HackDebuffs(attacker_id, expires_at);
