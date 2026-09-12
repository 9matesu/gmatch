-- Migration 050: share flows wave.
-- Directory rows carry the host's display name (best-effort, host-reported,
-- same class as user_count/online_count) so joiners see WHO runs a node.
ALTER TABLE ServerDirectory ADD COLUMN owner_name TEXT;
