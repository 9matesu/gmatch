import {
  LayoutDashboard,
  Users,
  ShieldAlert,
  Globe,
  Settings,
} from "lucide-react";
import type { TabConfig, TabId, TabSection, AdminState } from "./adminTypes";

export const TAB_REGISTRY: TabConfig[] = [
  {
    id: "dashboard",
    label: "Overview",
    section: "Operations",
    icon: LayoutDashboard,
    badge: (state) => state.stats ? `${state.stats.online_users} online` : null,
    description: "Platform health, system metrics, and urgent alerts at a glance",
    route: "/admin",
  },
  {
    id: "moderation",
    label: "Moderation",
    section: "Operations",
    icon: ShieldAlert,
    badge: (state) => (state.stats?.pending_reports && state.stats.pending_reports > 0) ? `${state.stats.pending_reports} open` : null,
    description: "Triage reports, inspect evidence, chat moderation, and user bans",
    route: "/admin/moderation",
  },
  {
    id: "users",
    label: "Users & Economy",
    section: "Operations",
    icon: Users,
    badge: (state) => state.stats?.users ? String(state.stats.users) : null,
    description: "User profiles, balances, card catalog, marketplace, and ledger",
    route: "/admin/users",
  },
  {
    id: "content",
    label: "Content & Games",
    section: "Operations",
    icon: Globe,
    badge: (state) => {
      const activeGames = (state.stats?.active_matches || 0) + (state.stats?.active_tier_matches || 0);
      return activeGames > 0 ? `${activeGames} live` : null;
    },
    description: "Public feed posts, lobby board, duels, rooms, and announcements",
    route: "/admin/content",
  },
  {
    id: "settings",
    label: "System & Settings",
    section: "System",
    icon: Settings,
    badge: () => null,
    description: "Platform parameters, audit log, database maintenance, and danger zone",
    route: "/admin/settings",
  },
];

export const TAB_SECTIONS: TabSection[] = [
  "Operations",
  "System",
];

export function getTabConfig(tabId: TabId): TabConfig | undefined {
  return TAB_REGISTRY.find(t => t.id === tabId);
}

export function getTabsBySection(section: TabSection): TabConfig[] {
  return TAB_REGISTRY.filter(t => t.section === section);
}

export function getTabBadge(tabId: TabId, state: AdminState): string | null {
  const tab = getTabConfig(tabId);
  return tab?.badge?.(state) || null;
}

export function getTabRoute(tabId: TabId): string | undefined {
  const tab = getTabConfig(tabId);
  return tab?.route;
}

export const LEGACY_TAB_MAP: Record<string, TabId> = {
  dashboard: "dashboard",
  live: "content",
  matches: "content",
  match_archive: "content",
  special_matches: "content",
  game_ops: "content",
  games: "content",
  objects: "content",
  posts: "content",
  lobby_images: "content",
  content: "content",
  users: "users",
  cards_economy: "users",
  economy: "users",
  reports: "moderation",
  lobby_comments: "moderation",
  chat: "moderation",
  moderation: "moderation",
  announcements: "content",
  recommendations: "content",
  platform: "content",
  audit_log: "settings",
  daily_stats: "settings",
  analytics: "settings",
  bot_setup: "settings",
  system: "settings",
  settings: "settings",
};