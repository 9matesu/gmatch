-- Migration 045: public server directory (see schema.sql + docs/ADR-002-servers.md).
CREATE TABLE IF NOT EXISTS ServerDirectory (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  owner_id TEXT NOT NULL,
  owner_pubkey TEXT NOT NULL,
  endpoint_hint TEXT NOT NULL DEFAULT '',
  password_required INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_server_dir_owner ON ServerDirectory(owner_id);
CREATE INDEX IF NOT EXISTS idx_server_dir_seen ON ServerDirectory(last_seen);
