"use client";

import { ConfirmDialog, AdminEmptyState, AdminLoadingState, Badge } from "../../../components/admin/primitives";
import { adminApi } from "../../../utils/adminApi";
import { useState, useCallback, useEffect } from "react";
import {
  Settings,
  AlertTriangle,
  Save,
  Globe,
  Zap as ZapIcon,
  BarChart2,
} from "lucide-react";
import { cn } from "../../../lib/utils";
import { formatAbsoluteTime } from "../../../utils/timeAgo";
import type { OrbitIdentity } from "@orbit/crypto";
import type { AdminAuditEntry, AdminDailyStat } from "../../../utils/adminTypes";

interface SettingsTabProps {
  identity: OrbitIdentity | null;
  pinVerified: boolean;
  onAction: (action: string, ...args: unknown[]) => void;
}

const subTabs = [
  { id: "platform", label: "Platform Settings", icon: Settings },
  { id: "audit", label: "Audit Log & Stats", icon: BarChart2 },
  { id: "danger", label: "Maintenance & Danger Zone", icon: AlertTriangle },
] as const;

type SubTab = typeof subTabs[number]["id"];

function Sparkline({ data, height = 40, color = "#67e8f9" }: { data: number[]; height?: number; color?: string }) {
  if (!data.length) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const width = 100;
  const step = width / (data.length - 1 || 1);
  const points = data.map((v, i) => `${(i * step).toFixed(1)},${(height - 3 - ((v - min) / range) * (height - 6)).toFixed(1)}`);
  const area = `0,${height} ${points.join(" ")} ${width},${height}`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="w-full h-full">
      <polygon points={area} fill={color} opacity={0.12} />
      <polyline points={points.join(" ")} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
      <circle cx={points[points.length - 1].split(",")[0]} cy={points[points.length - 1].split(",")[1]} r={1.6} fill={color} />
    </svg>
  );
}

