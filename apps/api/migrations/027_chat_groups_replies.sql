-- DM replies (quote another message) + user-created group chats.
ALTER TABLE PrivateMessages ADD COLUMN reply_to TEXT;

CREATE TABLE IF NOT EXISTS ChatGroups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_chat_groups_owner ON ChatGroups(owner_id, created_at);

CREATE TABLE IF NOT EXISTS ChatGroupMembers (
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_group_members_user ON ChatGroupMembers(user_id, joined_at);

CREATE TABLE IF NOT EXISTS GroupMessages (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  body TEXT NOT NULL,
  reply_to TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  hidden_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_group_messages_group ON GroupMessages(group_id, created_at);
