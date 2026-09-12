import type { Announcement } from "@orbit/shared";
import type { OrbitIdentity } from "@orbit/crypto";

export interface AdminUser {
  id: string;
  public_key?: string;
  encryption_pub_key?: string | null;
  display_name?: string;
  pfp_url?: string | null;
  tags?: string[];
  last_seen?: string;
  days_offline?: number | null;
  online?: boolean;
  lobby_status?: string | null;
  active_tier_match?: boolean;
  objects_sent_count?: number;
  likes_given?: number;
  likes_received?: number;
  matches_total?: number;
  gacha_items_collected?: number;
  gacha_downloads_received?: number;
  score?: number;
  balance?: number;
  followers_count?: number;
  following_count?: number;
  is_admin?: boolean | number;
  is_moderator?: boolean | number;
  is_banned?: boolean | number;
  ban_reason?: string | null;
  ban_created_at?: string | null;
  joined_at?: string;
  [key: string]: unknown;
}

export interface AdminMatch {
  id: string;
  user_a: string;
  user_b: string;
  user_a_name?: string;
  user_a_pfp?: string | null;
  user_b_name?: string;
  user_b_pfp?: string | null;
  status: string;
  phase: string;
  result?: string;
  phase_deadline?: number;
  created_at: string;
  score_a?: number;
  score_b?: number;
  round_seq?: number;
  max_rounds?: number;
  card_a?: string | null;
  card_b?: string | null;
  card_a_url?: string | null;
  card_b_url?: string | null;
  rounds_history?: Array<{
    round: number;
    card_a?: string | null;
    card_b?: string | null;
    decision_a?: string | null;
    decision_b?: string | null;
    matched?: boolean;
  }>;
}

export interface AdminArchivedMatch {
  id: string;
  user_a: string;
  user_b: string;
  user_a_name?: string | null;
  user_a_pfp?: string | null;
  user_b_name?: string | null;
  user_b_pfp?: string | null;
  score_a: number;
  score_b: number;
  result: string;
  matched: number;
  perfect: number;
  rounds_history?: Array<{
    round: number;
    card_a?: string | null;
    card_b?: string | null;
    card_a_url?: string | null;
    card_b_url?: string | null;
    decision_a?: string | null;
    decision_b?: string | null;
    matched?: boolean;
    result?: string | null;
  }>;
  created_at: string;
  ended_at: string;
}

export interface AdminTierMatch {
  id: string;
  user_a: string;
  user_b: string;
  user_a_name?: string;
  user_a_pfp?: string | null;
  user_b_name?: string;
  user_b_pfp?: string | null;
  card_a?: string | null;
  card_b?: string | null;
  card_a_url?: string | null;
  card_b_url?: string | null;
  decision_a?: string | null;
  decision_b?: string | null;
  tier: number;
  status: string;
  last_result?: string | null;
  last_card_a?: string | null;
  last_card_b?: string | null;
  last_card_a_url?: string | null;
  last_card_b_url?: string | null;
  updated_at: string;
}

export interface AdminObject {
  id: string;
  owner_id: string;
  owner_name?: string;
  owner_pfp?: string | null;
  owner_public_key?: string;
  mime_type: string;
  size_bytes: number;
  is_story: number;
  is_wallpaper?: number;
  created_at: string;
  caption?: string;
  content_url?: string;
  recipients_count?: number;
  likes_count?: number;
  favorites_count?: number;
}

export interface AdminLobbyImage {
  id: string;
  user_id: string;
  user_name?: string;
  user_pfp?: string | null;
  content_url: string;
  caption?: string;
  likes_count?: number;
  created_at: string;
}

export interface AdminReport {
  id: string;
  reporter_id: string;
  reporter_name?: string | null;
  target_type: string;
  target_id: string;
  target_user_name?: string | null;
  content_url?: string | null;
  preview?: string | null;
  category?: string | null;
  reason?: string | null;
  object_id?: string | null;
  status: string;
  action?: string | null;
  hidden_at?: string | null;
  created_at: string;
  is_hidden?: boolean;
  reported_is_banned?: boolean;
}

