-- ORBIT API — canonical schema (single source of truth)
-- Applied idempotently at boot by src/migrate.ts. Every table, column and
-- index lives here; versioned changes go in migrations/NNN_*.sql.
--
-- Note: no FOREIGN KEY constraints, matching the historical runtime schema.
-- Row-level integrity is enforced in application code, and FK enforcement
-- would reject legitimate orphaned-row flows in persistence/tests.

CREATE TABLE IF NOT EXISTS Users (
  id TEXT PRIMARY KEY,
  public_key TEXT NOT NULL,
  encryption_pub_key TEXT,
  display_name TEXT,
  tags TEXT,
  last_seen DATETIME,
  attention_at DATETIME,
  objects_sent_count INTEGER DEFAULT 0,
  gacha_downloads_received INTEGER DEFAULT 0,
  gacha_items_collected INTEGER DEFAULT 0,
  maximum_gooner INTEGER DEFAULT 0,
  pc_domination_enabled INTEGER DEFAULT 0,
  pc_domination_settings TEXT DEFAULT '{}',
  is_admin INTEGER DEFAULT 0,
  likes_given INTEGER DEFAULT 0,
  likes_received INTEGER DEFAULT 0,
  matches_total INTEGER DEFAULT 0,
  pfp_url TEXT,
  score INTEGER DEFAULT 0,
  score_day TEXT,
  donations_acknowledged_at DATETIME,
  last_pm_at DATETIME,
  is_anonymous_uploader INTEGER NOT NULL DEFAULT 0,
  score_total INTEGER NOT NULL DEFAULT 0,
  is_private INTEGER NOT NULL DEFAULT 0,
  bio TEXT,
  website TEXT,
  followers_count INTEGER NOT NULL DEFAULT 0,
  following_count INTEGER NOT NULL DEFAULT 0,
  posts_count INTEGER NOT NULL DEFAULT 0,
  is_moderator INTEGER NOT NULL DEFAULT 0,
  hidden_at DATETIME
);

CREATE TABLE IF NOT EXISTS Devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  credential_id TEXT NOT NULL,
  public_key TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  challenge TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS Friends (
  user_id TEXT NOT NULL,
  friend_id TEXT NOT NULL,
  PRIMARY KEY (user_id, friend_id)
);

CREATE TABLE IF NOT EXISTS FriendRequests (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL,
  receiver_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(sender_id, receiver_id)
);

-- gMatch asymmetric follow graph. Unlike Friends (bidirectional accepted
-- pairs), a Follow is one-directional: follower_id subscribed to followee_id.
-- For public accounts `accepted=1` immediately; for private accounts it
-- starts at 0 and the followee approves it. Self-follows rejected in app code.
CREATE TABLE IF NOT EXISTS Followers (
  follower_id TEXT NOT NULL,
  followee_id TEXT NOT NULL,
  accepted INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(follower_id, followee_id)
);
CREATE INDEX IF NOT EXISTS idx_followers_followee ON Followers(followee_id, accepted, created_at);
CREATE INDEX IF NOT EXISTS idx_followers_follower ON Followers(follower_id, accepted, created_at);

