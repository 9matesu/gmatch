-- Add channel column to LobbyChat to separate Lobby Lounge ('global_lobby') from Card Game Queue ('card_queue').
ALTER TABLE LobbyChat ADD COLUMN channel TEXT NOT NULL DEFAULT 'global_lobby';
CREATE INDEX IF NOT EXISTS idx_lobbychat_channel ON LobbyChat(channel, created_at);
