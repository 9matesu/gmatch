-- 002: 5-round match progression and auto-queue support

ALTER TABLE LobbyPlayers ADD COLUMN auto_queue INTEGER NOT NULL DEFAULT 1;

ALTER TABLE GameMatches ADD COLUMN round_seq INTEGER NOT NULL DEFAULT 1;
ALTER TABLE GameMatches ADD COLUMN max_rounds INTEGER NOT NULL DEFAULT 5;
ALTER TABLE GameMatches ADD COLUMN score_a INTEGER NOT NULL DEFAULT 0;
ALTER TABLE GameMatches ADD COLUMN score_b INTEGER NOT NULL DEFAULT 0;
ALTER TABLE GameMatches ADD COLUMN played_cards_a TEXT DEFAULT '[]';
ALTER TABLE GameMatches ADD COLUMN played_cards_b TEXT DEFAULT '[]';
ALTER TABLE GameMatches ADD COLUMN rounds_history TEXT DEFAULT '[]';
ALTER TABLE GameMatches ADD COLUMN forfeit_user TEXT;
