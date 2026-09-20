-- Migration 055: gossip relay envelopes (plan G1, self-hosting relay).
-- Signed public-post metadata replicated node-to-node; media bytes stay
-- local-first (P2P swarm). See schema.sql GossipEnvelopes comment.
CREATE TABLE IF NOT EXISTS GossipEnvelopes (
  id TEXT PRIMARY KEY,
  author_id TEXT NOT NULL,
  author_pubkey TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'post',
  payload TEXT NOT NULL,
  sig TEXT NOT NULL,
  origin_node TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gossip_received ON GossipEnvelopes(received_at, id);
CREATE INDEX IF NOT EXISTS idx_gossip_expires ON GossipEnvelopes(expires_at);
