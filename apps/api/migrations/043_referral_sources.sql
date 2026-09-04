-- Inbound traffic source tracking (referrer attribution).
-- One row per unique (visitor_key, source) so repeat loads from the same
-- browser never double-count an acquisition.
CREATE TABLE IF NOT EXISTS TrafficSources (
  id TEXT PRIMARY KEY,
  visitor_key TEXT NOT NULL,
  source TEXT NOT NULL,
  referrer_url TEXT,
  landing_path TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (visitor_key, source)
);
CREATE INDEX IF NOT EXISTS idx_traffic_sources_source ON TrafficSources(source, created_at);
CREATE INDEX IF NOT EXISTS idx_traffic_sources_created ON TrafficSources(created_at);