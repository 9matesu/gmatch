import { orbitFetch } from "./api";
import type { OrbitIdentity } from "@orbit/crypto";
import type {
  AdminUser,
  AdminMatch,
  AdminArchivedMatch,
  AdminTierMatch,
  AdminObject,
  AdminLobbyImage,
  AdminReport,
  AdminRecommendation,
  AdminLobbyComment,
  AdminPost,
  AdminChatMessage,
  AdminCard,
  AdminRoom,
  AdminBabecockRound,
  AdminAuditEntry,
  AdminDailyStat,
  DashboardStats,
  TableParams,
  TableResponse,
  Announcement,
} from "./adminTypes";

const ADMIN_BASE = "/api/admin";

function tableResponse<T>(body: TableResponse<T> | T[] | { data?: T[]; matches?: T[]; total?: number } | unknown, params: TableParams): TableResponse<T> {
  if (Array.isArray(body)) {
    return { data: body as T[], total: body.length, page: params.page, pageSize: params.pageSize };
  }
  if (body && typeof body === "object") {
    const rawObj = body as { data?: T[]; matches?: T[]; total?: unknown; page?: unknown; pageSize?: unknown };
    const rows = Array.isArray(rawObj.data) ? rawObj.data : Array.isArray(rawObj.matches) ? rawObj.matches : [];
    const total = Number(rawObj.total);
    return {
      data: rows,
      total: Number.isFinite(total) ? total : rows.length,
      page: Number(rawObj.page) || params.page,
      pageSize: Number(rawObj.pageSize) || params.pageSize,
    };
  }
  return { data: [] as T[], total: 0, page: params.page, pageSize: params.pageSize };
}

function dataArray<T>(body: T[] | { data?: T[]; matches?: T[] } | unknown): T[] {
  if (Array.isArray(body)) return body;
  if (body && typeof body === "object") {
    const rawObj = body as { data?: T[]; matches?: T[] };
    if (Array.isArray(rawObj.data)) return rawObj.data;
    if (Array.isArray(rawObj.matches)) return rawObj.matches;
  }
  return [];
}

