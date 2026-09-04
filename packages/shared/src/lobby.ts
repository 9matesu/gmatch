export const SPECIAL_MATCH_IDLE_SECONDS = 180;

// Flash Drop power-up: the broadcast image stays live briefly so late likes
// still count (they hit the normal like system), but the on-screen popup is
// only shown for a few seconds.
export const FLASH_POPUP_SECONDS = 5;
export const FLASH_TTL_SECONDS = 120;

// Babecock minigame: a single open round where a host posts the OP picture and
// others join with their own. Rounds last up to 2 minutes; finished rounds
// appear in the Babecock gallery for 1 hour.
export const BABECOCK_ROUND_SECONDS = 180;
export const BABECOCK_GALLERY_SECONDS = 60 * 60;

// 1v1 game lobby cadences (server-driven deadlines, broadcast to the pair)
export const LOBBY_LOBBY_SECONDS = 10;
export const LOBBY_PICK_SECONDS = 60;
export const LOBBY_REVEAL_SECONDS = 4;
export const LOBBY_DECIDE_SECONDS = 45;
export const LOBBY_ROUND_RESULT_SECONDS = 3;

// Lifecycle cadences: everything is transient by design. All pictures/cards are
// wiped every few hours, lobby chat is capped at 12 hours (server + client agree,
// "clears every 12 hours"), and stories last half a day.
// Lifecycle cadences: everything ephemeral shifts on a 7-hour dynamic cycle.
// Stories and active lobby images last 7 hours, while cards/portfolios persist eternally.
// Lobby chat is capped at 12 hours.
export const PICTURE_WIPE_SECONDS = 7 * 60 * 60;
export const CHAT_WIPE_SECONDS = 12 * 60 * 60;
export const STORY_TTL_SECONDS = 7 * 60 * 60;
export const PICTURE_TTL_SECONDS = 7 * 60 * 60;

export const OFFLINE_DELETION_SECONDS = 3 * 24 * 60 * 60;
export const OFFLINE_WARNING_SECONDS = 2 * 24 * 60 * 60;

// Special match ladder: a mutual like climbs a level, the third (final) mutual
// like pays out big and ends the match. Any non-mutual decision ends it.
export const SPECIAL_MAX_TIER = 3;
export const SPECIAL_TIER_POINTS = 25;
export const SPECIAL_FINAL_POINTS = 200;
export const SPECIAL_TIER_LINES: string[] = [
  'Sink deeper',
  'Filthier!',
  'Lose your limits.',
];

export function specialTierLine(tier: number): string {
  const line = SPECIAL_TIER_LINES[tier - 1];
  return line || SPECIAL_TIER_LINES[SPECIAL_TIER_LINES.length - 1];
}

export const MATCH_MAX_ROUNDS = 5;

/** Minimum number of owned, non-story cards required to queue or duel. */
export const MIN_GAME_CARDS = 5;

type OrbitId = string;

export type LobbyStatus = 'waiting' | 'active';

export type LobbyPlayerStatus = 'waiting' | 'in_match' | 'in_session' | 'idle';

export type LobbyDecision = 'like' | 'reject' | 'boost';

export type GameMatchStatus = 'lobby' | 'playing' | 'ended';

export type GameMatchPhase = 'lobby' | 'pick' | 'reveal' | 'decide' | 'round_result' | 'result';

export interface RoundHistoryItem {
  round: number;
  card_a?: string | null;
  card_b?: string | null;
  card_a_url?: string | null;
  card_b_url?: string | null;
  decision_a?: LobbyDecision | null;
  decision_b?: LobbyDecision | null;
  matched: boolean;
  result?: string | null;
}

export interface GameMatch {
  id: string;
  user_a: OrbitId;
  user_b: OrbitId;
  status: GameMatchStatus;
  phase: GameMatchPhase;
  round_seq: number;
  max_rounds: number;
  score_a: number;
  score_b: number;
  card_a?: string | null;
  card_b?: string | null;
  decision_a?: LobbyDecision | null;
  decision_b?: LobbyDecision | null;
  played_cards_a?: string | null;
  played_cards_b?: string | null;
  rounds_history?: string | null;
  forfeit_user?: string | null;
  matched?: number;
  result?: string | null;
  phase_deadline: number;
  phase_version: number;
  created_at?: string;
  updated_at?: string;
}

import type { MatchValuationSummary } from './card-valuation';

// Per-user, information-safe snapshot pushed to clients (opponent's card stays
// hidden until the reveal phase; the engine only reveals it server-side then).
export interface MatchSnapshot {
  id: string;
  phase: GameMatchPhase;
  status: GameMatchStatus;
  round_seq: number;
  max_rounds: number;
  score_mine: number;
  score_opponent: number;
  rounds_history: RoundHistoryItem[];
  played_cards: string[];
  phase_deadline: number;
  my_card: string | null;
  my_decided: boolean;
  my_decision?: LobbyDecision | null;
  boosts_remaining?: number;
  valuation_summary?: MatchValuationSummary | null;
  opponent: { id: OrbitId; display_name?: string | null; pfp_url?: string | null };
  opponent_card: string | null;
  opponent_played: boolean;
  opponent_decided: boolean;
  opponent_decision?: LobbyDecision | null;
  matched: boolean;
  result?: string | null;
  forfeit_user?: string | null;
  quit_user_id?: string | null;
  is_spectating?: boolean;
  user_a_info?: { id: OrbitId; display_name?: string | null; pfp_url?: string | null; card?: string | null; decided?: boolean; decision?: LobbyDecision | null; score?: number };
  user_b_info?: { id: OrbitId; display_name?: string | null; pfp_url?: string | null; card?: string | null; decided?: boolean; decision?: LobbyDecision | null; score?: number };
}

