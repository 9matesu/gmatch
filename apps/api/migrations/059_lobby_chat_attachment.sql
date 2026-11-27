-- Lobby chat can carry one image/video attachment per message.
-- The bytes stay content-addressed in Objects; the chat row only references
-- the object id, exactly like group messages do.
ALTER TABLE LobbyChat ADD COLUMN attachment_id TEXT;
