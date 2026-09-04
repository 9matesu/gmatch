-- Flash Drop consumable inventory + flash object flag.
-- StoreUnlocks keeps one-time unlocks; consumables stack in UserInventory.

CREATE TABLE IF NOT EXISTS UserInventory (
  user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_user_inventory_user ON UserInventory(user_id);

ALTER TABLE Objects ADD COLUMN is_flash INTEGER DEFAULT 0;