export function SettingsTab({ identity, pinVerified, onAction }: SettingsTabProps) {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>("platform");
  const [discordLink, setDiscordLink] = useState("");
  const [cashoutRateBps, setCashoutRateBps] = useState(12500);
  const [showCleanupConfirm, setShowCleanupConfirm] = useState(false);
  const [showCleanPostsConfirm, setShowCleanPostsConfirm] = useState(false);
  const [showMigrateConfirm, setShowMigrateConfirm] = useState(false);

  // Audit Log & Daily Stats state
  const [auditSubTab, setAuditSubTab] = useState<"log" | "daily">("log");
  const [auditLog, setAuditLog] = useState<AdminAuditEntry[]>([]);
  const [dailyStats, setDailyStats] = useState<AdminDailyStat[]>([]);
  const [isLoadingAudit, setIsLoadingAudit] = useState(false);

  const fetchSettings = useCallback(async () => {
    if (!identity || !pinVerified) return;
    try {
      const [discordRes, cashoutRes] = await Promise.all([
        adminApi.getDiscordLink(identity),
        adminApi.getCashoutRate(identity),
      ]);
      if (discordRes.url) setDiscordLink(discordRes.url);
      setCashoutRateBps(cashoutRes.cashoutRateBps);
    } catch {
    }
  }, [identity, pinVerified]);

  const fetchAuditLog = useCallback(async () => {
    if (!identity || !pinVerified) return;
    setIsLoadingAudit(true);
    try {
      const data = await adminApi.auditLog(identity, 200);
      setAuditLog(Array.isArray(data) ? data : []);
    } catch {
    } finally {
      setIsLoadingAudit(false);
    }
  }, [identity, pinVerified]);

  const fetchDailyStats = useCallback(async () => {
    if (!identity || !pinVerified) return;
    setIsLoadingAudit(true);
    try {
      const data = await adminApi.dailyStats(identity, 30);
      setDailyStats(Array.isArray(data) ? data : []);
    } catch {
    } finally {
      setIsLoadingAudit(false);
    }
  }, [identity, pinVerified]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  useEffect(() => {
    if (activeSubTab === "audit") {
      if (auditSubTab === "log") fetchAuditLog();
      else fetchDailyStats();
    }
  }, [activeSubTab, auditSubTab, fetchAuditLog, fetchDailyStats]);

  const handleSaveDiscord = async () => {
    if (!identity) return;
    try {
      await adminApi.saveDiscordLink(identity, discordLink);
      fetchSettings();
    } catch {
    }
  };

  const handleSaveCashout = async () => {
    if (!identity) return;
    try {
      await adminApi.saveCashoutRate(identity, cashoutRateBps);
      fetchSettings();
    } catch {
    }
  };

  const handleTriggerCleanup = async () => {
    if (!identity) return;
    setShowCleanupConfirm(false);
    try {
      await adminApi.triggerCleanup(identity);
      onAction("refresh");
    } catch {
    }
  };

  const handleCleanPosts = async () => {
    if (!identity) return;
    setShowCleanPostsConfirm(false);
    try {
      await adminApi.cleanAllPosts(identity);
      onAction("refresh");
    } catch {
    }
  };

  const handleMigrate = async () => {
    if (!identity) return;
    setShowMigrateConfirm(false);
    try {
      await adminApi.migrateLobbyToPosts(identity);
      onAction("refresh");
    } catch {
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-black text-retro-fg uppercase tracking-wider">System & Settings</h1>
          <p className="text-xs text-retro-muted mt-0.5">Platform configurations, administrative audit log, and database maintenance</p>
        </div>
      </div>

      {/* Subtab Navigation */}
      <div className="flex flex-wrap gap-1 bg-surface-raised border border-border-glass rounded-xl p-1">
        {subTabs.map(section => {
          const Icon = section.icon;
          const active = activeSubTab === section.id;
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => setActiveSubTab(section.id)}
              className={cn(
                "px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 cursor-pointer",
                active
                  ? "bg-retro-accent text-retro-accent-text shadow-sm"
                  : "text-retro-muted hover:text-retro-fg"
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {section.label}
            </button>
          );
        })}
      </div>

      {/* Subtab 1: Platform Settings */}
      {activeSubTab === "platform" && (
        <div className="space-y-6">
          <div className="rounded-xl border border-border-glass bg-surface-raised p-5 space-y-6">
            <div className="flex items-center justify-between border-b border-border-glass pb-3">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-retro-fg">
                <Globe className="w-4 h-4 text-cyan-300" />
                <span>Discord Community Invite</span>
              </div>
            </div>
            <div className="space-y-3">
              <label className="text-[10px] font-bold text-retro-muted uppercase tracking-wider block">Discord Invite URL</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={discordLink}
                  onChange={e => setDiscordLink(e.target.value)}
                  placeholder="https://discord.gg/..."
                  className="flex-1 bg-glass-w8 border border-border-glass rounded-lg px-3 py-2 text-xs text-retro-fg outline-none focus:border-retro-accent"
                />
                <button
                  type="button"
                  onClick={handleSaveDiscord}
                  className="px-4 py-2 bg-retro-accent text-retro-accent-text rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  Save
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border-glass bg-surface-raised p-5 space-y-6">
            <div className="flex items-center justify-between border-b border-border-glass pb-3">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-retro-fg">
                <ZapIcon className="w-4 h-4 text-amber-400" />
                <span>Economy Cashout Rate</span>
              </div>
            </div>
            <div className="space-y-3">
              <label className="text-[10px] font-bold text-retro-muted uppercase tracking-wider block">Cashout Rate (basis points)</label>
              <p className="text-xs text-retro-muted">1 bp = 0.01%. Current: {(cashoutRateBps / 100).toFixed(2)}% (12500 = 125%)</p>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={cashoutRateBps}
                  onChange={e => setCashoutRateBps(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                  min={0}
                  max={100000}
                  className="flex-1 bg-glass-w8 border border-border-glass rounded-lg px-3 py-2 text-xs text-retro-fg outline-none focus:border-retro-accent font-mono"
                />
                <button
                  type="button"
                  onClick={handleSaveCashout}
                  className="px-4 py-2 bg-retro-accent text-retro-accent-text rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  Save Rate
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Subtab 2: Audit Log & Daily Stats */}
      {activeSubTab === "audit" && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 border-b border-border-glass pb-3">
            <button
              type="button"
              onClick={() => setAuditSubTab("log")}
              className={cn(
                "px-3 py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer",
                auditSubTab === "log" ? "bg-glass-w10 text-retro-fg" : "text-retro-muted hover:text-retro-body"
              )}
            >
              Audit Log ({auditLog.length})
            </button>
            <button
              type="button"
              onClick={() => setAuditSubTab("daily")}
              className={cn(
                "px-3 py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer",
                auditSubTab === "daily" ? "bg-glass-w10 text-retro-fg" : "text-retro-muted hover:text-retro-body"
              )}
            >
              Daily Activity Stats ({dailyStats.length} days)
            </button>
          </div>

          {auditSubTab === "log" ? (
            <div className="rounded-xl border border-border-glass bg-surface-raised overflow-hidden">
              {isLoadingAudit ? (
                <AdminLoadingState rows={6} columns={4} />
              ) : auditLog.length === 0 ? (
                <AdminEmptyState title="No audit entries" description="Zero administrative actions logged" illustration="folder" />
              ) : (
                <div className="divide-y divide-border-subtle">
                  {auditLog.map(entry => (
                    <div key={entry.id} className="p-3 flex items-center justify-between gap-3 hover:bg-glass-w5 transition-colors">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="info" size="sm">{entry.action}</Badge>
                          <span className="text-xs font-bold text-retro-fg">{entry.admin_name || entry.admin_id.slice(0, 8)}</span>
                          <span className="text-[10px] text-retro-muted">{formatAbsoluteTime(entry.created_at)}</span>
                        </div>
                        <p className="text-xs text-retro-body mt-1">
                          Target: <span className="font-mono text-retro-fg">{entry.target_type}:{entry.target_id}</span>
                        </p>
                        {entry.reason && (
                          <p className="text-[10px] text-retro-muted font-mono mt-0.5 truncate">
                            Reason: {entry.reason}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="p-4 rounded-xl border border-border-glass bg-surface-raised">
                  <span className="text-[10px] font-bold text-retro-muted uppercase block mb-1">Active Users</span>
                  <div className="h-10">
                    <Sparkline data={dailyStats.map(d => d.active_users)} color="#34d399" />
                  </div>
                </div>
                <div className="p-4 rounded-xl border border-border-glass bg-surface-raised">
                  <span className="text-[10px] font-bold text-retro-muted uppercase block mb-1">Matches Played</span>
                  <div className="h-10">
                    <Sparkline data={dailyStats.map(d => d.matches_played)} color="#a855f7" />
                  </div>
                </div>
                <div className="p-4 rounded-xl border border-border-glass bg-surface-raised">
                  <span className="text-[10px] font-bold text-retro-muted uppercase block mb-1">Peak Concurrent</span>
                  <div className="h-10">
                    <Sparkline data={dailyStats.map(d => d.peak_concurrent)} color="#38bdf8" />
                  </div>
                </div>
                <div className="p-4 rounded-xl border border-border-glass bg-surface-raised">
                  <span className="text-[10px] font-bold text-retro-muted uppercase block mb-1">New Signups</span>
                  <div className="h-10">
                    <Sparkline data={dailyStats.map(d => d.new_users)} color="#f59e0b" />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Subtab 3: Maintenance & Danger Zone */}
      {activeSubTab === "danger" && (
        <div className="space-y-4">
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-5 space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-red-300">
              <AlertTriangle className="w-4 h-4" />
              <span>Danger Zone & Server Maintenance</span>
            </div>
            <p className="text-xs text-retro-muted leading-relaxed">
              These actions perform irreversible maintenance or data resets. Use with care.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-5 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-xs font-bold text-red-300 uppercase tracking-wider">Run Database Cleanup</h3>
                  <p className="text-[10px] text-retro-muted mt-1">Expires stale content, sweeps orphan blobs, and resets daily scores.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCleanupConfirm(true)}
                  className="px-3 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/30 rounded-xl text-xs font-bold uppercase tracking-wider transition-all shrink-0 cursor-pointer"
                >
                  Run Cleanup
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-5 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-xs font-bold text-red-300 uppercase tracking-wider">Clean ALL Posts & Reset</h3>
                  <p className="text-[10px] text-retro-muted mt-1">Purges all user posts, media objects, likes and comments platform-wide.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCleanPostsConfirm(true)}
                  className="px-3 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/30 rounded-xl text-xs font-bold uppercase tracking-wider transition-all shrink-0 cursor-pointer"
                >
                  Clean All
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5 space-y-3 md:col-span-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-xs font-bold text-amber-300 uppercase tracking-wider">Migrate Lobby → Posts</h3>
                  <p className="text-[10px] text-retro-muted mt-1">Transfers all lobby board images into user gMatch profiles under Posts, preserving metadata.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowMigrateConfirm(true)}
                  className="px-3 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 rounded-xl text-xs font-bold uppercase tracking-wider transition-all shrink-0 cursor-pointer"
                >
                  Migrate Now
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showCleanupConfirm && (
        <ConfirmDialog
          isOpen={true}
          onClose={() => setShowCleanupConfirm(false)}
          onConfirm={handleTriggerCleanup}
          title="Run Database Maintenance?"
          description="This will expire stale content, sweep orphan blobs, and reset daily scores. This operation cannot be undone."
          confirmLabel="Run Cleanup"
          variant="danger"
        />
      )}

      {showCleanPostsConfirm && (
        <ConfirmDialog
          isOpen={true}
          onClose={() => setShowCleanPostsConfirm(false)}
          onConfirm={handleCleanPosts}
          title="Clean ALL Posts & Reset Data?"
          description="This will PURGE all user posts, media objects, post likes and comments platform-wide to start the website from scratch. THIS CANNOT BE UNDONE."
          confirmLabel="Clean All Posts"
          variant="danger"
        />
      )}

      {showMigrateConfirm && (
        <ConfirmDialog
          isOpen={true}
          onClose={() => setShowMigrateConfirm(false)}
          onConfirm={handleMigrate}
          title="Migrate Lobby Board Images to User Posts?"
          description="This transfers all images uploaded to the lobby board into each user's gMatch profile under Posts, preserving their likes and metadata."
          confirmLabel="Migrate Now"
          variant="primary"
        />
      )}
    </div>
  );
}