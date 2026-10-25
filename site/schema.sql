-- Cloudflare D1 schema for the gmatch courier (site/functions/api/[[path]].ts).
-- Apply with:
--   npx wrangler d1 execute gmatch-courier --remote --file=site/schema.sql
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS Mail (
  token      TEXT    NOT NULL,
  id         TEXT    NOT NULL,
  env        TEXT    NOT NULL,
  stored_at  INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (token, id)
);

CREATE INDEX IF NOT EXISTS Mail_expires ON Mail (expires_at);
CREATE INDEX IF NOT EXISTS Mail_token ON Mail (token);

-- Public metadata only: the directory never stores content, mail or presence.
CREATE TABLE IF NOT EXISTS ServerDirectory (
  id                TEXT PRIMARY KEY,
  name              TEXT    NOT NULL,
  description       TEXT    NOT NULL DEFAULT '',
  owner_id          TEXT    NOT NULL,
  owner_pubkey      TEXT,
  owner_name        TEXT,
  endpoint_hint     TEXT    NOT NULL DEFAULT '',
  password_required INTEGER NOT NULL DEFAULT 0,
  user_count        INTEGER,
  online_count      INTEGER,
  tags              TEXT    NOT NULL DEFAULT '[]',
  is_private        INTEGER NOT NULL DEFAULT 0,
  hidden            INTEGER NOT NULL DEFAULT 0,
  blocked           INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  last_seen         TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT
);

CREATE INDEX IF NOT EXISTS ServerDirectory_owner ON ServerDirectory (owner_id);
CREATE INDEX IF NOT EXISTS ServerDirectory_last_seen ON ServerDirectory (last_seen);