export interface AdminRecommendation {
  id: string;
  user_id: string;
  user_name?: string;
  category: string;
  content: string;
  status: string;
  created_at: string;
}

export interface AdminLobbyComment {
  id: string;
  image_id: string;
  user_id: string;
  user_name?: string | null;
  body: string;
  created_at: string;
  hidden_at?: string | null;
  image_content_url?: string | null;
  image_caption?: string | null;
}


export interface AdminPost {
  id: string;
  owner_id: string;
  author_name?: string | null;
  mime_type: string;
  created_at: string;
  hidden_at?: string | null;
  post_caption?: string | null;
  post_tags?: string | null;
  location?: string | null;
  like_count?: number;
  comment_count?: number;
  share_count?: number;
  content_url?: string | null;
}

export interface AdminChatMessage {
  id: string;
  channel: 'lobby' | 'dm' | 'match' | 'group' | string;
  sender_id: string;
  sender_name?: string | null;
  recipient_id?: string | null;
  recipient_name?: string | null;
  body: string;
  created_at: string;
  attachment_id?: string | null;
  attachment_url?: string | null;
  attachment_mime?: string | null;
}

export interface AdminCard {
  id: string;
  creator_id: string;
  media_object_id: string;
  name?: string | null;
  rarity: string;
  value: number;
  like_count: number;
  market_status: string;
  moderation_state: 'active' | 'hidden' | 'banned' | string;
  owner_id?: string | null;
  owner_name?: string | null;
  mime_type?: string | null;
  caption?: string | null;
  content_url?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdminRoom {
  id: string;
  name: string;
  owner_name?: string | null;
  status: string;
  phase: string;
  player_count: number;
  capacity: number;
  updated_at: string;
}

export interface AdminBabecockEntry {
  id: string;
  user_id: string;
  user_name?: string | null;
  content_url: string;
  mime_type: string;
  caption?: string | null;
  grid_position?: number | null;
}

export interface AdminBabecockRound {
  id: string;
  host_name?: string | null;
  status: string;
  entry_count: number;
  grid_size: number;
  updated_at: string;
  entries?: AdminBabecockEntry[];
}

export interface AdminAuditEntry {
  id: string;
  admin_id: string;
  admin_name?: string | null;
  action: string;
  target_id?: string | null;
  target_type?: string | null;
  reason?: string | null;
  created_at: string;
}

export interface AdminDailyStat {
  date: string;
  active_users: number;
  matches_played: number;
  peak_concurrent: number;
  new_users: number;
  banned_users: number;
  reports_opened: number;
}

export interface DashboardStats {
  users: number;
  online_users: number;
  banned_users: number;
  admins: number;
  objects: number;
  stories: number;
  lobby_images?: number;
  queue_waiting: number;
  in_session: number;
  active_matches: number;
  active_tier_matches: number;
  pending_reports: number;
  pending_recommendations: number;
  active_announcements: number;
  offline_users_pending_deletion?: number;
  recent_objects?: AdminObject[];
}

export type TabId =
  | "dashboard"
  | "live"
  | "matches"
  | "match_archive"
  | "special_matches"
  | "game_ops"
  | "objects"
  | "posts"
  | "lobby_images"
  | "users"
  | "reports"
  | "announcements"
  | "recommendations"
  | "lobby_comments"
  | "chat"
  | "cards_economy"
  | "audit_log"
  | "daily_stats"
  | "bot_setup"
  | "system"
  | "games"
  | "content"
  | "moderation"
  | "platform"
  | "economy"
  | "analytics"
  | "settings";

export type TabSection =
  | "Operations"
  | "System"
  | "Overview"
  | "Games"
  | "Content"
  | "Users"
  | "Moderation"
  | "Platform"
  | "Cards & Economy"
  | "Analytics"
  | "Settings";

export interface TabConfig {
  id: TabId;
  label: string;
  section: TabSection;
  icon: React.ComponentType<{ className?: string }>;
  badge?: (state: AdminState) => string | null;
  route?: string;
  description?: string;
}

export interface AdminState {
  stats: DashboardStats | null;
  liveUsers: AdminUser[];
  users: AdminUser[];
  matches: AdminMatch[];
  archivedMatches: AdminArchivedMatch[];
  archiveTotal: number;
  specialMatches: AdminTierMatch[];
  rooms: AdminRoom[];
  babecockRounds: AdminBabecockRound[];
  objects: AdminObject[];
  adminPosts: AdminPost[];
  lobbyImages: AdminLobbyImage[];
  reports: AdminReport[];
  announcementsList: Announcement[];
  recommendations: AdminRecommendation[];
  lobbyComments: AdminLobbyComment[];
  chatMessages: AdminChatMessage[];
  adminCards: AdminCard[];
  cardsTotal: number;
  wallets: Array<{ user_id: string; display_name?: string | null; balance: number; transaction_count: number }>;
  ledger: Array<{ id: string; user_id: string; display_name?: string | null; kind: string; delta: number; balance_after: number; created_at: string }>;
  decks: Array<{ id: string; owner_name?: string | null; name: string; game_id: string; card_count: number }>;
  marketListings: Array<{ id: string; card_id: string; seller_name?: string | null; price: number; status: string; name?: string | null }>;
  auditLog: AdminAuditEntry[];
  dailyStats: AdminDailyStat[];
}

export interface ColumnDef<T> {
  accessorKey: string;
  header: string;
  cell?: (value: unknown, row: T) => React.ReactNode;
  enableSorting?: boolean;
  enableFiltering?: boolean;
  filterFn?: (row: T, columnId: string, value: unknown) => boolean;
  size?: number;
  minSize?: number;
  maxSize?: number;
  mobile?: {
    label: string;
    render: (row: T) => React.ReactNode;
  };
}

export interface TableConfig<T> {
  columns: ColumnDef<T>[];
  fetchFn?: (params: TableParams) => Promise<TableResponse<T>>;
  rowActions?: RowAction<T>[];
  bulkActions?: BulkAction<T>[];
  defaultSort?: { column: string; direction: 'asc' | 'desc' };
  defaultFilters?: Record<string, unknown>;
  enableRowSelection?: boolean;
  virtualized?: boolean;
  rowHeight?: number;
}

export interface TableParams {
  page: number;
  pageSize: number;
  sort?: { column: string; direction: 'asc' | 'desc' };
  filters?: Record<string, unknown>;
  search?: string;
}

export interface TableResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface RowAction<T> {
  label: string;
  icon?: React.ComponentType<{ className?: string }> | ((row: T) => React.ComponentType<{ className?: string }>);
  variant?: 'default' | 'danger' | 'primary' | 'ghost' | ((row: T) => 'default' | 'danger' | 'primary' | 'ghost');
  onClick: (row: T) => void | Promise<void>;
  disabled?: (row: T) => boolean;
  hidden?: (row: T) => boolean;
}

export interface BulkAction<T> {
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  variant?: 'default' | 'danger' | 'primary';
  onClick: (rows: T[]) => void | Promise<void>;
  disabled?: (rows: T[]) => boolean;
}

export interface FilterConfig {
  key: string;
  label: string;
  type: 'text' | 'select' | 'multi-select' | 'date-range' | 'number' | 'boolean';
  options?: Array<{ value: string; label: string }>;
  placeholder?: string;
  defaultValue?: unknown;
}

export interface AdminApiError {
  error: string;
  status: number;
}

export type OptimisticUpdate<T> = {
  type: 'create' | 'update' | 'delete';
  entity: string;
  id: string;
  previousData?: T;
  newData?: T;
  timestamp: number;
};

export interface WebSocketMessage {
  type: 'stats_update' | 'match_update' | 'report_update' | 'user_update' | 'chat_message';
  payload: unknown;
  timestamp: number;
}

export type { Announcement, OrbitIdentity };