-- Add sender_id to track card originator in duels and prevent reuse against sender
ALTER TABLE Objects ADD COLUMN sender_id TEXT;
