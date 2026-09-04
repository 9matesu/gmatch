CREATE TABLE IF NOT EXISTS ModerationPatrolRewards (
  user_id TEXT NOT NULL,
  reward_day TEXT NOT NULL,
  awarded_likes INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, reward_day)
);
