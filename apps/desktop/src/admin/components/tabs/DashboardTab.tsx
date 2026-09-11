"use client";

import {   AdminEmptyState, AdminLoadingState, Badge } from "../../../components/admin/primitives";
import { adminApi } from "../../../utils/adminApi";
import { useState, useCallback, useEffect } from "react";
import { Users, Activity, GitCompare, Image, Flag,  BarChart2,   XCircle, Clock, TrendingUp, Heart, Bot } from "lucide-react";
import { cn } from "../../../lib/utils";
import { AdminMediaThumbnail } from "../AdminMediaThumbnail";
import type { DashboardStats, AdminObject } from "../../../utils/adminTypes";
import type { OrbitIdentity } from "@orbit/crypto";

interface DashboardTabProps {
  identity: OrbitIdentity | null;
  pinVerified: boolean;
  onZoom: (url: string, isVideo: boolean, title: string, subtitle: string) => void;
  onAction?: (action: string, ...args: unknown[]) => void;
  onNavigate?: (tab: string) => void;
}

const statCards = [
  { key: "users" as keyof DashboardStats, label: "Total Users", icon: Users, color: "text-cyan-400", bg: "bg-cyan-500/10" },
  { key: "online_users" as keyof DashboardStats, label: "Online Now", icon: Activity, color: "text-emerald-400", bg: "bg-emerald-500/10" },
  { key: "banned_users" as keyof DashboardStats, label: "Banned", icon: XCircle, color: "text-red-400", bg: "bg-red-500/10" },
  { key: "active_matches" as keyof DashboardStats, label: "Active Duels", icon: GitCompare, color: "text-amber-400", bg: "bg-amber-500/10" },
  { key: "active_tier_matches" as keyof DashboardStats, label: "Tier Matches", icon: GitCompare, color: "text-purple-400", bg: "bg-purple-500/10" },
  { key: "pending_reports" as keyof DashboardStats, label: "Open Reports", icon: Flag, color: "text-red-400", bg: "bg-red-500/10" },
  { key: "objects" as keyof DashboardStats, label: "Total Objects", icon: Image, color: "text-violet-400", bg: "bg-violet-500/10" },
  { key: "stories" as keyof DashboardStats, label: "Active Stories", icon: Image, color: "text-pink-400", bg: "bg-pink-500/10" },
  { key: "lobby_images" as keyof DashboardStats, label: "Lobby Images", icon: Image, color: "text-orange-400", bg: "bg-orange-500/10" },
  { key: "queue_waiting" as keyof DashboardStats, label: "In Queue", icon: Clock, color: "text-blue-400", bg: "bg-blue-500/10" },
  { key: "in_session" as keyof DashboardStats, label: "In Session", icon: Activity, color: "text-indigo-400", bg: "bg-indigo-500/10" },
  { key: "pending_recommendations" as keyof DashboardStats, label: "Pending Feedback", icon: Heart, color: "text-rose-400", bg: "bg-rose-500/10" },
];

