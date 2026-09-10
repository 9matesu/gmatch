-- Migration 047: game-server-browser metadata on the public directory.
-- The HOST reports how big/alive its node is when it registers and on every
-- heartbeat (routes/servers.ts POST). Constant defaults only; stale counts
-- simply stop updating when a host goes quiet (last_seen filters those rows).
ALTER TABLE ServerDirectory ADD COLUMN user_count INTEGER;
ALTER TABLE ServerDirectory ADD COLUMN online_count INTEGER;
