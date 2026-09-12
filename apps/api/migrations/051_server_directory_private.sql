-- Migration 051: owner-controlled privacy. is_private rows are omitted from the
-- public directory for everyone except their owner; joining still works
-- out-of-band via the gmatch://node/ handle (the hub is never needed to reach
-- a node — see docs/ADR-002-servers.md).
ALTER TABLE ServerDirectory ADD COLUMN is_private INTEGER NOT NULL DEFAULT 0;
