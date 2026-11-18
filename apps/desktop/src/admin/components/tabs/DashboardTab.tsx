"use client";

import { AdminEmptyState, AdminLoadingState, Badge } from "../../../components/admin/primitives";
import { adminApi } from "../../../utils/adminApi";
import { useState, useCallback, useEffect } from "react";
import {
  Users,
  Activity,
  GitCompare,
  Flag,
  Globe,
  TrendingUp,
  ShieldCheck,
  ShieldAlert,
  Clock,
  CheckCircle2,
  RefreshCw,
  Megaphone,
  BarChart2,
} from "lucide-react";
import { cn } from "../../../lib/utils";
import { formatAbsoluteTime } from "../../../utils/timeAgo";
import { AdminMediaThumbnail } from "../AdminMediaThumbnail";
import type { DashboardStats, AdminPost, AdminMatch } from "../../../utils/adminTypes";
import type { OrbitIdentity } from "@orbit/crypto";

interface DashboardTabProps {
  identity: OrbitIdentity | null;
  pinVerified: boolean;
  onZoom: (url: string, isVideo: boolean, title: string, subtitle: string) => void;
  onAction?: (action: string, ...args: unknown[]) => void;
  onNavigate?: (tab: string) => void;
}

export function DashboardTab({ identity, pinVerified, onZoom, onAction, onNavigate }: DashboardTabProps) {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentPosts, setRecentPosts] = useState<AdminPost[]>([]);
  const [liveMatches, setLiveMatches] = useState<AdminMatch[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());

  const fetchDashboard = useCallback(async () => {
    if (!identity || !pinVerified) return;
    setIsLoading(true);
    setError(null);
    try {
      const [dashData, postsRes, matchesRes] = await Promise.all([
        adminApi.dashboard(identity),
        adminApi.posts(identity, { page: 1, pageSize: 6 }),
        adminApi.matches(identity),
      ]);
      setStats(dashData);
      setRecentPosts(Array.isArray(postsRes.data) ? postsRes.data : []);
      setLiveMatches(Array.isArray(matchesRes) ? matchesRes : []);
      setLastRefreshed(new Date());
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
    return (
      <AdminEmptyState
        title="Failed to load dashboard"
        description={error}
        action={
          <button
            onClick={fetchDashboard}
            className="px-4 py-2 bg-retro-accent text-retro-accent-text text-xs font-bold rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
          >
            Retry
          </button>
        }
        illustration="chart"
      />
    );
  }

  const pendingReports = stats?.pending_reports ?? 0;
  const onlineUsers = stats?.online_users ?? 0;
  const totalUsers = stats?.users ?? 0;
  const activeDuels = (stats?.active_matches ?? 0) + (stats?.active_tier_matches ?? 0);
  const totalPosts = (stats?.objects ?? 0) + (stats?.lobby_images ?? 0);
  const queueWaiting = stats?.queue_waiting ?? 0;

  return (
    <div className="space-y-6">
      {/* Header & Status Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-black text-retro-fg tracking-wider">Operations Overview</h1>
          <p className="text-xs text-retro-muted mt-0.5">Live platform health, security status, and core metrics</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="glass-inset px-3 py-1.5 rounded-lg flex items-center gap-2 text-xs font-semibold">
            <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
            <span className="text-retro-fg">System Online</span>
            <span className="text-retro-faint">·</span>
            <span className="text-2xs text-retro-muted font-mono">
              Refreshed {lastRefreshed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          </div>
          <button
            type="button"
            onClick={fetchDashboard}
            className="glass-action p-2 rounded-lg text-retro-muted hover:text-retro-fg cursor-pointer"
            title="Refresh dashboard metrics"
            aria-label="Refresh metrics"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Needs Attention / Security Alert Banner */}
      {pendingReports > 0 ? (
        <div className="rounded-xl border border-danger/0 bg-danger/0 p-4 flex flex-wrap items-center justify-between gap-4 animate-orbit-fade-in">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-danger/0 text-danger-fg flex items-center justify-center shrink-0">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-danger-fg tracking-wider">
                {pendingReports} Pending Moderation Case{pendingReports === 1 ? '' : 's'}
              </h3>
              <p className="text-xs text-retro-muted mt-0.5">
                Unresolved user reports or flagged content require review in the Moderation queue.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate?.("moderation")}
            className="px-4 py-2 bg-danger hover:bg-danger text-retro-fg rounded-lg text-xs font-bold tracking-wide transition-colors cursor-pointer"
          >
            Review Reports →
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-success/0 bg-success/ px-4 py-3 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-success-fg font-semibold">
            <ShieldCheck className="w-4 h-4 text-success-fg" />
            <span>All Clear: Zero pending reports in moderation queue</span>
          </div>
          <button
            type="button"
            onClick={() => onNavigate?.("moderation")}
            className="text-xs text-retro-muted hover:text-retro-fg cursor-pointer underline"
          >
            View Cases
          </button>
        </div>
      )}

      {/* Primary 6 KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* 1. Online Users */}
        <div className="p-4 rounded-xl border border-edge bg-surface-raised">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-2xs font-bold uppercase tracking-wider text-retro-muted">Online Users</p>
              <p className="text-2xl font-black text-success-fg mt-1">{onlineUsers.toLocaleString()}</p>
            </div>
            <div className="w-8 h-8 rounded-lg bg-success/0 text-success-fg flex items-center justify-center">
              <Activity className="w-4 h-4" />
            </div>
          </div>
        </div>

        {/* 2. Open Reports */}
        <div className={cn(
          "p-4 rounded-xl border",
          pendingReports > 0 ? "border-danger/0 bg-danger/0" : "border-edge bg-surface-raised"
        )}>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-2xs font-bold uppercase tracking-wider text-retro-muted">Open Reports</p>
              <p className={cn("text-2xl font-black mt-1", pendingReports > 0 ? "text-danger-fg" : "text-retro-fg")}>
                {pendingReports.toLocaleString()}
              </p>
            </div>
            <div className={cn(
              "w-8 h-8 rounded-lg flex items-center justify-center",
              pendingReports > 0 ? "bg-danger/0 text-danger-fg" : "bg-glass-w10 text-retro-muted"
            )}>
              <Flag className="w-4 h-4" />
            </div>
          </div>
        </div>

        {/* 3. Live Matches */}
        <div className="p-4 rounded-xl border border-edge bg-surface-raised">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-2xs font-bold uppercase tracking-wider text-retro-muted">Active Duels</p>
              <p className="text-2xl font-black text-chrome-lav-fg mt-1">{activeDuels.toLocaleString()}</p>
            </div>
            <div className="w-8 h-8 rounded-lg bg-chrome-lav/0 text-chrome-lav-fg flex items-center justify-center">
              <GitCompare className="w-4 h-4" />
            </div>
          </div>
        </div>

        {/* 4. Total Users */}
        <div className="p-4 rounded-xl border border-edge bg-surface-raised">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-2xs font-bold uppercase tracking-wider text-retro-muted">Total Accounts</p>
              <p className="text-2xl font-black text-info-fg mt-1">{totalUsers.toLocaleString()}</p>
            </div>
            <div className="w-8 h-8 rounded-lg bg-info/0 text-info-fg flex items-center justify-center">
              <Users className="w-4 h-4" />
            </div>
          </div>
        </div>

        {/* 5. Queue Waiting */}
        <div className="p-4 rounded-xl border border-edge bg-surface-raised">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-2xs font-bold uppercase tracking-wider text-retro-muted">In Match Queue</p>
              <p className="text-2xl font-black text-info-fg mt-1">{queueWaiting.toLocaleString()}</p>
            </div>
            <div className="w-8 h-8 rounded-lg bg-info/0 text-info-fg flex items-center justify-center">
              <Clock className="w-4 h-4" />
            </div>
          </div>
        </div>

        {/* 6. Public Content */}
        <div className="p-4 rounded-xl border border-edge bg-surface-raised">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-2xs font-bold uppercase tracking-wider text-retro-muted">Public Media</p>
              <p className="text-2xl font-black text-warning-fg mt-1">{totalPosts.toLocaleString()}</p>
            </div>
            <div className="w-8 h-8 rounded-lg bg-warning/0 text-warning-fg flex items-center justify-center">
              <Globe className="w-4 h-4" />
            </div>
          </div>
        </div>
      </div>

      {/* Quick Operational Triggers */}
      <div className="rounded-xl border border-edge bg-surface-raised p-4">
        <div className="flex items-center justify-between pb-3 border-b border-edge mb-3">
          <h2 className="text-xs font-bold tracking-wider text-retro-fg">Admin Quick Actions</h2>
          <span className="text-2xs text-retro-muted">Safe operational triggers</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <button
            type="button"
            onClick={() => onAction?.("forceMatchup")}
            className="p-3 rounded-lg border border-edge bg-surface-canvas hover:bg-glass-w5 transition-all text-left group cursor-pointer"
          >
            <div className="flex items-center gap-2 mb-1">
              <GitCompare className="w-4 h-4 text-chrome-lav-fg group-hover:scale-110 transition-transform" />
              <span className="text-xs font-bold text-retro-fg">Force Matchup</span>
            </div>
            <p className="text-2xs text-retro-muted">Pair all waiting players in the duel queue</p>
          </button>

          <button
            type="button"
            onClick={() => onNavigate?.("content")}
            className="p-3 rounded-lg border border-edge bg-surface-canvas hover:bg-glass-w5 transition-all text-left group cursor-pointer"
          >
            <div className="flex items-center gap-2 mb-1">
              <Megaphone className="w-4 h-4 text-info-fg group-hover:scale-110 transition-transform" />
              <span className="text-xs font-bold text-retro-fg">Broadcast Notice</span>
            </div>
            <p className="text-2xs text-retro-muted">Publish system announcement banner</p>
          </button>

          <button
            type="button"
            onClick={() => onNavigate?.("settings")}
            className="p-3 rounded-lg border border-edge bg-surface-canvas hover:bg-glass-w5 transition-all text-left group cursor-pointer"
          >
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-warning-fg group-hover:scale-110 transition-transform" />
              <span className="text-xs font-bold text-retro-fg">Database Maintenance</span>
            </div>
            <p className="text-2xs text-retro-muted">Sweep expired items and optimize storage</p>
          </button>

          <button
            type="button"
            onClick={() => onNavigate?.("settings")}
            className="p-3 rounded-lg border border-edge bg-surface-canvas hover:bg-glass-w5 transition-all text-left group cursor-pointer"
          >
            <div className="flex items-center gap-2 mb-1">
              <BarChart2 className="w-4 h-4 text-success-fg group-hover:scale-110 transition-transform" />
              <span className="text-xs font-bold text-retro-fg">View Audit Log</span>
            </div>
            <p className="text-2xs text-retro-muted">Review administrative access and actions</p>
          </button>
        </div>
      </div>

      {/* 2-Column Section: Recent Public Posts & Active Duels (NO Private Content!) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recent Public Posts */}
        <div className="rounded-xl border border-edge bg-surface-raised overflow-hidden">
          <div className="px-4 py-3 border-b border-edge flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-info-fg" />
              <h2 className="text-xs font-bold tracking-wider text-retro-fg">Recent Public Posts</h2>
            </div>
            <button
              type="button"
              onClick={() => onNavigate?.("content")}
              className="text-2xs text-retro-muted hover:text-retro-fg cursor-pointer"
            >
              View All →
            </button>
          </div>
          {recentPosts.length === 0 ? (
            <AdminEmptyState title="No public posts" description="Recent feed posts will appear here" illustration="folder" />
          ) : (
            <div className="divide-y divide-edge-subtle">
              {recentPosts.map((post) => (
                <div key={post.id} className="flex items-center gap-3 p-3 hover:bg-glass-w5 transition-colors">
                  <AdminMediaThumbnail
                    directUrl={post.content_url || null}
                    identity={identity}
                    mimeType={post.mime_type}
                    title={post.post_caption || "Post"}
                    subtitle={post.author_name || "Author"}
                    className="w-10 h-10"
                    onZoom={onZoom}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-retro-fg truncate">{post.post_caption || "Public Post"}</p>
                    <p className="text-2xs text-retro-muted truncate">
                      By {post.author_name || "Unknown"} · {formatAbsoluteTime(post.created_at, { dateStyle: 'short' })}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 text-2xs">
                    <Badge variant="neutral" size="sm">{post.like_count || 0} likes</Badge>
                    <Badge variant="neutral" size="sm">{post.comment_count || 0} comments</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Live Matches & Duels */}
        <div className="rounded-xl border border-edge bg-surface-raised overflow-hidden">
          <div className="px-4 py-3 border-b border-edge flex items-center justify-between">
            <div className="flex items-center gap-2">
              <GitCompare className="w-4 h-4 text-chrome-lav-fg" />
              <h2 className="text-xs font-bold tracking-wider text-retro-fg">Active Duels ({liveMatches.length})</h2>
            </div>
            <button
              type="button"
              onClick={() => onNavigate?.("content")}
              className="text-2xs text-retro-muted hover:text-retro-fg cursor-pointer"
            >
              Manage Matches →
            </button>
          </div>
          {liveMatches.length === 0 ? (
            <div className="p-8 text-center text-xs text-retro-muted">
              <CheckCircle2 className="w-8 h-8 text-success-fg60 mx-auto mb-2" />
              <p className="font-semibold text-retro-fg">No Active Duels Right Now</p>
              <p className="text-2xs text-retro-muted mt-0.5">Players in queue will automatically pair into new matches</p>
            </div>
          ) : (
            <div className="divide-y divide-edge-subtle">
              {liveMatches.slice(0, 6).map((match) => (
                <div key={match.id} className="flex items-center justify-between p-3 hover:bg-glass-w5 transition-colors">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-xs font-bold text-retro-fg">
                      <span className="truncate">{match.user_a_name || match.user_a.slice(0, 8)}</span>
                      <span className="text-retro-muted font-normal text-2xs">vs</span>
                      <span className="truncate">{match.user_b_name || match.user_b.slice(0, 8)}</span>
                    </div>
                    <p className="text-2xs text-retro-muted mt-0.5">
                      Round {match.round_seq || 1} · Phase: {match.phase || match.status}
                    </p>
                  </div>
                  <Badge variant="info" size="sm">LIVE</Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
