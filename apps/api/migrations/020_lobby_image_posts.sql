-- Preserve lobby image tags when images become permanent timeline posts.
ALTER TABLE LobbyImages ADD COLUMN tags TEXT;
