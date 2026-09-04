-- User-created slideshows built from gallery cards, public posts, or API tag
-- queries (resolved through the configured booru providers). Slideshows are
-- private to their owner: items reference Objects the owner already has access
-- to, and 'api' source stores only the tags — provider credentials never leave
-- the server.

CREATE TABLE IF NOT EXISTS Slideshows (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  title TEXT,
  source TEXT NOT NULL DEFAULT 'cards',  -- 'cards' | 'posts' | 'both' | 'api'
  tags TEXT,                              -- JSON array, only used for 'api' source
  interval_ms INTEGER NOT NULL DEFAULT 5000,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_slideshows_owner ON Slideshows(owner_id, created_at);

CREATE TABLE IF NOT EXISTS SlideshowItems (
  id TEXT PRIMARY KEY,
  slideshow_id TEXT NOT NULL,
  object_id TEXT,
  caption TEXT,
  mime_type TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_slideshow_items_slide ON SlideshowItems(slideshow_id, position);