CREATE TABLE IF NOT EXISTS Objects (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  sender_id TEXT,
  size_bytes INTEGER NOT NULL,
  mime_type TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME,
  content_url TEXT,
  caption TEXT,
  is_story INTEGER DEFAULT 0,
  gacha_downloads_count INTEGER DEFAULT 0,
  is_wallpaper INTEGER DEFAULT 0,
  is_flash INTEGER DEFAULT 0,
  content_hash TEXT,
  reported_count INTEGER NOT NULL DEFAULT 0,
  hidden_at DATETIME,
  is_proxied INTEGER NOT NULL DEFAULT 0,
  proxied_mime TEXT,
  is_public INTEGER NOT NULL DEFAULT 0,
  post_caption TEXT,
  location TEXT,
  post_tags TEXT,
  shared_from TEXT,
  like_count INTEGER NOT NULL DEFAULT 0,
  comment_count INTEGER NOT NULL DEFAULT 0,
  share_count INTEGER NOT NULL DEFAULT 0,
  is_sensitive INTEGER NOT NULL DEFAULT 0,
  sensitive_reason TEXT,
  post_group TEXT,
  is_chat INTEGER NOT NULL DEFAULT 0,
  is_avatar INTEGER NOT NULL DEFAULT 0,
  is_archived INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_objects_owner_content_hash ON Objects (owner_id, content_hash);
CREATE INDEX IF NOT EXISTS idx_objects_post_group ON Objects (post_group);
CREATE INDEX IF NOT EXISTS idx_objects_is_chat ON Objects (is_chat);
CREATE INDEX IF NOT EXISTS idx_objects_is_avatar ON Objects (is_avatar);

-- Which stories a user has already watched. The client keeps a localStorage
-- mirror for instant ring dimming; this table is the cross-device truth and
-- the author's viewer count.
CREATE TABLE IF NOT EXISTS StoryViews (
  object_id TEXT NOT NULL,
  viewer_id TEXT NOT NULL,
  viewed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (object_id, viewer_id)
);

CREATE INDEX IF NOT EXISTS idx_story_views_viewer ON StoryViews (viewer_id);

CREATE TABLE IF NOT EXISTS Recipients (
  object_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  PRIMARY KEY (object_id, recipient_id)
);

CREATE TABLE IF NOT EXISTS Favorites (
  user_id TEXT NOT NULL,
  object_id TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, object_id)
);

