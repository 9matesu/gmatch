"use client";

import { useEffect, useState, useCallback, useMemo } from "react";

import { orbitFetch, getApiBaseUrl } from "../utils/api";
import { useToast } from "../components/Toast";
import { useConfirm } from "../components/ConfirmDialog";
import { logger } from "../utils/logger";
import { AdminLayout } from "./components/AdminLayout";
import { DashboardTab } from "./components/tabs/DashboardTab";
import { ModerationTab } from "./components/tabs/ModerationTab";
import { UsersTab } from "./components/tabs/UsersTab";
import { ContentTab } from "./components/tabs/ContentTab";
import { SettingsTab } from "./components/tabs/SettingsTab";
import { CardZoomModal } from "../components/CardZoomModal";
import { TAB_REGISTRY, LEGACY_TAB_MAP, getTabBadge } from "../utils/adminTabs";
import { useAdminWebSocket } from "../hooks/useAdminWebSocket";
import type { OrbitIdentity } from "@orbit/crypto";
import type {  AdminState, TabId } from "../utils/adminTypes";

export default function AdminPageClient({ identity: appIdentity }: { identity?: OrbitIdentity | null }) {
  // Sole-admin binding: the console signs with the APP's main identity —
  // the central node gates ADMIN_ORBIT_ID against it, and the is_admin
  // grant (Admin button visibility) is recorded for it.
  const identity = appIdentity ?? null;
  const { toast } = useToast();
  const confirm = useConfirm();

  const [pin, setPin] = useState("");
  const [pinVerified, setPinVerified] = useState(false);
  const [verifyingPin, setVerifyingPin] = useState(false);

  const [activeTab, setActiveTab] = useState<TabId>(() => {
    if (typeof window === "undefined") return "dashboard";
    const stored = sessionStorage.getItem("orbit_admin_tab");
    const validTabs = TAB_REGISTRY.map(t => t.id);
    const legacyTab = stored && LEGACY_TAB_MAP[stored as TabId];
    return legacyTab && validTabs.includes(legacyTab) ? legacyTab : (stored as TabId) || "dashboard";
  });
  const [loading, setLoading] = useState(false);

  // Aggregated state for badges
  const [adminState, setAdminState] = useState<AdminState>({
    stats: null,
    liveUsers: [],
    users: [],
    matches: [],
    archivedMatches: [],
    archiveTotal: 0,
    specialMatches: [],
    rooms: [],
    babecockRounds: [],
    objects: [],
    adminPosts: [],
    lobbyImages: [],
    reports: [],
    announcementsList: [],
    recommendations: [],
    lobbyComments: [],
    chatMessages: [],
    adminCards: [],
    cardsTotal: 0,
    wallets: [],
    ledger: [],
    decks: [],
    marketListings: [],
    auditLog: [],
    dailyStats: [],
  });

  const [searchQuery, setSearchQuery] = useState(() => {
    if (typeof window === "undefined") return "";
    return sessionStorage.getItem("orbit_admin_search") || "";
  });

  // Modals
  const [zoomModal, setZoomModal] = useState<{
    isOpen: boolean;
    imageUrl: string | null;
    isVideo?: boolean;
    title?: string;
    subtitle?: string;
  }>({ isOpen: false, imageUrl: null });

  // WebSocket for real-time updates (must be called before any early returns)
  useAdminWebSocket({
    identity,
    pinVerified,
    enabled: pinVerified,
    onStatsUpdate: (stats) => {
      setAdminState(prev => ({ ...prev, stats }));
    },
    onMatchUpdate: () => {
      // Trigger a refresh of match data when a match updates
      if (activeTab === "content") {
        void loadDashboardData();
      }
    },
    onReportUpdate: () => {
      // Refresh reports when a report updates
      if (activeTab === "moderation") {
        void loadDashboardData();
      }
    },
    onUserUpdate: () => {
      // Refresh users when a user updates
      if (activeTab === "users") {
        void loadDashboardData();
      }
    },
  });

  // Check PIN verification from session
  useEffect(() => {
    if (typeof window === "undefined" || !identity) return;
    const stored = sessionStorage.getItem("orbit_admin_verified");
    if (stored === "true") setPinVerified(true);
  }, [identity]);

  // Persist active tab + search query
  useEffect(() => {
    if (typeof window === "undefined") return;
    try { sessionStorage.setItem("orbit_admin_tab", activeTab); } catch {}
  }, [activeTab]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try { sessionStorage.setItem("orbit_admin_search", searchQuery); } catch {}
  }, [searchQuery]);

  const handleVerifyPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin.trim() || !identity) return;
    const adminId = identity;
    setVerifyingPin(true);
    try {
      const res = await orbitFetch(
        "/api/admin/verify-pin",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pin: pin.trim() }),
        },
        adminId
      );
      if (res.ok) {
        setPinVerified(true);
        sessionStorage.setItem("orbit_admin_verified", "true");
        window.dispatchEvent(new Event("gmatch-admin-granted"));
        toast("Admin passcode verified", "success");
      } else {
        const data = await res.json().catch(() => null);
        toast(data?.error || "Invalid secret passcode", "error");
      }
    } catch {
      toast("Authentication request failed", "error");
    } finally {
      setVerifyingPin(false);
    }
  };

  const handleAuthError = useCallback((status?: number) => {
    if (typeof window !== "undefined") {
      sessionStorage.removeItem("orbit_admin_verified");
    }
    setPinVerified(false);
    toast(
      status === 403
        ? "Admin authorization required (403 Forbidden). Please enter secret passcode."
        : "Admin session expired (401). Please enter secret passcode.",
      "error"
    );
  }, [toast]);

  const loadDashboardData = useCallback(async () => {
    if (!identity || !pinVerified) return;
    setLoading(true);
    try {
      const res = await orbitFetch("/api/admin/dashboard", {}, identity);
      if (res.status === 403 || res.status === 401) {
        handleAuthError(res.status);
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setAdminState(prev => ({ ...prev, stats: data }));
      }
    } catch (err) {
      logger.error("Failed loading dashboard data:", err);
    } finally {
      setLoading(false);
    }
  }, [identity, pinVerified, handleAuthError]);

  useEffect(() => {
    if (pinVerified) {
      loadDashboardData();
      const interval = setInterval(loadDashboardData, 15000);
      return () => clearInterval(interval);
    }
  }, [pinVerified, loadDashboardData]);

  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  const handleRefresh = useCallback(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  const handleAction = useCallback(async (action: string, ...args: unknown[]) => {
    if (!identity || !pinVerified) return;
    try {
      switch (action) {
        case "forceEnd":
          await orbitFetch(`/api/admin/matches/${args[0]}/end`, { method: "POST" }, identity);
          break;
        case "cancel":
          await orbitFetch(`/api/admin/matches/${args[0]}`, { method: "DELETE" }, identity);
          break;
        case "override": {
          const result = await confirm({
            title: "Override match result?",
            description: `Force this duel to resolve as "${args[1]}". League points will be awarded to match the override.`,
            confirmLabel: "Apply override",
            tone: "danger",
          });
          if (result) {
            await orbitFetch(`/api/admin/matches/${args[0]}/result`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ result: args[1] }),
            }, identity);
          }
          break;
        }
        case "forceMatchup":
          await orbitFetch("/api/admin/matches/force-all", { method: "POST" }, identity);
          break;
        case "runCleanup":
          await orbitFetch("/api/admin/cleanup", { method: "POST" }, identity);
          break;
        case "endTier":
          await orbitFetch(`/api/admin/special-matches/${args[0]}/end`, { method: "POST" }, identity);
          break;
        case "closeRoom":
          await orbitFetch(`/api/admin/rooms/${args[0]}/close`, { method: "POST" }, identity);
          break;
        case "closeBabecock":
          await orbitFetch(`/api/admin/babecock/${args[0]}/close`, { method: "POST" }, identity);
          break;
        case "viewArchive":
          // Navigate to archive detail
          break;
        case "banUser":
          if (await confirm({ title: `Ban user ${args[0]}?`, description: "Ban this user and wipe/moderate their active content.", confirmLabel: "Ban User", tone: "danger" })) {
            await orbitFetch(`/api/admin/users/${args[0]}/ban`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ reason: args[1] || "Admin inline moderation", wipe: true, scope: "all" }),
            }, identity);
          }
          break;
        case "togglePostVisibility":
          {
            const post = args[0] as { id: string; hidden_at: string | null };
            await orbitFetch(`/api/admin/posts/${post.id}/visibility`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ hidden: !post.hidden_at }),
            }, identity);
          }
          break;
        case "deletePost":
          if (await confirm({ title: "Delete post?", description: "Permanently delete this public post.", confirmLabel: "Delete", tone: "danger" })) {
            await orbitFetch(`/api/admin/posts/${args[0]}`, { method: "DELETE" }, identity);
          }
          break;
        case "deleteLobbyImage":
          if (await confirm({ title: "Delete lobby image?", description: "Removes the row and blob permanently.", confirmLabel: "Delete", tone: "danger" })) {
            await orbitFetch(`/api/admin/lobby-images/${args[0]}`, { method: "DELETE" }, identity);
          }
          break;
        case "unban":
          await orbitFetch(`/api/admin/users/${args[0]}/unban`, { method: "POST" }, identity);
          break;
        case "moderator":
          await orbitFetch(`/api/admin/users/${args[0]}/moderator`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ is_moderator: args[1] }),
          }, identity);
          break;
        case "admin":
          await orbitFetch(`/api/admin/users/${args[0]}/adjust`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ is_admin: args[1] }),
          }, identity);
          break;
        case "deleteUser":
          if (await confirm({ title: `Delete user?`, description: "Permanently deletes the account and all content.", confirmLabel: "Delete", tone: "danger" })) {
            await orbitFetch(`/api/admin/users/${args[0]}/delete`, { method: "POST" }, identity);
          }
          break;
        case "hideComment":
          await orbitFetch(`/api/admin/lobby-comments/${args[0]}/hide`, { method: "POST" }, identity);
          break;
        case "unhideComment":
          await orbitFetch(`/api/admin/lobby-comments/${args[0]}/unhide`, { method: "POST" }, identity);
          break;
        case "deleteComment":
          if (await confirm({ title: "Delete comment?", description: "Permanently delete this comment.", confirmLabel: "Delete", tone: "danger" })) {
            await orbitFetch(`/api/admin/lobby-comments/${args[0]}`, { method: "DELETE" }, identity);
          }
          break;
        case "deleteChat":
          if (await confirm({ title: "Delete chat message?", description: "Permanently delete this message.", confirmLabel: "Delete", tone: "danger" })) {
            await orbitFetch(`/api/admin/chat/messages/${args[0]}/${args[1]}`, { method: "DELETE" }, identity);
          }
          break;
        case "moderateCard":
          await orbitFetch(`/api/admin/cards/${args[0]}/moderation`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ moderation_state: args[1] }),
          }, identity);
          break;
        case "toggleAnnouncement":
          await orbitFetch(`/api/admin/announcements/${args[0]}/toggle`, { method: "PATCH" }, identity);
          break;
        case "deleteAnnouncement":
          if (await confirm({ title: "Delete announcement?", description: "Permanently delete this announcement.", confirmLabel: "Delete", tone: "danger" })) {
            await orbitFetch(`/api/admin/announcements/${args[0]}`, { method: "DELETE" }, identity);
          }
          break;
        case "refresh":
          loadDashboardData();
          break;
      }
      toast(`${action} completed`, "success");
    } catch (err) {
      logger.error(`Action ${action} failed:`, err);
      toast(`${action} failed`, "error");
    }
  }, [identity, pinVerified, confirm, toast, loadDashboardData]);

  const handleZoom = useCallback((url: string, isVideo: boolean, title: string, subtitle: string) => {
    setZoomModal({ isOpen: true, imageUrl: url, isVideo, title, subtitle });
  }, []);

  const tabsForLayout = useMemo(() => TAB_REGISTRY.map(tab => ({
    id: tab.id,
    label: tab.label,
    section: tab.section,
    icon: tab.icon,
    badge: getTabBadge(tab.id, adminState),
    route: tab.route,
  })), [adminState]);

  const handleTabChange = useCallback((tab: string) => {
    setActiveTab(tab as TabId);
  }, []);

  // Passcode gate view
  if (!pinVerified) {
    return (
      <div className="min-h-screen bg-retro-bg text-retro-fg flex items-center justify-center p-4 font-sans">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/60" />
          <div className="absolute top-1/4 left-1/4 w-48 h-48 rounded-full bg-retro-accent/3 blur-3xl" />
        </div>
        <div className="relative z-10 w-full max-w-sm glass-panel p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-border-glass pb-3">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-retro-accent" />
              <h1 className="text-sm font-bold text-retro-fg uppercase tracking-wider">Admin Operations</h1>
            </div>
            <a
              href="/"
              className="text-xs font-bold text-retro-muted hover:text-retro-fg transition-colors border border-border-glass px-2 py-0.5 rounded-md"
            >
              Back to App
            </a>
          </div>

          <p className="text-xs text-retro-muted leading-relaxed">
            Enter the secret administrative passcode to access the moderation console.
          </p>

          {(Boolean(import.meta.env.DEV) || (typeof window !== 'undefined' && (window.location?.hostname === 'localhost' || window.location?.hostname === '127.0.0.1'))) && (
            <div className="flex items-center justify-between text-xs bg-amber-500/10 border border-amber-500/20 text-amber-300 px-2.5 py-1.5 rounded">
              <span>Dev mode: default passcode is <code className="font-mono font-bold bg-black/30 px-1 py-0.5 rounded">admin</code></span>
              <button
                type="button"
                onClick={() => setPin('admin')}
                className="text-[10px] font-bold underline hover:text-white cursor-pointer ml-2 shrink-0"
              >
                Use admin
              </button>
            </div>
          )}

          <form onSubmit={handleVerifyPin} className="space-y-3">
            <div>
              <input
                type="password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="Secret Passcode"
                autoFocus
                className="w-full bg-surface-raised border border-border-glass focus:border-retro-accent/60 px-3 py-2 text-xs text-retro-fg placeholder:text-retro-muted rounded-md outline-none font-mono"
              />
            </div>

            <button
              type="submit"
              disabled={verifyingPin || !pin.trim()}
              className="w-full py-2 bg-retro-accent hover:bg-retro-accent-hover text-black font-bold text-xs rounded-md uppercase tracking-wider transition-colors disabled:opacity-40 cursor-pointer shadow-[0_4px_12px_rgba(159,227,255,0.15)]"
            >
              {verifyingPin ? "Verifying..." : "Unlock Admin Console"}
            </button>
          </form>

          <div className="text-[10px] text-retro-muted font-mono text-center pt-1 space-y-0.5">
            <div>Target: {getApiBaseUrl()}</div>
            <div className="flex items-center justify-center gap-1.5">
              <span>Signed as: <span className="font-mono">{identity?.orbitId || "No identity — sign in first"}</span></span>
              {identity?.orbitId && (
                <button
                  type="button"
                  onClick={() => { void navigator.clipboard.writeText(identity.orbitId) }}
                  className="text-retro-accent hover:text-white underline cursor-pointer"
                  title="Copy your Orbit ID (needed for ADMIN_ORBIT_ID)"
                >
                  Copy
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <AdminLayout
      activeTab={activeTab}
      onTabChange={handleTabChange}
      tabs={tabsForLayout}
      user={{ name: "Administrator" }}
      onSearch={handleSearch}
      searchPlaceholder="Search across current view..."
      onRefresh={handleRefresh}
      isLoading={loading}
      onSignOut={() => handleAuthError()}
    >
      {zoomModal.isOpen && zoomModal.imageUrl && (
        <CardZoomModal
          isOpen={zoomModal.isOpen}
          onClose={() => setZoomModal({ isOpen: false, imageUrl: null })}
          imageUrl={zoomModal.imageUrl}
          isVideo={zoomModal.isVideo}
          title={zoomModal.title}
          subtitle={zoomModal.subtitle}
          identity={identity}
        />
      )}

      {activeTab === "dashboard" && (
        <DashboardTab identity={identity} pinVerified={pinVerified} onZoom={handleZoom} onAction={handleAction} onNavigate={handleTabChange} />
      )}

      {activeTab === "moderation" && (
        <ModerationTab identity={identity} pinVerified={pinVerified} onZoom={handleZoom} onAction={handleAction} />
      )}

      {activeTab === "users" && (
        <UsersTab identity={identity} pinVerified={pinVerified} onZoom={handleZoom} onAction={handleAction} />
      )}

      {activeTab === "content" && (
        <ContentTab identity={identity} pinVerified={pinVerified} onZoom={handleZoom} onAction={handleAction} />
      )}

      {activeTab === "settings" && (
        <SettingsTab identity={identity} pinVerified={pinVerified} onAction={handleAction} />
      )}
    </AdminLayout>
  );
}