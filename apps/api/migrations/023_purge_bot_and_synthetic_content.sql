-- Purge bot/synthetic content that should never appear in the public feed or
-- profiles. Bots generate duel cards on the fly and never persist objects; any
-- legacy rows are placeholders or AI-slideshow artifacts.
DELETE FROM Objects WHERE owner_id LIKE 'bot_%';

DELETE FROM Objects WHERE owner_id LIKE 'creator_%';

DELETE FROM LobbyImages WHERE owner_id LIKE 'bot_%';

DELETE FROM LobbyLikes
WHERE image_id IN (SELECT id FROM LobbyImages WHERE owner_id LIKE 'bot_%');

DELETE FROM PostLikes
WHERE object_id IN (SELECT id FROM Objects WHERE owner_id LIKE 'bot_%');

DELETE FROM Saves
WHERE object_id IN (SELECT id FROM Objects WHERE owner_id LIKE 'bot_%');

DELETE FROM Comments
WHERE object_id IN (SELECT id FROM Objects WHERE owner_id LIKE 'bot_%');

DELETE FROM Objects
WHERE id LIKE 'stream\_%' ESCAPE '\'
   OR id LIKE 'booru\_%' ESCAPE '\';