async function fetchJson<T>(
  endpoint: string,
  identity: OrbitIdentity,
  options: RequestInit = {}
): Promise<T> {
  const res = await orbitFetch(endpoint, options, identity);
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(error.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

async function fetchTable<T>(
  endpoint: string,
  identity: OrbitIdentity,
  params: TableParams,
  options: RequestInit = {}
): Promise<TableResponse<T>> {
  const res = await orbitFetch(endpoint, options, identity);
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(error.error || `Request failed: ${res.status}`);
  }
  const total = Number(res.headers.get("X-Total-Count") || "0");
  const body = await res.json() as TableResponse<T> | T[];
  const normalized = tableResponse<T>(body, params);
  return { ...normalized, total: total || normalized.total };
}

async function fetchArray<T>(
  endpoint: string,
  identity: OrbitIdentity,
  options: RequestInit = {}
): Promise<T[]> {
  const body = await fetchJson<T[] | { data?: T[] } | unknown>(endpoint, identity, options);
  return dataArray<T>(body);
}

function parseSortParams(params: TableParams): { sort?: string; order?: string } {
  if (params.sort) {
    return { sort: params.sort.column, order: params.sort.direction };
  }
  const filterSort = params.filters?.sort;
  if (typeof filterSort === "string" && filterSort.trim()) {
    const trimmed = filterSort.trim();
    if (trimmed.startsWith("-")) {
      return { sort: trimmed.slice(1), order: "asc" };
    }
    return { sort: trimmed, order: "desc" };
  }
  return {};
}

export const adminApi = {
  dashboard: (identity: OrbitIdentity) =>
    fetchJson<DashboardStats>(`${ADMIN_BASE}/dashboard`, identity),

  live: (identity: OrbitIdentity) =>
    fetchArray<AdminUser>(`${ADMIN_BASE}/live`, identity),

  users: (identity: OrbitIdentity, params: TableParams) => {
    const searchParams = new URLSearchParams();
    searchParams.set("limit", String(params.pageSize));
    searchParams.set("offset", String((params.page - 1) * params.pageSize));
    const sortInfo = parseSortParams(params);
    if (sortInfo.sort) {
      searchParams.set("sort", sortInfo.sort);
      searchParams.set("order", sortInfo.order || "desc");
    }
    if (params.filters?.q) searchParams.set("q", String(params.filters.q));
    if (params.filters?.role) searchParams.set("role", String(params.filters.role));
    if (params.filters?.status) searchParams.set("status", String(params.filters.status));
    return fetchTable<AdminUser>(`${ADMIN_BASE}/users?${searchParams}`, identity, params);
  },

  matches: (identity: OrbitIdentity) =>
    fetchArray<AdminMatch>(`${ADMIN_BASE}/matches`, identity),

  matchArchive: (identity: OrbitIdentity, params: TableParams) => {
    const searchParams = new URLSearchParams();
    searchParams.set("limit", String(params.pageSize));
    searchParams.set("offset", String((params.page - 1) * params.pageSize));
    if (params.filters?.q) searchParams.set("q", String(params.filters.q));
    if (params.filters?.result) searchParams.set("result", String(params.filters.result));
    if (params.filters?.matched) searchParams.set("matched", String(params.filters.matched));
    return fetchTable<AdminArchivedMatch>(`${ADMIN_BASE}/matches/archive?${searchParams}`, identity, params);
  },

  specialMatches: (identity: OrbitIdentity) =>
    fetchArray<AdminTierMatch>(`${ADMIN_BASE}/special-matches`, identity),

  rooms: (identity: OrbitIdentity) =>
    fetchArray<AdminRoom>(`${ADMIN_BASE}/rooms`, identity),

  babecock: (identity: OrbitIdentity) =>
    fetchArray<AdminBabecockRound>(`${ADMIN_BASE}/babecock`, identity),

  objects: (identity: OrbitIdentity, params: TableParams) => {
    const searchParams = new URLSearchParams();
    searchParams.set("limit", String(params.pageSize));
    searchParams.set("offset", String((params.page - 1) * params.pageSize));
    const sortInfo = parseSortParams(params);
    if (sortInfo.sort) {
      searchParams.set("sort", sortInfo.sort);
      searchParams.set("order", sortInfo.order || "desc");
    }
    if (params.filters?.q) searchParams.set("q", String(params.filters.q));
    if (params.filters?.owner) searchParams.set("owner", String(params.filters.owner));
    if (params.filters?.type) searchParams.set("type", String(params.filters.type));
    return fetchTable<AdminObject>(`${ADMIN_BASE}/objects?${searchParams}`, identity, params);
  },

  userObjects: (identity: OrbitIdentity, userId: string) =>
    fetchArray<AdminObject>(`${ADMIN_BASE}/users/${userId}/objects`, identity),

  posts: (identity: OrbitIdentity, params: TableParams) => {
    const searchParams = new URLSearchParams();
    searchParams.set("limit", String(params.pageSize));
    searchParams.set("offset", String((params.page - 1) * params.pageSize));
    if (params.filters?.visibility) searchParams.set("visibility", String(params.filters.visibility));
    if (params.filters?.q) searchParams.set("q", String(params.filters.q));
    return fetchTable<AdminPost>(`${ADMIN_BASE}/posts?${searchParams}`, identity, params);
  },

  lobbyImages: (identity: OrbitIdentity) =>
    fetchArray<AdminLobbyImage>(`${ADMIN_BASE}/lobby-images`, identity),

  reports: (identity: OrbitIdentity, params: TableParams) => {
    const searchParams = new URLSearchParams();
    searchParams.set("limit", String(params.pageSize));
    searchParams.set("offset", String((params.page - 1) * params.pageSize));
    if (params.filters?.q) searchParams.set("q", String(params.filters.q));
    if (params.filters?.status) searchParams.set("status", String(params.filters.status));
    if (params.filters?.category) searchParams.set("category", String(params.filters.category));
    return fetchTable<AdminReport>(`${ADMIN_BASE}/content-reports?${searchParams}`, identity, params);
  },

  announcements: (identity: OrbitIdentity) =>
    fetchArray<Announcement>(`${ADMIN_BASE}/announcements`, identity),

  recommendations: (identity: OrbitIdentity) =>
    fetchArray<AdminRecommendation>(`${ADMIN_BASE}/recommendations`, identity),

  lobbyComments: (identity: OrbitIdentity) =>
    fetchArray<AdminLobbyComment>(`${ADMIN_BASE}/lobby-comments`, identity),

  chat: (identity: OrbitIdentity, params: TableParams) => {
    const searchParams = new URLSearchParams();
    searchParams.set("limit", String(params.pageSize));
    searchParams.set("offset", String((params.page - 1) * params.pageSize));
    searchParams.set("channel", String(params.filters?.channel || "all"));
    if (params.filters?.q) searchParams.set("q", String(params.filters.q));
    return fetchTable<AdminChatMessage>(`${ADMIN_BASE}/chat/messages?${searchParams}`, identity, params);
  },

  cards: async (identity: OrbitIdentity, params: TableParams): Promise<TableResponse<AdminCard>> => {
    const searchParams = new URLSearchParams();
    searchParams.set("limit", String(params.pageSize));
    searchParams.set("offset", String((params.page - 1) * params.pageSize));
    if (params.filters?.q) searchParams.set("q", String(params.filters.q));
    if (params.filters?.owner) searchParams.set("owner", String(params.filters.owner));
    if (params.filters?.moderation_state) searchParams.set("moderation_state", String(params.filters.moderation_state));
    const res = await orbitFetch(`${ADMIN_BASE}/cards?${searchParams}`, {}, identity);
    const total = Number(res.headers.get("X-Total-Count") || "0");
    const body = await res.json() as AdminCard[] | { data?: AdminCard[] };
    return { data: dataArray<AdminCard>(body), total, page: params.page, pageSize: params.pageSize };
  },

  wallets: (identity: OrbitIdentity, params: TableParams) => {
    const searchParams = new URLSearchParams();
    searchParams.set("limit", String(params.pageSize));
    if (params.filters?.q) searchParams.set("q", String(params.filters.q));
    return fetchTable<{ user_id: string; display_name?: string | null; balance: number; transaction_count: number }>(`${ADMIN_BASE}/economy/wallets?${searchParams}`, identity, params);
  },

  ledger: (identity: OrbitIdentity, params: TableParams) => {
    const searchParams = new URLSearchParams();
    searchParams.set("limit", String(params.pageSize));
    if (params.filters?.userId) searchParams.set("user_id", String(params.filters.userId));
    return fetchTable<{ id: string; user_id: string; display_name?: string | null; kind: string; delta: number; balance_after: number; created_at: string }>(`${ADMIN_BASE}/economy/ledger?${searchParams}`, identity, params);
  },

  decks: (identity: OrbitIdentity, params: TableParams) => {
    const searchParams = new URLSearchParams();
    searchParams.set("limit", String(params.pageSize));
    if (params.filters?.owner) searchParams.set("owner_id", String(params.filters.owner));
    return fetchTable<{ id: string; owner_name?: string | null; name: string; game_id: string; card_count: number }>(`${ADMIN_BASE}/decks?${searchParams}`, identity, params);
  },

  marketplace: (identity: OrbitIdentity, params: TableParams) => {
    const searchParams = new URLSearchParams();
    searchParams.set("limit", String(params.pageSize));
    if (params.filters?.status) searchParams.set("status", String(params.filters.status));
    return fetchTable<{ id: string; card_id: string; seller_name?: string | null; price: number; status: string; name?: string | null }>(`${ADMIN_BASE}/marketplace?${searchParams}`, identity, params);
  },

  auditLog: (identity: OrbitIdentity, limit = 200) =>
    fetchArray<AdminAuditEntry>(`${ADMIN_BASE}/audit-log?limit=${limit}`, identity),

  dailyStats: (identity: OrbitIdentity, days = 30) =>
    fetchArray<AdminDailyStat>(`${ADMIN_BASE}/daily-stats?days=${days}`, identity),

  banUser: (identity: OrbitIdentity, userId: string, reason: string, wipe = true, scope = "all") =>
    fetchJson<{ success: boolean; banId: string }>(`${ADMIN_BASE}/users/${userId}/ban`, identity, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason, wipe, scope }),
    }),

  unbanUser: (identity: OrbitIdentity, userId: string) =>
    fetchJson<{ success: boolean }>(`${ADMIN_BASE}/users/${userId}/unban`, identity, { method: "POST" }),

  toggleModerator: (identity: OrbitIdentity, userId: string, isModerator: boolean) =>
    fetchJson<{ success: boolean }>(`${ADMIN_BASE}/users/${userId}/moderator`, identity, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_moderator: isModerator }),
    }),

  adjustUser: (identity: OrbitIdentity, userId: string, data: Record<string, unknown>) =>
    fetchJson<{ success: boolean }>(`${ADMIN_BASE}/users/${userId}/adjust`, identity, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),

  deleteUser: (identity: OrbitIdentity, userId: string) =>
    fetchJson<{ success: boolean }>(`${ADMIN_BASE}/users/${userId}/delete`, identity, { method: "POST" }),

  editUserTags: (identity: OrbitIdentity, userId: string, tags: string[]) =>
    fetchJson<{ success: boolean; tags: string[] }>(`${ADMIN_BASE}/users/${userId}/tags`, identity, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags }),
    }),

  deleteObject: (identity: OrbitIdentity, objectId: string) =>
    fetchJson<{ success: boolean }>(`${ADMIN_BASE}/objects/${objectId}/delete`, identity, { method: "POST" }),

  redactObject: (identity: OrbitIdentity, objectId: string) =>
    fetchJson<{ success: boolean }>(`${ADMIN_BASE}/objects/${objectId}/redact`, identity, { method: "POST" }),

  deleteLobbyImage: (identity: OrbitIdentity, imageId: string) =>
    fetchJson<{ success: boolean }>(`${ADMIN_BASE}/lobby-images/${imageId}`, identity, { method: "DELETE" }),

  forceEndMatch: (identity: OrbitIdentity, matchId: string) =>
    fetchJson<{ success: boolean }>(`${ADMIN_BASE}/matches/${matchId}/end`, identity, { method: "POST" }),

  overrideMatchResult: (identity: OrbitIdentity, matchId: string, result: string) =>
    fetchJson<{ success: boolean }>(`${ADMIN_BASE}/matches/${matchId}/result`, identity, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ result }),
    }),

  cancelMatch: (identity: OrbitIdentity, matchId: string) =>
    fetchJson<{ success: boolean }>(`${ADMIN_BASE}/matches/${matchId}`, identity, { method: "DELETE" }),

  forceMatchup: (identity: OrbitIdentity) =>
    fetchJson<{ success: boolean }>(`${ADMIN_BASE}/matches/force-all`, identity, { method: "POST" }),

  endTierMatch: (identity: OrbitIdentity, matchId: string) =>
    fetchJson<{ success: boolean }>(`${ADMIN_BASE}/special-matches/${matchId}/end`, identity, { method: "POST" }),

  createAnnouncement: (identity: OrbitIdentity, message: string, isActive = true) =>
    fetchJson<{ success: boolean; id: string }>(`${ADMIN_BASE}/announcements`, identity, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, is_active: isActive }),
    }),

  deleteAnnouncement: (identity: OrbitIdentity, id: string) =>
    fetchJson<{ success: boolean }>(`${ADMIN_BASE}/announcements/${id}`, identity, { method: "DELETE" }),

  updateRecommendation: (identity: OrbitIdentity, id: string, status: string) =>
    fetchJson<{ success: boolean }>(`${ADMIN_BASE}/recommendations/${id}`, identity, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    }),

  deleteRecommendation: (identity: OrbitIdentity, id: string) =>
    fetchJson<{ success: boolean }>(`${ADMIN_BASE}/recommendations/${id}`, identity, { method: "DELETE" }),

  togglePostVisibility: (identity: OrbitIdentity, postId: string, hidden: boolean) =>
    fetchJson<{ ok: boolean }>(`${ADMIN_BASE}/posts/${postId}/visibility`, identity, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hidden }),
    }),

  deletePost: (identity: OrbitIdentity, postId: string) =>
    fetchJson<{ ok: boolean }>(`${ADMIN_BASE}/posts/${postId}`, identity, { method: "DELETE" }),

  moderateCard: (identity: OrbitIdentity, cardId: string, state: "active" | "hidden" | "banned", reason?: string) =>
    fetchJson<{ ok: boolean }>(`${ADMIN_BASE}/cards/${cardId}/moderation`, identity, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ moderation_state: state, reason }),
    }),

  deleteChatMessage: (identity: OrbitIdentity, channel: string, messageId: string) =>
    fetchJson<{ ok: boolean }>(`${ADMIN_BASE}/chat/messages/${channel}/${messageId}`, identity, { method: "DELETE" }),

  resolveReport: (identity: OrbitIdentity, reportId: string, action: "delete" | "ban" | "deny") =>
    fetchJson<{ ok: boolean }>(`${ADMIN_BASE}/content-reports/${reportId}/resolve`, identity, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    }),

  hideLobbyComment: (identity: OrbitIdentity, commentId: string) =>
    fetchJson<{ ok: boolean }>(`${ADMIN_BASE}/lobby-comments/${commentId}/hide`, identity, { method: "POST" }),

  unhideLobbyComment: (identity: OrbitIdentity, commentId: string) =>
    fetchJson<{ ok: boolean }>(`${ADMIN_BASE}/lobby-comments/${commentId}/unhide`, identity, { method: "POST" }),

  deleteLobbyComment: (identity: OrbitIdentity, commentId: string) =>
    fetchJson<{ ok: boolean }>(`${ADMIN_BASE}/lobby-comments/${commentId}`, identity, { method: "DELETE" }),

  closeRoom: (identity: OrbitIdentity, roomId: string) =>
    fetchJson<{ ok: boolean }>(`${ADMIN_BASE}/rooms/${roomId}/close`, identity, { method: "POST" }),

  closeBabecock: (identity: OrbitIdentity, roundId: string) =>
    fetchJson<{ ok: boolean }>(`${ADMIN_BASE}/babecock/${roundId}/close`, identity, { method: "POST" }),

  triggerCleanup: (identity: OrbitIdentity) =>
    fetchJson<{ success: boolean }>(`${ADMIN_BASE}/cleanup`, identity, { method: "POST" }),

  cleanAllPosts: (identity: OrbitIdentity) =>
    fetchJson<{ success: boolean }>(`${ADMIN_BASE}/database/clean-posts`, identity, { method: "POST" }),

  migrateLobbyToPosts: (identity: OrbitIdentity) =>
    fetchJson<{ success: boolean; migrated_count: number }>(`${ADMIN_BASE}/database/migrate-lobby-to-posts`, identity, { method: "POST" }),

  saveDiscordLink: (identity: OrbitIdentity, url: string) =>
    fetchJson<{ success: boolean }>(`${ADMIN_BASE}/settings/discord-invite`, identity, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    }),

  getDiscordLink: (identity: OrbitIdentity) =>
    fetchJson<{ url: string | null }>(`${ADMIN_BASE}/settings/discord-invite`, identity),

  saveCashoutRate: (identity: OrbitIdentity, rateBps: number) =>
    fetchJson<{ success: boolean }>(`${ADMIN_BASE}/settings/economy`, identity, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cashoutRateBps: rateBps }),
    }),

  getCashoutRate: (identity: OrbitIdentity) =>
    fetchJson<{ cashoutRateBps: number }>(`${ADMIN_BASE}/settings/economy`, identity),

  getBotConfig: (identity: OrbitIdentity) =>
    fetchJson<{ providers: unknown[]; tags: string[]; names: string[]; enabled: boolean }>(`${ADMIN_BASE}/bot-config`, identity),

  saveBotConfig: (identity: OrbitIdentity, config: unknown) =>
    fetchJson<{ success: boolean }>(`${ADMIN_BASE}/bot-config`, identity, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    }),

  testBotProvider: (identity: OrbitIdentity, provider: unknown) =>
    fetchJson<{ ok: boolean; foundCount: number; latencyMs: number }>(`${ADMIN_BASE}/bot-config/test`, identity, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider }),
    }),

  syncBotImages: (identity: OrbitIdentity) =>
    fetchJson<{ success: boolean; cachedCount: number }>(`${ADMIN_BASE}/bot-config/sync-images`, identity, { method: "POST" }),

  getBots: (identity: OrbitIdentity) =>
    fetchJson<{ bots: unknown[] }>(`${ADMIN_BASE}/bots`, identity),

  createBot: (identity: OrbitIdentity, name: string, tags: string[]) =>
    fetchJson<{ success: boolean; bot: unknown }>(`${ADMIN_BASE}/bots`, identity, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, tags }),
    }),

  updateBot: (identity: OrbitIdentity, botId: string, data: unknown) =>
    fetchJson<{ success: boolean; bot: unknown }>(`${ADMIN_BASE}/bots/${botId}`, identity, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),

  deleteBot: (identity: OrbitIdentity, botId: string) =>
    fetchJson<{ success: boolean }>(`${ADMIN_BASE}/bots/${botId}`, identity, { method: "DELETE" }),

  generateBotPicture: (identity: OrbitIdentity, botId: string, customUrl?: string) =>
    fetchJson<{ success: boolean; bot: unknown }>(`${ADMIN_BASE}/bots/${botId}/picture`, identity, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customUrl }),
    }),
};