export function DashboardTab({ identity, pinVerified, onZoom, onAction, onNavigate }: DashboardTabProps) {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentObjects, setRecentObjects] = useState<AdminObject[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboard = useCallback(async () => {
    if (!identity || !pinVerified) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await adminApi.dashboard(identity);
      setStats(data);
      setRecentObjects(data.recent_objects || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
    } finally {
      setIsLoading(false);
    }
  }, [identity, pinVerified]);

  useEffect(() => {
    fetchDashboard();
    const interval = setInterval(fetchDashboard, 15000);
    return () => clearInterval(interval);
  }, [fetchDashboard]);

  if (isLoading && !stats) {
    return <AdminLoadingState rows={4} columns={3} />;
  }

  if (error && !stats) {
    return <AdminEmptyState title="Failed to load dashboard" description={error} action={<button onClick={fetchDashboard} className="px-4 py-2 bg-cyan-500 text-black text-xs font-bold rounded hover:bg-cyan-400">Retry</button>} illustration="chart" />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-bold text-retro-fg">Dashboard overview</h1>
        <p className="text-xs text-retro-muted mt-1">Platform health and key metrics at a glance. Auto-refreshes every 15s.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
        {statCards.map(card => {
          const value = stats?.[card.key] ?? 0;
          const Icon = card.icon;
          return (
            <div key={card.key} className={cn("p-4 rounded-xl border border-border-glass bg-surface-raised", card.bg)}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-retro-muted">{card.label}</p>
                  <p className="text-2xl font-black text-retro-fg mt-1">{typeof value === "number" ? value.toLocaleString() : Array.isArray(value) ? value.length : String(value)}</p>
                </div>
                <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", card.color)}>
                  <Icon className="w-5 h-5" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-border-glass bg-surface-raised overflow-hidden">
          <div className="px-4 py-3 border-b border-border-glass flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider">Recent Objects</h2>
            <Badge variant="info" size="sm">Live</Badge>
          </div>
          {recentObjects.length === 0 ? (
            <AdminEmptyState title="No recent objects" description="Objects will appear here as users upload content" illustration="folder" />
          ) : (
            <div className="divide-y divide-border-subtle">
              {recentObjects.slice(0, 10).map(obj => {
                const objectProtected = !obj.content_url || obj.content_url?.startsWith("/api/objects/");
                const objectId = objectProtected ? obj.id : null;
                const directUrl = obj.content_url && !obj.content_url.startsWith("/api/objects/") ? obj.content_url : null;

                return (
                  <div key={obj.id} className="flex items-center gap-3 p-3 hover:bg-glass-w5 transition-colors">
                    <AdminMediaThumbnail
                      objectId={objectId}
                      directUrl={directUrl}
                      identity={identity}
                      mimeType={obj.mime_type}
                      title={obj.owner_name || obj.id.slice(0, 8)}
                      subtitle={obj.mime_type || "Media"}
                      className="w-10 h-10"
                      onZoom={onZoom}
                      badge={obj.is_story === 1 && (
                        <span className="absolute top-0.5 right-0.5 px-1 py-0.5 bg-cyan-500/10 border border-purple-300 text-cyan-300 font-mono font-bold text-[10px] rounded">STORY</span>
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-retro-fg truncate">{obj.caption || obj.id.slice(0, 12)}</p>
                      <p className="text-[10px] text-retro-muted truncate">{obj.owner_name || obj.owner_id.slice(0, 10)} · {obj.mime_type} · {Math.round((obj.size_bytes || 0) / 1024)}KB</p>
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] text-retro-muted">
                      <Badge variant="neutral" size="sm">{obj.recipients_count || 0}</Badge>
                      <Badge variant="neutral" size="sm">♥ {obj.likes_count || 0}</Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border-glass bg-surface-raised overflow-hidden">
          <div className="px-4 py-3 border-b border-border-glass flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider">Quick Actions</h2>
          </div>
          <div className="p-4 space-y-2 grid grid-cols-2 gap-2">
            {[
              { label: "Force Matchup", desc: "Pair all online players", icon: GitCompare, variant: "primary" as const, action: "forceMatchup" },
              { label: "Sync Bot Images", desc: "Refresh bot card cache", icon: Bot, variant: "default" as const, action: "syncBotImages" },
              { label: "Run Cleanup", desc: "Database maintenance", icon: TrendingUp, variant: "default" as const, action: "runCleanup" },
              { label: "View Audit Log", desc: "Recent admin actions", icon: BarChart2, variant: "default" as const, action: "openAnalytics" },
            ].map(action => {
              const Icon = action.icon;
              return (
                <button
                  key={action.label}
                  type="button"
                  onClick={() => {
                    if (action.action === "openAnalytics") {
                      onNavigate?.("analytics");
                    } else {
                      onAction?.(action.action);
                    }
                  }}
                  className={cn(
                    "p-3 rounded-lg border border-border-glass bg-surface-canvas hover:bg-glass-w5 transition-colors text-left group cursor-pointer",
                    action.variant === "primary" && "border-cyan-500/30 bg-cyan-500/10"
                  )}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Icon className={cn("w-4 h-4", action.variant === "primary" ? "text-cyan-300" : "text-retro-muted")} />
                    <span className="text-xs font-bold text-retro-fg">{action.label}</span>
                  </div>
                  <p className="text-[10px] text-retro-muted">{action.desc}</p>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