export interface LiveMatchSummary {
  id: string;
  round_seq: number;
  max_rounds: number;
  phase: GameMatchPhase;
  status: GameMatchStatus;
  phase_deadline: number;
  user_a: { id: OrbitId; display_name?: string | null; pfp_url?: string | null; score: number };
  user_b: { id: OrbitId; display_name?: string | null; pfp_url?: string | null; score: number };
}

export type MatchAction =
  | 'opened'
  | 'phase'
  | 'round_advance'
  | 'round_result'
  | 'opponent_played'
  | 'reveal'
  | 'decided'
  | 'result'
  | 'opponent_left'
  | 'forfeit'
  | 'cancelled';

export interface MatchEvent {
  type: 'match';
  action: MatchAction;
  match: MatchSnapshot;
}

export interface ChatMessage {
  id: string;
  match_id: string;
  sender_id: string;
  sender_name: string | null;
  body: string;
  created_at: string;
}

export interface ChatEvent {
  type: 'chat';
  action: 'new';
  match_id: string;
  message: ChatMessage;
}

export interface LobbyPlayer {
  user_id: OrbitId;
  status: LobbyPlayerStatus;
  auto_queue?: boolean;
  active_match_id?: string | null;
  in_match_round?: number | null;
  joined_at: string;
  waiting_since?: string | null;
  display_name?: string | null;
  pfp_url?: string | null;
  tags?: string[] | string | null;
}

export interface LobbyState {
  status: LobbyStatus;
  waiting_count: number;
  fallback_starts_in_ms?: number | null;
  auto_queue?: boolean;
  players: LobbyPlayer[];
  match?: MatchSnapshot | null;
  active_matches?: LiveMatchSummary[];
}

export interface LobbyImage {
  id: string;
  owner_id: OrbitId;
  content_url: string;
  mime_type?: string;
  caption?: string;
  tags?: string | string[] | null;
  likes_count: number;
  created_at: string;
  expires_at: string;
  uploader_name?: string | null;
  reports_count?: number;
  hidden_at?: string | null;
  is_proxied?: number;
  proxied_mime?: string | null;
}

/** A user-facing comment on a lobby tile (mini-social media thread). */
export interface LobbyComment {
  id: string;
  image_id: string;
  user_id: string;
  body: string;
  created_at: string;
  display_name?: string | null;
}

export type TierMatchResult = 'both_like' | 'ended' | 'quit' | 'expired' | null;

export interface TierMatch {
  id: string;
  user_a: OrbitId;
  user_b: OrbitId;
  status: 'active' | 'ended';
  tier: number;
  card_a?: string | null;
  card_b?: string | null;
  decision_a?: LobbyDecision | null;
  decision_b?: LobbyDecision | null;
  last_result?: TierMatchResult;
  last_card_a?: string | null;
  last_card_b?: string | null;
  created_at?: string;
  updated_at?: string;
  opponent_id: OrbitId;
  opponent_name?: string;
}

export interface SpecialMatchesResponse {
  active: TierMatch[];
  recent: TierMatch[];
}

// ---------------------------------------------------------------------------
// Room-based mini-tournament
// ---------------------------------------------------------------------------

export const ROOM_START_SECONDS = 45;
export const ROOM_MAX_PLAYERS = 4;
export const ROOM_MIN_PLAYERS = 2;
export const ROOM_MAX_ROUNDS = 6;
export const LEAGUE_CHAMPION_POINTS = 50;
export const LEAGUE_MATCH_POINTS = 5;

export type RoomStatus = 'open' | 'countdown' | 'live' | 'ended';
export type RoomPhase = 'waiting' | 'countdown' | 'pick' | 'reveal' | 'decide' | 'result' | 'ended';
export type RoomPlayerStatus = 'joined' | 'eliminated' | 'champion';
export type RoomPairStatus = 'pending' | 'playing' | 'done' | 'byepass';

export interface RoomMember {
  user_id: OrbitId;
  status: RoomPlayerStatus;
  display_name?: string | null;
  pfp_url?: string | null;
}

export interface RoomPair {
  id: string;
  room_id: string;
  round_seq: number;
  user_a: OrbitId;
  user_b: OrbitId;
  card_a?: string | null;
  card_b?: string | null;
  decision_a?: LobbyDecision | null;
  decision_b?: LobbyDecision | null;
  matched?: number;
  pair_deadline?: number | null;
  status: RoomPairStatus;
}

export interface MatchRoom {
  id: string;
  name: string;
  owner_id: OrbitId;
  status: RoomStatus;
  phase: RoomPhase;
  capacity: number;
  round_seq: number;
  tags: string[];
  created_at: string;
  updated_at?: string;
  members: Omit<RoomMember, 'status'>[];
  member_count: number;
  eliminated_count?: number;
  champions?: Omit<RoomMember, 'status'>[];
  pair_deadline?: number | null;
}

export interface MatchCard {
  id: string;
  room_id: string;
  owner_id: OrbitId;
  content_url: string;
  created_at: string;
}

export interface RoomSnapshot {
  id: string;
  name: string;
  status: RoomStatus;
  phase: RoomPhase;
  round_seq: number;
  pair_deadline: number | null;
  members: RoomMember[];
  champions: RoomMember[];
  pairs: Array<{
    id: string;
    round_seq: number;
    player_icons: Array<{ user_id: OrbitId; display_name?: string | null; pfp_url?: string | null }>;
    card_urls: Array<string | null>;
    has_card: boolean[];
    decided: boolean[];
    matched: boolean;
    status: RoomPairStatus;
  }>;
}

export interface LeagueEntry {
  user_id: OrbitId;
  display_name?: string | null;
  wins: number;
  points: number;
  tier: number;
}
