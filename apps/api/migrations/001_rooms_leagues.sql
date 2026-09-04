CREATE TABLE IF NOT EXISTS MatchRooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  phase TEXT NOT NULL DEFAULT 'waiting',
  capacity INTEGER NOT NULL DEFAULT 4,
  round_seq INTEGER NOT NULL DEFAULT 0,
  pair_deadline INTEGER,
  phase_version INTEGER NOT NULL DEFAULT 0,
  tags TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS MatchRoomPlayers (
  room_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'joined',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (room_id, user_id)
);

CREATE TABLE IF NOT EXISTS RoomDuelPairs (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  round_seq INTEGER NOT NULL,
  user_a TEXT,
  user_b TEXT,
  card_a TEXT,
  card_b TEXT,
  decision_a TEXT,
  decision_b TEXT,
  matched INTEGER DEFAULT 0,
  pair_deadline INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS MatchCards (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  content_url TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS LeagueRank (
  user_id TEXT PRIMARY KEY,
  wins INTEGER NOT NULL DEFAULT 0,
  points INTEGER NOT NULL DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_matchrooms_status ON MatchRooms(status, created_at);
CREATE INDEX IF NOT EXISTS idx_roomplayers_user ON MatchRoomPlayers(user_id);
CREATE INDEX IF NOT EXISTS idx_roompairs_room ON RoomDuelPairs(room_id, round_seq);
CREATE INDEX IF NOT EXISTS idx_matchcards_room ON MatchCards(room_id);