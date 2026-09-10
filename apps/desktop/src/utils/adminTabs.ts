import {
  LayoutDashboard,
  Users,
  GitCompare,
  Image,
  Flag,
  Megaphone,
  BarChart2,
  Settings,
  CreditCard,
} from "lucide-react";
import type { TabConfig, TabId, TabSection, AdminState } from "./adminTypes";

export const TAB_REGISTRY: TabConfig[] = [
  {
    id: "dashboard",
    label: "Overview",
    section: "Overview",
    icon: LayoutDashboard,
    badge: (state) => state.stats ? `${state.stats.online_users} online` : null,
    description: "Platform health and key metrics at a glance",
  },
  {
    id: "games",
    label: "Games",
    section: "Games",
    icon: GitCompare,
    badge: (state) => {
      const total = (state.stats?.active_matches || 0) + (state.stats?.active_tier_matches || 0) + (state.rooms?.length || 0) + (state.babecockRounds?.length || 0);
      return total > 0 ? String(total) : null;
    },
    description: "Live matches, queue, rooms, and tournament operations",
    route: "/admin/games",
  },
  {
    id: "content",
    label: "Content",
    section: "Content",
    icon: Image,
    badge: (state) => String((state.stats?.objects || 0) + (state.adminPosts?.length || 0) + (state.stats?.lobby_images || 0)),
    description: "Browse all media: objects, posts, and lobby board",
    route: "/admin/content",
  },
  {
    id: "users",
    label: "Users",
    section: "Users",
    icon: Users,
    badge: (state) => String(state.stats?.users || 0),
    description: "User management, bans, balances, and inspection",
  },
  {
    id: "moderation",
    label: "Moderation",
    section: "Moderation",
    icon: Flag,
    badge: (state) => state.stats?.pending_reports ? String(state.stats.pending_reports) : String(state.reports?.length || 0),
    description: "Unified report queue and content moderation",
  },
  {
    id: "platform",
    label: "Platform",
    section: "Platform",
    icon: Megaphone,
    badge: (state) => {
      const total = (state.announcementsList?.length || 0) + (state.recommendations?.length || 0);
      return total > 0 ? String(total) : null;
    },
    description: "Announcements, recommendations, and feedback",
  },
  {
    id: "economy",
    label: "Economy",
    section: "Cards & Economy",
    icon: CreditCard,
    badge: (state) => state.cardsTotal > 0 ? String(state.cardsTotal) : null,
    description: "Cards, wallets, ledger, marketplace, and decks",
    route: "/admin/economy",
  },
  {
    id: "analytics",
    label: "Analytics",
    section: "Analytics",
    icon: BarChart2,
    badge: () => null,
    description: "Audit log and daily activity statistics",
  },
  {
    id: "settings",
    label: "Settings",
    section: "Settings",
    icon: Settings,
    badge: () => null,
    description: "Bot config, danger zone, and platform settings",
    route: "/admin/settings",
  },
];

export const TAB_SECTIONS: TabSection[] = [
  "Overview",
  "Games",
  "Content",
  "Users",
  "Moderation",
  "Platform",
  "Cards & Economy",
  "Analytics",
  "Settings",
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

export const LEGACY_TAB_MAP: Record<TabId, TabId> = {
  dashboard: "dashboard",
  live: "games",
  matches: "games",
  match_archive: "games",
  special_matches: "games",
  game_ops: "games",
  objects: "content",
  posts: "content",
  lobby_images: "content",
  users: "users",
  reports: "moderation",
  announcements: "platform",
  recommendations: "platform",
  lobby_comments: "moderation",
  chat: "moderation",
  cards_economy: "economy",
  audit_log: "analytics",
  daily_stats: "analytics",
  bot_setup: "settings",
  system: "settings",
  games: "games",
  content: "content",
  moderation: "moderation",
  platform: "platform",
  economy: "economy",
  analytics: "analytics",
  settings: "settings",
};