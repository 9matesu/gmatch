-- 004: store mime_type on board posts so the client can branch on video
-- after the `data:video/mp4;base64,...` URL is rewritten to a content endpoint.
ALTER TABLE LobbyImages ADD COLUMN mime_type TEXT;
