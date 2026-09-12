-- Deck-gated matchmaking: the queue remembers which deck a player entered with.
ALTER TABLE LobbyPlayers ADD COLUMN deck_id TEXT;
