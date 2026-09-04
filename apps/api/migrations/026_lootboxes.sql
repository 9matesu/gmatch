-- Lootboxes are created and released individually by admins only. The public
-- store surfaces only released rows; opening a pack validates against this
-- table instead of a hardcoded allowlist. The three legacy packs are seeded
-- as released so existing player inventory keeps working.

CREATE TABLE IF NOT EXISTS Lootboxes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  desc TEXT,
  cost INTEGER NOT NULL DEFAULT 250,
  card_count INTEGER NOT NULL DEFAULT 3,
  rarity_theme TEXT NOT NULL DEFAULT 'rare',
  icon TEXT DEFAULT 'Sparkles',
  badge TEXT,
  released INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_lootboxes_released ON Lootboxes(released, created_at);

INSERT OR IGNORE INTO Lootboxes (id, name, desc, cost, card_count, rarity_theme, icon, badge, released) VALUES
  ('item-pack-rare', 'Holo Rare Vault Pack', 'Opens a 3-card pack guaranteed to contain Rare or Epic holographic cards with high trade valuation.', 250, 3, 'rare', 'Sparkles', 'HOLO', 1),
  ('item-pack-cyber', 'Cyber Mythic Lootbox', 'Opens a 5-card luxury lootbox with guaranteed Epic and Legendary tier duel cards.', 500, 5, 'legendary', 'Box', 'MYTHIC', 1),
  ('item-lootbox-celebrity', 'Celebrity Stars Mystery Box', 'Opens a celebrity-tier luxury lootbox containing rare pop-culture, idol, and celebrity cards.', 350, 3, 'legendary', 'Sparkles', 'CELEB', 1);
