-- Cards last forever: wipe the expiry on every non-story object that did not
-- have an explicit user-chosen timebomb. Stories keep their short TTL (handled
-- by is_story), profile pictures were never given an expiry so they are
-- unaffected, and explicit duration uploads keep the expiry the user asked for.
UPDATE Objects
SET expires_at = NULL
WHERE expires_at IS NOT NULL
  AND is_story = 0;