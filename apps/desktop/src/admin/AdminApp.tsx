"use client";

import { useEffect, useState, useCallback, useMemo } from "react";

import { orbitFetch, getApiBaseUrl } from "../utils/api";
import { adminApi } from "../utils/adminApi";
import { useToast } from "../components/Toast";
import { describePinFailure } from "./pinFailure";
import { useConfirm } from "../components/ConfirmDialog";
import { logger } from "../utils/logger";
import { AdminLayout } from "./components/AdminLayout";
import { DashboardTab } from "./components/tabs/DashboardTab";
import { ModerationTab } from "./components/tabs/ModerationTab";
import { UsersTab } from "./components/tabs/UsersTab";
import { ContentTab } from "./components/tabs/ContentTab";
import { SettingsTab } from "./components/tabs/SettingsTab";
import { ZoomModal, useZoomModal } from "../components/CardZoomModalHost";
import { TAB_REGISTRY, LEGACY_TAB_MAP, getTabBadge } from "../utils/adminTabs";
import { useAdminWebSocket } from "../hooks/useAdminWebSocket";
import { Button, Input } from "../ui/kit";
import { classes, COLOR, FEEDBACK, GAP, MONO, PADDING, PADDING_X, PADDING_Y, RADIUS, STATUS, TRACKING, TYPE, WEIGHT } from "../ui/tokens";
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
  const zoom = useZoomModal();

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
        // Say which node refused and what its status means. The old message
        // was the server's raw string, and the three ways this fails look
        // nothing alike: a wrong PIN is 401, a node with no ADMIN_PIN configured
        // at all is 503 (nothing to compare against), and a courier node
        // without the admin service is 404 at the edge. "Unauthenticated" for
        // any of them sent people hunting for a password problem they did not
        // have.
        const data = await res.json().catch(() => null);
        toast(describePinFailure(res.status, data?.error, getApiBaseUrl()), "error");
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
      // ONE admin HTTP layer: every action goes through `adminApi`, which
      // throws on a non-2xx response. The direct `orbitFetch` calls this
      // replaces IGNORED the response status — a 403 or a 500 still toasted
      // "<action> completed", so a failed moderation action reported success.
      switch (action) {
        case "forceEnd":
          await adminApi.forceEndMatch(identity, String(args[0]));
          break;
        case "cancel":
          await adminApi.cancelMatch(identity, String(args[0]));
          break;
        case "override": {
          const result = await confirm({
            title: "Override match result?",
            description: `Force this duel to resolve as "${args[1]}". League points will be awarded to match the override.`,
            confirmLabel: "Apply override",
            tone: "danger",
          });
          if (result) {
            await adminApi.overrideMatchResult(identity, String(args[0]), String(args[1]));
          }
          break;
        }
        case "forceMatchup":
          await adminApi.forceMatchup(identity);
          break;
        case "runCleanup":
          await adminApi.triggerCleanup(identity);
          break;
        case "endTier":
          await adminApi.endTierMatch(identity, String(args[0]));
          break;
        case "closeRoom":
          await adminApi.closeRoom(identity, String(args[0]));
          break;
        case "closeBabecock":
          await adminApi.closeBabecock(identity, String(args[0]));
          break;
        case "banUser":
          if (await confirm({ title: `Ban user ${args[0]}?`, description: "Ban this user and wipe/moderate their active content.", confirmLabel: "Ban User", tone: "danger" })) {
            await adminApi.banUser(identity, String(args[0]), String(args[1] || "Admin inline moderation"), true, "all");
          }
          break;
        case "togglePostVisibility":
          {
            const post = args[0] as { id: string; hidden_at: string | null };
            await adminApi.togglePostVisibility(identity, post.id, !post.hidden_at);
          }
          break;
        case "deletePost":
          if (await confirm({ title: "Delete post?", description: "Permanently delete this public post.", confirmLabel: "Delete", tone: "danger" })) {
            await adminApi.deletePost(identity, String(args[0]));
          }
          break;
        case "deleteLobbyImage":
          if (await confirm({ title: "Delete lobby image?", description: "Removes the row and blob permanently.", confirmLabel: "Delete", tone: "danger" })) {
            await adminApi.deleteLobbyImage(identity, String(args[0]));
          }
          break;
        case "unban":
          await adminApi.unbanUser(identity, String(args[0]));
          break;
        case "moderator":
          await adminApi.toggleModerator(identity, String(args[0]), Boolean(args[1]));
          break;
        case "admin":
          await adminApi.adjustUser(identity, String(args[0]), { is_admin: args[1] });
          break;
        case "deleteUser":
          if (await confirm({ title: "Delete user?", description: "Permanently deletes the account and all content.", confirmLabel: "Delete", tone: "danger" })) {
            await adminApi.deleteUser(identity, String(args[0]));
          }
          break;
        case "hideComment":
          await adminApi.hideLobbyComment(identity, String(args[0]));
          break;
        case "unhideComment":
          await adminApi.unhideLobbyComment(identity, String(args[0]));
          break;
        case "deleteComment":
          if (await confirm({ title: "Delete comment?", description: "Permanently delete this comment.", confirmLabel: "Delete", tone: "danger" })) {
            await adminApi.deleteLobbyComment(identity, String(args[0]));
          }
          break;
        case "deleteChat":
          if (await confirm({ title: "Delete chat message?", description: "Permanently delete this message.", confirmLabel: "Delete", tone: "danger" })) {
            await adminApi.deleteChatMessage(identity, String(args[0]), String(args[1]));
          }
          break;
        case "moderateCard":
          await adminApi.moderateCard(identity, String(args[0]), args[1] as "active" | "hidden" | "banned");
          break;
        case "toggleAnnouncement":
          await adminApi.toggleAnnouncement(identity, String(args[0]), Boolean(args[1]));
          break;
        case "deleteAnnouncement":
          if (await confirm({ title: "Delete announcement?", description: "Permanently delete this announcement.", confirmLabel: "Delete", tone: "danger" })) {
            await adminApi.deleteAnnouncement(identity, String(args[0]));
          }
          break;
        case "refresh":
          loadDashboardData();
          break;
        default:
          // An unknown action is a client bug, not a server error: say so
          // instead of reporting success for something that never ran.
          logger.error(`Unknown admin action: ${action}`);
          toast(`Unknown action: ${action}`, "error");
          return;
      }
      toast(`${action} completed`, "success");
    } catch (err) {
      logger.error(`Action ${action} failed:`, err);
      toast(`${action} failed`, "error");
    }
  }, [identity, pinVerified, confirm, toast, loadDashboardData]);

  const handleZoom = useCallback((url: string, isVideo: boolean, title: string, subtitle: string) => {
    zoom.showZoom(url, { isVideo, title, subtitle });
  }, [zoom.showZoom]);

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
      <div className={classes('min-h-screen', COLOR.canvas, COLOR.fg, 'flex items-center justify-center', PADDING[4], 'font-sans')}>
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/60" />
          <div className={classes('absolute top-1/4 left-1/4 w-48 h-48', RADIUS.pill, COLOR.accentBg, 'blur-3xl')} />
        </div>
        <div className={classes('relative z-[var(--z-dropdown)] w-full max-w-sm glass-panel', PADDING[6], 'space-y-4')}>
          <div className={classes('flex items-center justify-between border-b', COLOR.edge, 'pb-3')}>
            <div className={classes('flex items-center', GAP[2])}>
              <span className={classes('w-2 h-2', RADIUS.pill, COLOR.accentBg)} />
              <h1 className={classes(TYPE.body, WEIGHT.bold, COLOR.fg, TRACKING.wider)}>Admin Operations</h1>
            </div>

          </div>

          <p className={FEEDBACK.description}>
            Enter the secret administrative passcode to access the moderation console.
          </p>

          {(Boolean(import.meta.env.DEV) || (typeof window !== 'undefined' && (window.location?.hostname === 'localhost' || window.location?.hostname === '127.0.0.1'))) && (
            <div className={classes('flex items-center justify-between', TYPE.body, STATUS.warningBg, STATUS.warningEdge, STATUS.warning, PADDING_X[2.5], PADDING_Y[1.5], RADIUS.chip)}>
              <span>Dev mode: default passcode is <code className={classes(MONO, WEIGHT.bold, COLOR.scrim, PADDING_X[1], 'py-0.5', RADIUS.chip)}>admin</code></span>
              <Button
                type="button"
                variant="link"
                size="sm"
                onClick={() => setPin('admin')}
                className={classes(TYPE.caption, WEIGHT.bold, 'underline ml-2 shrink-0')}
              >
                Use admin
              </Button>
            </div>
          )}

          <form onSubmit={handleVerifyPin} className={classes('space-y-3')}>
            <div>
              <Input
                type="password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="Secret Passcode"
                autoFocus
                className={MONO}
              />
            </div>

            <Button
              type="submit"
              variant="primary"
              disabled={verifyingPin || !pin.trim()}
              className={classes('w-full', WEIGHT.bold, 'uppercase', TRACKING.wider)}
            >
              {verifyingPin ? "Verifying..." : "Unlock Admin Console"}
            </Button>
          </form>

          <div className={classes(TYPE.caption, COLOR.muted, MONO, 'text-center pt-1 space-y-0.5')}>
            <div>Target: {getApiBaseUrl()}</div>
            <div className={classes('flex items-center justify-center', GAP[1.5])}>
              <span>Signed as: <span className={MONO}>{identity?.orbitId || "No identity. Sign in first."}</span></span>
              {identity?.orbitId && (
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  onClick={() => { void navigator.clipboard.writeText(identity.orbitId) }}
                  className="underline"
                  title="Copy your Orbit ID (needed for ADMIN_ORBIT_ID)"
                >
                  Copy
                </Button>
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
      <ZoomModal zoom={zoom} identity={identity} />

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
