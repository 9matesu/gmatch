"use client";

import { AdminEmptyState, AdminLoadingState, Badge } from "../../../components/admin/primitives";
import { adminApi } from "../../../utils/adminApi";
import { useState, useCallback, useEffect } from "react";
import { BarChart2, ListChecks, TrendingUp, Users, Activity, Flag, GitCompare } from "lucide-react";
import { cn } from "../../../lib/utils";
import type { AdminAuditEntry, AdminDailyStat, OrbitIdentity } from "../../../utils/adminTypes";

interface AnalyticsTabProps {
  identity: OrbitIdentity | null;
  pinVerified: boolean;
  onAction: (action: string, ...args: unknown[]) => void;
}

const subTabs = [
  { id: "audit", label: "Audit Log", icon: ListChecks },
  { id: "daily", label: "Daily Stats", icon: BarChart2 },
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

export function AnalyticsTab({ identity, pinVerified }: AnalyticsTabProps) {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>("audit");
  const [auditLog, setAuditLog] = useState<AdminAuditEntry[]>([]);
  const [dailyStats, setDailyStats] = useState<AdminDailyStat[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchAuditLog = useCallback(async () => {
    if (!identity || !pinVerified) return;
    try {
      const data = await adminApi.auditLog(identity, 200);
      setAuditLog(data);
    } catch {
    }
  }, [identity, pinVerified]);

  const fetchDailyStats = useCallback(async () => {
    if (!identity || !pinVerified) return;
    setIsLoading(true);
    try {
      const data = await adminApi.dailyStats(identity, 30);
      setDailyStats(data);
    } catch {
    } finally {
      setIsLoading(false);
    }
  }, [identity, pinVerified]);


  useEffect(() => {
    if (activeSubTab === "audit") fetchAuditLog();
    else fetchDailyStats();
  }, [activeSubTab, fetchAuditLog, fetchDailyStats]);

  const renderAuditRow = (entry: AdminAuditEntry) => (
    <div key={entry.id} className="border-b border-border-subtle last:border-0 p-3 hover:bg-glass-w5 transition-colors">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-retro-fg">{entry.action}</span>
            <Badge variant="neutral" size="sm">{entry.target_type || "—"}</Badge>
          </div>
          <p className="text-[10px] text-retro-muted truncate">
            Admin: {entry.admin_name || entry.admin_id.slice(0, 8)} · Target: {entry.target_id || "—"} · {new Date(entry.created_at).toLocaleString()}
          </p>
          {entry.reason && <p className="text-[10px] text-retro-muted mt-0.5 truncate">Reason: {entry.reason}</p>}
        </div>
      </div>
    </div>
  );

  const ascending = [...dailyStats].reverse();
  const series = (key: keyof AdminDailyStat) => ascending.map((s) => Number(s[key] ?? 0));
  const lastDay = ascending[ascending.length - 1];

  const metricCards = [
    {
      label: "Active Users",
      value: lastDay?.active_users ?? 0,
      icon: Users,
      color: "text-cyan-400",
      bg: "bg-cyan-500/10",
      data: series("active_users"),
      spark: "#67e8f9",
    },
    {
      label: "Matches Played",
      value: lastDay?.matches_played ?? 0,
      icon: GitCompare,
      color: "text-emerald-400",
      bg: "bg-emerald-500/10",
      data: series("matches_played"),
      spark: "#34d399",
    },
    {
      label: "New Users",
      value: lastDay?.new_users ?? 0,
      icon: TrendingUp,
      color: "text-amber-400",
      bg: "bg-amber-500/10",
      data: series("new_users"),
      spark: "#fbbf24",
    },
    {
      label: "Reports Opened",
      value: lastDay?.reports_opened ?? 0,
      icon: Flag,
      color: "text-rose-400",
      bg: "bg-rose-500/10",
      data: series("reports_opened"),
      spark: "#fb7185",
    },
  ];


  if (isLoading && dailyStats.length === 0 && auditLog.length === 0) {
    return <AdminLoadingState rows={5} columns={4} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-retro-fg">Analytics & audit</h1>
          <p className="text-xs text-retro-muted mt-1">Admin audit log and aggregate daily activity</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 bg-surface-raised border border-border-glass rounded-xl p-1">
        {subTabs.map(tab => {
          const Icon = tab.icon;
          const active = activeSubTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveSubTab(tab.id)}
              className={cn(
                "px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5",
                active
                  ? "bg-retro-accent text-retro-accent-text"
                  : "text-retro-muted hover:text-retro-fg"
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeSubTab === "audit" && (
        <div className="rounded-xl border border-border-glass bg-surface-raised overflow-hidden">
          <div className="px-4 py-3 border-b border-border-glass flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider">Admin Audit Log ({auditLog.length})</h2>
            <Badge variant="info" size="sm">Live</Badge>
          </div>
          {auditLog.length === 0 ? (
            <AdminEmptyState title="No audit entries" description="Admin actions will be logged here" illustration="folder" />
          ) : (
            <div className="divide-y divide-border-subtle">
              {auditLog.map(renderAuditRow)}
            </div>
          )}
        </div>
      )}

      {activeSubTab === "daily" && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {metricCards.map((card) => {
              const Icon = card.icon;
              return (
                <div key={card.label} className={cn("rounded-xl border border-border-glass bg-surface-raised p-4", card.bg)}>
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-retro-muted">{card.label}</p>
                      <p className={cn("text-2xl font-black mt-1", card.color)}>{card.value.toLocaleString()}</p>
                      <p className="text-[10px] text-retro-muted mt-0.5">Latest day</p>
                    </div>
                    <Icon className={cn("w-5 h-5", card.color)} />
                  </div>
                  <div className="mt-2 h-10">
                    <Sparkline data={card.data} color={card.spark} />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="rounded-xl border border-border-glass bg-surface-raised overflow-hidden">
            <div className="px-4 py-3 border-b border-border-glass flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider">Daily Activity Trend (Last 30 Days)</h2>
              <div className="flex items-center gap-3 text-[10px] text-retro-muted">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-cyan-400" /> Active Users</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400" /> Matches</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400" /> New Users</span>
              </div>
            </div>
            {dailyStats.length === 0 ? (
              <AdminEmptyState title="No daily stats" description="Daily statistics will appear here" illustration="chart" />
            ) : (
              <div className="p-4 space-y-4">
                {(() => {
                  const cols = ascending.map((s) => {
                    const label = s.date.slice(5);
                    return (
                      <div key={s.date} className="flex flex-col items-center gap-1 min-w-0">
                        <span className="text-[10px] text-retro-muted truncate font-mono">{label}</span>
                        <span className="text-[10px] font-bold text-retro-fg">{s.active_users.toLocaleString()}</span>
                        <div className="w-full max-w-[18px]">
                          <div className="w-full flex flex-col justify-end items-center gap-0.5 rounded overflow-hidden bg-surface-canvas" style={{ height: 84 }}>
                            <div className="w-full bg-amber-400/70" style={{ height: `${(s.new_users / (Math.max(...series("new_users"), 1))) * 84}px` }} />
                            <div className="w-full bg-emerald-400/70" style={{ height: `${(s.matches_played / (Math.max(...series("matches_played"), 1))) * 84}px` }} />
                            <div className="w-full bg-cyan-400/70" style={{ height: `${(s.active_users / (Math.max(...series("active_users"), 1))) * 84}px` }} />
                          </div>
                        </div>
                        <span className="flex items-center gap-0.5 text-[10px] text-retro-muted">
                          <Activity className="w-2 h-2" /> {s.peak_concurrent.toLocaleString()}
                        </span>
                      </div>
                    );
                  });
                  return <div className="grid grid-cols-7 md:grid-cols-15 gap-2 overflow-x-auto">{cols}</div>;
                })()}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-border-glass bg-surface-raised overflow-hidden">
            <div className="px-4 py-3 border-b border-border-glass">
              <h2 className="text-xs font-bold uppercase tracking-wider">Daily Breakdown</h2>
            </div>
            {dailyStats.length === 0 ? (
              <AdminEmptyState title="No daily stats" illustration="chart" />
            ) : (
              <div className="divide-y divide-border-subtle">
                {dailyStats.map((stat) => (
                  <div key={stat.date} className="p-3 hover:bg-glass-w5 transition-colors">
                    <div className="grid grid-cols-2 md:grid-cols-7 gap-3 text-center">
                      <div>
                        <p className="text-xs font-bold text-retro-fg">{stat.date}</p>
                        <p className="text-[10px] text-retro-muted">Date</p>
                      </div>
                      <div>
                        <p className="text-xs font-bold text-cyan-400">{stat.active_users.toLocaleString()}</p>
                        <p className="text-[10px] text-retro-muted">Active</p>
                      </div>
                      <div>
                        <p className="text-xs font-bold text-emerald-400">{stat.matches_played.toLocaleString()}</p>
                        <p className="text-[10px] text-retro-muted">Matches</p>
                      </div>
                      <div>
                        <p className="text-xs font-bold text-amber-400">{stat.peak_concurrent.toLocaleString()}</p>
                        <p className="text-[10px] text-retro-muted">Peak</p>
                      </div>
                      <div>
                        <p className="text-xs font-bold text-blue-400">{stat.new_users.toLocaleString()}</p>
                        <p className="text-[10px] text-retro-muted">New</p>
                      </div>
                      <div>
                        <p className="text-xs font-bold text-red-400">{stat.banned_users.toLocaleString()}</p>
                        <p className="text-[10px] text-retro-muted">Banned</p>
                      </div>
                      <div>
                        <p className="text-xs font-bold text-rose-400">{stat.reports_opened.toLocaleString()}</p>
                        <p className="text-[10px] text-retro-muted">Reports</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}