CREATE TABLE IF NOT EXISTS UserBlocks (
  blocker_id TEXT NOT NULL,
  blocked_id TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS UserReports (
  id TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL,
  reported_id TEXT NOT NULL,
  reason TEXT,
  category TEXT,
  object_id TEXT,
  status TEXT DEFAULT 'open',
  resolved_by TEXT,
  resolved_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Unified instant-hide moderation queue. Covers every content type; reporting
-- hides the target immediately, then an admin resolves with delete / ban /
-- deny. UNIQUE(reporter_id, target_type, target_id) dedupes forever.
CREATE TABLE IF NOT EXISTS ContentReports (
  id TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  category TEXT,
  reason TEXT,
  object_id TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  action TEXT,
  resolved_by TEXT,
  resolved_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  hidden_at DATETIME,
  UNIQUE(reporter_id, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS idx_creports_status ON ContentReports(status, created_at);
CREATE INDEX IF NOT EXISTS idx_creports_target ON ContentReports(target_type, target_id);

CREATE TABLE IF NOT EXISTS ModerationPatrolRewards (
  user_id TEXT NOT NULL,
  reward_day TEXT NOT NULL,
  awarded_likes INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, reward_day)
);

CREATE TABLE IF NOT EXISTS Bans (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  banned_by TEXT NOT NULL,
  reason TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  scope TEXT NOT NULL DEFAULT 'all',
  ban_scope_chat INTEGER NOT NULL DEFAULT 0,
  ban_scope_pm INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS Announcements (
  id TEXT PRIMARY KEY,
  message TEXT NOT NULL,
  created_by TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Recommendations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  category TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS RateLimits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS Likes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  object_id TEXT NOT NULL,
  decision TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, object_id)
);

CREATE TABLE IF NOT EXISTS Lobbies (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'waiting'
);

CREATE TABLE IF NOT EXISTS LobbyPlayers (
  user_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'waiting',
  auto_queue INTEGER NOT NULL DEFAULT 1,
  joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  waiting_since DATETIME DEFAULT CURRENT_TIMESTAMP,
  ready_at DATETIME,
  deck_id TEXT
);

CREATE TABLE IF NOT EXISTS MatchSessions (
  id TEXT PRIMARY KEY,
  lobby_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  round_seq INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS MatchRounds (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at DATETIME
);

CREATE TABLE IF NOT EXISTS MatchPairs (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL,
  user_a TEXT NOT NULL,
  user_b TEXT NOT NULL,
  card_a TEXT,
  card_b TEXT,
  decision_a TEXT,
  decision_b TEXT,
  matched INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS TierMatches (
  id TEXT PRIMARY KEY,
  user_a TEXT NOT NULL,
  user_b TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  tier INTEGER NOT NULL DEFAULT 1,
  card_a TEXT,
  card_b TEXT,
  decision_a TEXT,
  decision_b TEXT,
  last_result TEXT,
  last_card_a TEXT,
  last_card_b TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS GameMatches (
  id TEXT PRIMARY KEY,
  user_a TEXT NOT NULL,
  user_b TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'lobby',
  phase TEXT NOT NULL DEFAULT 'lobby',
  round_seq INTEGER NOT NULL DEFAULT 1,
  max_rounds INTEGER NOT NULL DEFAULT 5,
  score_a INTEGER NOT NULL DEFAULT 0,
  score_b INTEGER NOT NULL DEFAULT 0,
  card_a TEXT,
  card_b TEXT,
  decision_a TEXT,
  decision_b TEXT,
  played_cards_a TEXT DEFAULT '[]',
  played_cards_b TEXT DEFAULT '[]',
  rounds_history TEXT DEFAULT '[]',
  forfeit_user TEXT,
  matched INTEGER DEFAULT 0,
  result TEXT,
  phase_deadline INTEGER NOT NULL,
  phase_version INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS LobbyImages (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  content_url TEXT,
  mime_type TEXT,
  caption TEXT,
  tags TEXT,
  likes_count INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME,
  uploader_name TEXT,
  reports_count INTEGER NOT NULL DEFAULT 0,
  hidden_at DATETIME,
  is_proxied INTEGER NOT NULL DEFAULT 0,
  proxied_mime TEXT
);

CREATE TABLE IF NOT EXISTS SystemMeta (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS MatchRooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  phase TEXT NOT NULL DEFAULT 'waiting',
  capacity INTEGER NOT NULL DEFAULT 4,
  round_seq INTEGER NOT NULL DEFAULT 0,
  pair_deadline INTEGER,
  phase_version INTEGER NOT NULL DEFAULT 0,
  tags TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS MatchRoomPlayers (
  room_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'joined',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (room_id, user_id)
);

CREATE TABLE IF NOT EXISTS RoomDuelPairs (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  round_seq INTEGER NOT NULL,
  user_a TEXT,
  user_b TEXT,
  card_a TEXT,
  card_b TEXT,
  decision_a TEXT,
  decision_b TEXT,
  matched INTEGER DEFAULT 0,
  pair_deadline INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS MatchCards (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  content_url TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS LeagueRank (
  user_id TEXT PRIMARY KEY,
  wins INTEGER NOT NULL DEFAULT 0,
  points INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS MatchChat (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  sender_name TEXT,
  body TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  hidden_at DATETIME,
  report_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS LobbyComments (
  id TEXT PRIMARY KEY,
  image_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  hidden_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_lobbycomments_image ON LobbyComments(image_id, created_at);

CREATE TABLE IF NOT EXISTS LobbyLikes (
  user_id TEXT NOT NULL,
  image_id TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, image_id)
);
CREATE INDEX IF NOT EXISTS idx_lobbylikes_image ON LobbyLikes(image_id, created_at);

CREATE TABLE IF NOT EXISTS LobbyChat (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL,
  sender_name TEXT,
  body TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  channel TEXT NOT NULL DEFAULT 'global_lobby',
  hidden_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_lobbychat_created ON LobbyChat(created_at);
CREATE INDEX IF NOT EXISTS idx_lobbychat_channel ON LobbyChat(channel, created_at);

CREATE TABLE IF NOT EXISTS ReportedImages (
  id TEXT PRIMARY KEY,
  image_id TEXT NOT NULL,
  reporter_id TEXT NOT NULL,
  target_kind TEXT NOT NULL DEFAULT 'lobby',
  category TEXT,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  resolved_by TEXT,
  resolved_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_reportedimages_status ON ReportedImages(status, created_at);
CREATE INDEX IF NOT EXISTS idx_reportedimages_image ON ReportedImages(image_id);

CREATE TABLE IF NOT EXISTS PrivateMessages (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  deleted_by TEXT,
  hidden_at DATETIME,
  reply_to TEXT,
  attachment_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_pm_recipient ON PrivateMessages(recipient_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pm_sender ON PrivateMessages(sender_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pm_attachment ON PrivateMessages(attachment_id);

CREATE TABLE IF NOT EXISTS Playtime (
  user_id TEXT PRIMARY KEY,
  accumulated_ms INTEGER NOT NULL DEFAULT 0,
  last_match_started_at DATETIME
);

CREATE TABLE IF NOT EXISTS DonationAcknowledgement (
  user_id TEXT PRIMARY KEY,
  acked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS AdminAuditLog (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_id TEXT,
  target_type TEXT,
  reason TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_admin ON AdminAuditLog(admin_id, created_at);
CREATE INDEX IF NOT EXISTS idx_admin_audit_target ON AdminAuditLog(target_type, target_id);

-- PC Domination actions log
CREATE TABLE IF NOT EXISTS DominationActions (
  id TEXT PRIMARY KEY,
  dominator_id TEXT NOT NULL,
  victim_id TEXT NOT NULL,
  action TEXT NOT NULL,
  payload TEXT,
  status TEXT NOT NULL DEFAULT 'sent',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  executed_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_domination_actions_victim ON DominationActions(victim_id, created_at);

-- Paid hack debuffs (users.ts store purchase → /hacks/active, spy-feed gate).
-- Durable on purpose: the bundled sidecar restarts with every app relaunch,
-- and an in-memory list silently ate paid effects + spy sessions (migration
-- 048; fixes the docs-vs-logic "server-enforced" overclaim).
CREATE TABLE IF NOT EXISTS HackDebuffs (
  id TEXT PRIMARY KEY,
  attacker_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  type TEXT NOT NULL,
  attacker_name TEXT,
  target_name TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hack_debuffs_target ON HackDebuffs(target_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_hack_debuffs_attacker ON HackDebuffs(attacker_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_domination_actions_dominator ON DominationActions(dominator_id, created_at);
CREATE INDEX IF NOT EXISTS idx_domination_actions_status ON DominationActions(status);

CREATE TABLE IF NOT EXISTS DailyStats (
  date TEXT PRIMARY KEY,
  active_users INTEGER NOT NULL DEFAULT 0,
  matches_played INTEGER NOT NULL DEFAULT 0,
  peak_concurrent INTEGER NOT NULL DEFAULT 0,
  new_users INTEGER NOT NULL DEFAULT 0,
  banned_users INTEGER NOT NULL DEFAULT 0,
  reports_opened INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS SessionEvents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  ts DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_session_events_ts ON SessionEvents(ts);
CREATE INDEX IF NOT EXISTS idx_session_events_user ON SessionEvents(user_id, ts);

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

CREATE TABLE IF NOT EXISTS StoreUnlocks (
  user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  unlocked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_store_unlocks_user ON StoreUnlocks(user_id);

CREATE TABLE IF NOT EXISTS UserInventory (
  user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_user_inventory_user ON UserInventory(user_id);

CREATE TABLE IF NOT EXISTS BabecockRounds (
  id TEXT PRIMARY KEY,
  host_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  phase_deadline INTEGER NOT NULL,
  gallery_expires_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ,grid_size INTEGER NOT NULL DEFAULT 3
);

CREATE INDEX IF NOT EXISTS idx_babecock_rounds_status ON BabecockRounds(status, phase_deadline);

CREATE TABLE IF NOT EXISTS BabecockEntries (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  content_url TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'image/jpeg',
  caption TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  grid_position INTEGER
);

CREATE INDEX IF NOT EXISTS idx_babecock_entries_round ON BabecockEntries(round_id, created_at);
CREATE INDEX IF NOT EXISTS idx_babecock_entries_round_user ON BabecockEntries(round_id, user_id);

-- Babecock invites: a host can ping a specific user to join their open round.
-- Round is still globally visible/joinable; the invite just draws targeted
-- attention with one-click "join" affordance for the recipient.
CREATE TABLE IF NOT EXISTS BabecockInvites (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL,
  host_id TEXT NOT NULL,
  invitee_id TEXT NOT NULL,
  -- 'open' | 'accepted' | 'expired' | 'declined'
  status TEXT NOT NULL DEFAULT 'open',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_babecock_invites_invitee ON BabecockInvites(invitee_id, status);
CREATE INDEX IF NOT EXISTS idx_babecock_invites_round ON BabecockInvites(round_id, invitee_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_babecock_invites_round_invitee ON BabecockInvites(round_id, invitee_id);

-- Match invites: any player can challenge a specific online player to a direct
-- 1v1 matchup (bypassing the auto-pairing queue). Accept/Decline via WS push.
CREATE TABLE IF NOT EXISTS MatchInvites (
  id TEXT PRIMARY KEY,
  inviter_id TEXT NOT NULL,
  invitee_id TEXT NOT NULL,
  -- 'open' | 'accepted' | 'declined' | 'expired'
  status TEXT NOT NULL DEFAULT 'open',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_match_invites_invitee ON MatchInvites(invitee_id, status);
CREATE INDEX IF NOT EXISTS idx_match_invites_inviter ON MatchInvites(inviter_id, status);
-- Only one *open* invite per (inviter, invitee) at a time. Declined/expired
-- rows must not block a future re-invite, hence the partial unique index.
CREATE UNIQUE INDEX IF NOT EXISTS idx_match_invites_pair_open ON MatchInvites(inviter_id, invitee_id) WHERE status = 'open';

-- Server-persisted in-app notifications (survive reload). Client polls this list
-- and receives real-time WS pushes for new rows; the header bell shows unread.
CREATE TABLE IF NOT EXISTS Notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  -- 'match_invite' | 'match_result' | 'pm' | 'babecock_invite' | 'system'
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  data TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON Notifications(user_id, read, created_at);

-- Match archive: server-persisted record of every resolved 1v1 duel. The full
-- result is copied here when a match ends so it survives the GameMatches
-- cleanup sweep. Powers the admin-only match report / history browser; never
-- exposed to players.
CREATE TABLE IF NOT EXISTS MatchArchive (
  id TEXT PRIMARY KEY,
  user_a TEXT NOT NULL,
  user_b TEXT NOT NULL,
  user_a_name TEXT,
  user_a_pfp TEXT,
  user_b_name TEXT,
  user_b_pfp TEXT,
  score_a INTEGER NOT NULL DEFAULT 0,
  score_b INTEGER NOT NULL DEFAULT 0,
  result TEXT NOT NULL,
  rounds_history TEXT,
  matched INTEGER NOT NULL DEFAULT 0,
  perfect INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  ended_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_match_archive_ended ON MatchArchive(ended_at);
CREATE INDEX IF NOT EXISTS idx_match_archive_user_a ON MatchArchive(user_a, ended_at);
CREATE INDEX IF NOT EXISTS idx_match_archive_user_b ON MatchArchive(user_b, ended_at);
CREATE INDEX IF NOT EXISTS idx_match_archive_result ON MatchArchive(result, ended_at);

-- gMatch post engagement: generalized comments ledger (works for any Object,
-- not just lobby board images), per-comment likes, and per-user saves.
CREATE TABLE IF NOT EXISTS Comments (
  id TEXT PRIMARY KEY,
  object_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  parent_comment_id TEXT,
  body TEXT NOT NULL,
  like_count INTEGER NOT NULL DEFAULT 0,
  hidden_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_comments_object ON Comments(object_id, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON Comments(parent_comment_id);
CREATE INDEX IF NOT EXISTS idx_comments_author ON Comments(author_id, created_at);

CREATE TABLE IF NOT EXISTS CommentLikes (
  comment_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(comment_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_comment_likes_comment ON CommentLikes(comment_id);

CREATE TABLE IF NOT EXISTS Saves (
  user_id TEXT NOT NULL,
  object_id TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, object_id)
);
CREATE INDEX IF NOT EXISTS idx_saves_user ON Saves(user_id, created_at);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_users_last_seen ON Users(last_seen);
CREATE INDEX IF NOT EXISTS idx_users_last_seen_offline ON Users(last_seen) WHERE id NOT LIKE 'bot_%' AND last_seen IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_pc_domination ON Users(pc_domination_enabled);
CREATE INDEX IF NOT EXISTS idx_objects_owner_id ON Objects(owner_id);
CREATE INDEX IF NOT EXISTS idx_objects_created_at ON Objects(created_at);
CREATE INDEX IF NOT EXISTS idx_objects_story_created ON Objects(is_story, created_at);
CREATE INDEX IF NOT EXISTS idx_recipients_recipient_id ON Recipients(recipient_id);
CREATE INDEX IF NOT EXISTS idx_favorites_object_id ON Favorites(object_id);
CREATE INDEX IF NOT EXISTS idx_likes_user ON Likes(user_id);
CREATE INDEX IF NOT EXISTS idx_likes_object ON Likes(object_id);
CREATE INDEX IF NOT EXISTS idx_matchpairs_round_id ON MatchPairs(round_id);
CREATE INDEX IF NOT EXISTS idx_matchrounds_session_seq ON MatchRounds(session_id, seq);
CREATE INDEX IF NOT EXISTS idx_matchsessions_status_created ON MatchSessions(status, created_at);
CREATE INDEX IF NOT EXISTS idx_lobbyplayers_status_joined ON LobbyPlayers(status, joined_at);
CREATE INDEX IF NOT EXISTS idx_tiermatches_status ON TierMatches(status);
CREATE INDEX IF NOT EXISTS idx_tiermatches_user ON TierMatches(user_a, user_b);
CREATE INDEX IF NOT EXISTS idx_gamematches_user ON GameMatches(user_a, status);
CREATE INDEX IF NOT EXISTS idx_gamematches_status ON GameMatches(status, phase_deadline);
CREATE INDEX IF NOT EXISTS idx_announcements_active ON Announcements(is_active);
CREATE INDEX IF NOT EXISTS idx_matchrooms_status ON MatchRooms(status, created_at);
CREATE INDEX IF NOT EXISTS idx_roomplayers_user ON MatchRoomPlayers(user_id);
CREATE INDEX IF NOT EXISTS idx_roompairs_room ON RoomDuelPairs(room_id, round_seq);
CREATE INDEX IF NOT EXISTS idx_matchcards_room ON MatchCards(room_id);
CREATE INDEX IF NOT EXISTS idx_match_chat_match ON MatchChat(match_id, created_at);
CREATE INDEX IF NOT EXISTS idx_objects_public_feed ON Objects(is_public, created_at);
CREATE INDEX IF NOT EXISTS idx_objects_trending ON Objects(is_public, like_count, comment_count, created_at);
CREATE INDEX IF NOT EXISTS idx_objects_shared_from ON Objects(shared_from);
CREATE INDEX IF NOT EXISTS idx_users_is_private ON Users(is_private);
CREATE INDEX IF NOT EXISTS idx_users_followers_count ON Users(followers_count);
CREATE INDEX IF NOT EXISTS idx_users_is_moderator ON Users(is_moderator);
CREATE INDEX IF NOT EXISTS idx_objects_is_sensitive ON Objects(is_sensitive);

-- ============================================================================
-- Economy (g$) — authoritative wallet + immutable ledger + idempotent
-- operations. The client never submits a balance, price, or result: every
-- balance mutation goes through EconomyService and produces a ledger row.
-- ============================================================================
CREATE TABLE IF NOT EXISTS Wallets (
  user_id TEXT PRIMARY KEY,
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS LedgerTransactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  delta INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  reference TEXT,
  operation_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON LedgerTransactions(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ledger_operation ON LedgerTransactions(operation_id);

-- EconomicOperations records one logical economic action keyed by a
-- client-supplied idempotency key. Reusing the same key returns the recorded
-- result instead of applying the mutation twice (replay-safe).
CREATE TABLE IF NOT EXISTS EconomicOperations (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  fingerprint TEXT,
  payload TEXT,
  result TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_economicops_user ON EconomicOperations(user_id, created_at);

-- ============================================================================
-- Cards — canonical card asset. Ownership lives in CardOwnership (single row
-- per card); Cards holds immutable-ish metadata. CardHistory is append-only.
-- ============================================================================
CREATE TABLE IF NOT EXISTS Cards (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL,
  media_object_id TEXT NOT NULL,
  name TEXT,
  rarity TEXT NOT NULL DEFAULT 'common',
  value INTEGER NOT NULL DEFAULT 0,
  like_count INTEGER NOT NULL DEFAULT 0,
  market_status TEXT NOT NULL DEFAULT 'none',
  moderation_state TEXT NOT NULL DEFAULT 'active',
  tags TEXT NOT NULL DEFAULT '[]',
  description TEXT,
  frame TEXT NOT NULL DEFAULT 'chrome',
  accent_color TEXT NOT NULL DEFAULT '#9FE3FF',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_cards_creator ON Cards(creator_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cards_value ON Cards(value);
CREATE INDEX IF NOT EXISTS idx_cards_moderation ON Cards(moderation_state);

CREATE TABLE IF NOT EXISTS CardOwnership (
  card_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  acquired_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_card_ownership_owner ON CardOwnership(owner_id);

CREATE TABLE IF NOT EXISTS CardHistory (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  event TEXT NOT NULL,
  from_user TEXT,
  to_user TEXT,
  meta TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_card_history_card ON CardHistory(card_id, created_at);

-- ============================================================================
-- Decks — per-game deck ownership and member cards. Deck size/eligibility rules
-- are game-defined; DeckCards enforces no duplicate card within a deck.
-- ============================================================================
CREATE TABLE IF NOT EXISTS Decks (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  game_id TEXT NOT NULL DEFAULT 'card-duel',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_decks_owner ON Decks(owner_id, game_id);

CREATE TABLE IF NOT EXISTS DeckCards (
  deck_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(deck_id, card_id)
);
CREATE INDEX IF NOT EXISTS idx_deck_cards_deck ON DeckCards(deck_id, position);

-- ============================================================================
-- MarketListings — cards offered for sale. Price is server-validated; the sale
-- itself is an atomic EconomyService transfer plus ownership change.
-- ============================================================================
CREATE TABLE IF NOT EXISTS MarketListings (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  seller_id TEXT NOT NULL,
  price INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_market_status ON MarketListings(status, created_at);
-- At most one *open* listing per card; historical sold/cancelled rows do not
-- block a future re-list.
CREATE UNIQUE INDEX IF NOT EXISTS idx_market_open_card ON MarketListings(card_id) WHERE status = 'open';

-- ServerDirectory (plan T3, docs/ADR-002-servers.md): PUBLIC SERVER DIRECTORY —
-- metadata only, never content. Lives on the central node; every listed server
-- is a separate full node with its own DB. endpoint_hint is served to
-- authenticated callers only (routes/servers.ts softAuth).
CREATE TABLE IF NOT EXISTS ServerDirectory (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  owner_id TEXT NOT NULL,
  owner_pubkey TEXT NOT NULL,
  owner_name TEXT,
  endpoint_hint TEXT NOT NULL DEFAULT '',
  password_required INTEGER NOT NULL DEFAULT 0,
  user_count INTEGER,
  online_count INTEGER,
  tags TEXT NOT NULL DEFAULT '[]',
  is_private INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  blocked INTEGER NOT NULL DEFAULT 0,
  master_note TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_server_dir_owner ON ServerDirectory(owner_id);
CREATE INDEX IF NOT EXISTS idx_server_dir_seen ON ServerDirectory(last_seen);
