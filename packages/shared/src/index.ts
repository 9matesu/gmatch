export type OrbitId = string;

export type LikeDecision = 'like' | 'reject' | 'pass';

export const MAX_TAGS = 5;
export const MAX_TAG_LENGTH = 20;

export const TAG_BLACKLIST = [
  'zoo', 'zoophilia', 'bestiality', 'beastiality',
  'nl', 'noncon', 'non-con', 'rape',
  'lolicon', 'shotacon', 'loli', 'shota',
  'cp', 'cub', 'underage', 'minor', 'pedo', 'pedophile'
] as const;

export function isBlacklistedTag(tag: string): boolean {
  if (!tag) return false;
  const clean = tag.trim().toLowerCase().replace(/^#/, '').replace(/[^a-z0-9_-]/g, '');
  return TAG_BLACKLIST.some(b => clean === b || clean.startsWith(`${b}_`) || clean.endsWith(`_${b}`) || clean === b);
}

/**
 * Generate a friendly fallback name from an OrbitId.
 * Uses the first 6 chars of the ID (which is a SHA256 hex) to create
 * a readable "User_abc123" style name instead of "Unknown User".
 */
export function generateFallbackName(orbitId: string): string {
  if (!orbitId) return 'User_unknown';
  const short = orbitId.slice(0, 6).toLowerCase();
  return `User_${short}`;
}

export function isDefaultPeerName(name?: string | null): boolean {
  if (!name || !name.trim()) return true;
  const n = name.trim();
  return /^user[-_].*/i.test(n) || n.toLowerCase() === 'user' || n.toLowerCase() === 'unknown user' || n.toLowerCase() === 'anonymous';
}

export function checkBlacklistedTags(raw: (string | null | undefined)[]): { hasBlacklisted: boolean; blockedTags: string[] } {
  const blocked: string[] = [];
  for (const entry of raw) {
    if (!entry) continue;
    const parts = entry.split(',').map(p => p.trim().toLowerCase().replace(/^#/, '').replace(/[^a-z0-9_-]/g, '')).filter(Boolean);
    for (const part of parts) {
      if (isBlacklistedTag(part) && !blocked.includes(part)) {
        blocked.push(part);
      }
    }
  }
  return { hasBlacklisted: blocked.length > 0, blockedTags: blocked };
}

/**
 * Single normalization rule for tags shared by the web client and the API.
 * Trims, lowercases, strips anything outside [a-z0-9_-], splits comma lists,
 * drops empties, dedupes, then caps at MAX_TAGS tags of at most
 * MAX_TAG_LENGTH characters.
 */
export function normalizeTags(raw: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    if (!entry) continue;
    const parts = entry
      .split(',')
      .map(p => p.trim().toLowerCase().replace(/^#/, '').replace(/[^a-z0-9_-]/g, ''))
      .filter(Boolean);
    for (const part of parts) {
      const t = part.slice(0, MAX_TAG_LENGTH);
      if (t && !seen.has(t) && !isBlacklistedTag(t) && out.length < MAX_TAGS) {
        seen.add(t);
        out.push(t);
      }
    }
  }
  return out;
}

export function parseTags(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return normalizeTags(raw.map(x => (typeof x === 'string' ? x : String(x ?? ''))));
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return normalizeTags(parsed.map(x => (typeof x === 'string' ? x : String(x ?? ''))));
      }
    } catch {}
    return normalizeTags([raw]);
  }
  return [];
}

// ─── Economy / cashout ──────────────────────────────────────────────
// Card cashout converts a card's canonical value into g$ at an admin-controlled
// inflation rate. The rate is stored in basis points (1 bps = 0.01%), so 10000
// = 100%, 12500 = 125%. The server always clamps to these bounds and never
// trusts a client-supplied rate.
export const DEFAULT_CASHOUT_RATE_BPS = 12500;
export const MIN_CASHOUT_RATE_BPS = 5000;
export const MAX_CASHOUT_RATE_BPS = 50000;

/** Clamp a raw rate (bps) into the legal range, defaulting when invalid. */
export function clampCashoutRateBps(rateBps: number | null | undefined): number {
  if (rateBps === null || rateBps === undefined) return DEFAULT_CASHOUT_RATE_BPS;
  const n = Math.floor(Number(rateBps));
  if (!Number.isFinite(n)) return DEFAULT_CASHOUT_RATE_BPS;
  return Math.min(MAX_CASHOUT_RATE_BPS, Math.max(MIN_CASHOUT_RATE_BPS, n));
}

/** Compute the g$ payout for a card of `value` at the given rate (bps). */
export function computeCashoutPayout(value: number, rateBps: number): number {
  const v = Math.max(0, Math.floor(Number(value) || 0));
  const r = clampCashoutRateBps(rateBps);
  return Math.floor((v * r) / 10000);
}

/** Format a g$ amount with thousands separators. */
export function formatGc(amount: number | null | undefined): string {
  return `g$ ${Math.max(0, Math.floor(Number(amount) || 0)).toLocaleString('en-US')}`;
}

export interface User {
  id: OrbitId;
  publicKey: string;
  encryptionPubKey?: string;
  createdAt: string;
  display_name?: string;
  tags?: string[];
  pfp_url?: string;
  last_seen?: string;
  online?: boolean;
  attention?: boolean;
  objects_sent_count?: number;
  gacha_downloads_received?: number;
  gacha_items_collected?: number;
  score?: number;
  maximum_gooner?: boolean;
  /** PC Domination: user has opted in to remote control features */
  pc_domination_enabled?: boolean;
  /** PC Domination: JSON settings object for fine-grained consent */
  pc_domination_settings?: Record<string, any>;
  likes_given?: number;
  likes_received?: number;
  matches_total?: number;
  /** Today's leaderboard/activity score (reset daily). Alias for `score`. */
  daily_score?: number;
  /** Persistent reputation (never reset by daily maintenance). */
  reputation?: number;
  /** g$ wallet balance (exposed to the caller only). */
  balance?: number;
  /** League-rank breakdown: stored on LeagueRank, denormalised onto the
   *  public directory payload for the leaderboard UI. */
  matches_won?: number;
  matches_lost?: number;
  /** goonMatch profile extras (migration 017) */
  bio?: string;
  website?: string;
  followers_count?: number;
  following_count?: number;
  posts_count?: number;
  is_private?: boolean;
}

export interface Relationship {
  user: User;
  matches: number;
  tier: number;
  tierColor: string;
  tierLabel: string;
  last_match_at?: string;
}

export interface RelationshipResponse {
  relationships: Relationship[];
  stats: {
    likes_given: number;
    likes_received: number;
    matches_total: number;
    score: number;
  };
}

export const TIER_RARITY = [
  '',
  'Acquaintance',
  'Friend',
  'Regular',
  'Preferred',
  'Special',
  'Elite',
  'Rare',
  'Ultra',
  'Legendary',
  'Mythic',
] as const;

export function tierForMatches(matches: number): number {
  const m = Math.max(0, Math.floor(matches));
  return Math.floor((Math.sqrt(8 * m + 1) - 1) / 2);
}

export function tierColor(tier: number): string {
  if (tier <= 0) return '#3b82f6';
  if (tier === 1) return '#0284c7';
  if (tier === 2) return '#06b6d4';
  if (tier === 3) return '#10b981';
  if (tier === 4) return '#84cc16';
  if (tier === 5) return '#eab308';
  if (tier === 6) return '#f97316';
  return '#ef4444';
}

export function tierLabel(tier: number): string {
  if (tier <= 0) return 'Unranked';
  if (tier <= 10) return TIER_RARITY[tier];
  return `Divine Tier ${tier}`;
}

export interface OrbitObject {
  id: string;
  owner_id: OrbitId;
  size_bytes: number;
  mime_type: string;
  created_at: string;
  sender_pubkey?: string;
  sender_enc_pubkey?: string;
  is_favorited?: number;
  caption?: string;
  content_url?: string;
  is_story?: number;
  is_public?: number;
  gacha_downloads_count?: number;
  display_name?: string;
  pfp_url?: string | null;
  expires_at?: string;
}

export interface Friend {
  id: OrbitId;
  public_key: string;
  encryption_pub_key?: string;
}

export interface FriendRequest {
  id: string;
  sender_id: OrbitId;
  receiver_id?: OrbitId;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
  sender_name?: string;
}

export interface UploadResponse {
  id: string;
  size: number;
  type?: string;
  recipients?: number;
}

export interface ApiError {
  error: string;
}

export interface Announcement {
  id: string;
  message: string;
  created_by: string;
  created_at: string;
  created_by_name?: string | null;
  is_active?: number;
}

export interface Recommendation {
  id: string;
  user_id: string;
  category: 'Feature' | 'UI' | 'Idea' | 'Bug';
  content: string;
  status: 'pending' | 'reviewed' | 'resolved';
  created_at: string;
  user_name?: string | null;
}

export interface StoreItem {
  id: string;
  name: string;
  desc: string;
  category: 'perk' | 'badge' | 'title' | 'pack' | 'hack';
  cost: number;
  icon: string;
  badge?: string;
  /** Consumable items stack in the user's inventory and are consumed on use. */
  consumable?: boolean;
}

export interface ActiveHackDebuff {
  id: string;
  type: 'deny' | 'takeover' | 'mobile_virus';
  attacker_id: string;
  attacker_name?: string;
  target_id: string;
  target_name?: string;
  created_at: number;
  expires_at: number;
}

export const STORE_ITEMS: StoreItem[] = [
  { id: 'item-hack-takeover', name: 'Profile Takeover', desc: 'Overwrites the target player\'s profile with your custom hacker banner, title, and status for 15 minutes.', category: 'hack', cost: 3500, icon: 'Skull', badge: 'TAKEOVER', consumable: true },
  { id: 'item-hack-mobile', name: 'Mobile Cyber Virus', desc: 'Triggers a chaotic 1-minute full-screen flashing slideshow virus lock with audio on the target player.', category: 'hack', cost: 4500, icon: 'Flame', badge: 'VIRUS', consumable: true },
  { id: 'item-hack-deny', name: 'Deny: Vision Jammer', desc: 'Blurs all image cards on the page for the target player for 5 minutes.', category: 'hack', cost: 800, icon: 'EyeOff', badge: 'HACK', consumable: true },
  { id: 'item-flash-drop', name: 'Flash Drop Broadcast', desc: 'Instantly broadcasts your chosen photo to everyone online for 5 seconds. Liking one counts as a normal like.', category: 'hack', cost: 1000, icon: 'Zap', badge: 'ABILITY', consumable: true },
  { id: 'item-lootbox-celebrity', name: 'Celebrity Stars Mystery Box', desc: 'Opens a celebrity-tier luxury lootbox containing rare pop-culture, idol, and celebrity cards.', category: 'pack', cost: 350, icon: 'Sparkles', badge: 'CELEB', consumable: true },
  { id: 'item-pack-rare', name: 'Holo Rare Vault Pack', desc: 'Opens a 3-card pack guaranteed to contain Rare or Epic holographic cards with high trade valuation.', category: 'pack', cost: 250, icon: 'Sparkles', badge: 'HOLO', consumable: true },
  { id: 'item-pack-cyber', name: 'Cyber Mythic Lootbox', desc: 'Opens a 5-card luxury lootbox with guaranteed Epic and Legendary tier duel cards.', category: 'pack', cost: 500, icon: 'Box', badge: 'MYTHIC', consumable: true },
];

/** One-time flash broadcast shown to every online user for ~5 seconds. */
export interface FlashEvent {
  id: string;
  owner_id: string;
  owner_name?: string | null;
  pfp_url?: string | null;
  content_url: string;
  mime_type: string;
  likes_count: number;
  created_at: string;
  expires_at: string;
  liked_by_me?: boolean;
}

export interface BabecockEntry {
  id: string;
  round_id: string;
  user_id: string;
  display_name?: string | null;
  pfp_url?: string | null;
  content_url: string;
  mime_type: string;
  caption?: string | null;
  created_at: string;
  grid_position?: number | null;
}

export interface BabecockRound {
  id: string;
  host_id: string;
  host_name?: string | null;
  host_pfp_url?: string | null;
  status: 'open' | 'closed';
  phase_deadline: number;
  gallery_expires_at?: string | null;
  created_at: string;
  grid_size?: number;
  entries: BabecockEntry[];
  my_entry?: string | null;
}

export interface BabecockPlacement {
  entry_id: string;
  grid_position: number;
}

/**
 * Babecock invite: a host pings a specific user to draw their attention to the
 * currently-open round. The round is still globally joinable — the invite is
 * purely a one-click "Join" affordance for the recipient.
 *
 * Lifecycle:
 *   - `open`    recipient hasn't acted yet, round still running
 *   - `accepted` recipient joined the round
 *   - `declined` recipient explicitly dismissed the invite
 *   - `expired`   round closed before recipient acted (set by advance tick)
 */
export type BabecockInviteStatus = 'open' | 'accepted' | 'declined' | 'expired';

export interface BabecockInvite {
  id: string;
  round_id: string;
  host_id: string;
  host_name?: string | null;
  host_pfp_url?: string | null;
  invitee_id: string;
  status: BabecockInviteStatus;
  created_at: string;
}

export * from './lobby';
export * from './card-valuation';
export * from './booru';

/** PC Domination action log entry */
export interface DominationAction {
  id: string;
  dominator_id: string;
  victim_id: string;
  action: 'wallpaper' | 'game_bg' | 'popup_video' | 'message' | 'text_overlay' | 'blur' | 'camera';
  payload?: Record<string, any>;
  status: 'sent' | 'executed' | 'failed' | 'denied';
  created_at: string;
  executed_at?: string;
}
