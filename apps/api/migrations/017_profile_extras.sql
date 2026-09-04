-- goonMatch profile extras: bio + external link, plus denormalized followers /
-- following / posts counts so profile headers can render without three-table
-- joins. These counters are kept in sync by app code on every follower/
-- post-create/delete event.</p>

ALTER TABLE Users ADD COLUMN bio TEXT;
ALTER TABLE Users ADD COLUMN website TEXT;
ALTER TABLE Users ADD COLUMN followers_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE Users ADD COLUMN following_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE Users ADD COLUMN posts_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_users_is_private ON Users(is_private);
CREATE INDEX IF NOT EXISTS idx_users_followers_count ON Users(followers_count);
