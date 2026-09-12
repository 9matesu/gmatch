"use client";

import { AdminFilterBar, AdminEmptyState, AdminLoadingState, Badge, StatusBadge } from "../../../components/admin/primitives";
import { adminApi } from "../../../utils/adminApi";
import { getApiBaseUrl } from "../../../utils/api";
import { useState, useCallback, useEffect } from "react";
import { Flag, MessageSquare, Ban, ChevronDown, ChevronUp, Maximize2, CheckCircle2, UserCheck } from "lucide-react";
import { cn } from "../../../lib/utils";
import { AdminMediaThumbnail } from "../AdminMediaThumbnail";
import { resolveMediaUrl } from "../../../utils/media";
import type { AdminReport, AdminLobbyComment, AdminChatMessage, AdminUser, TableParams, OrbitIdentity } from "../../../utils/adminTypes";

interface ModerationTabProps {
  identity: OrbitIdentity | null;
  pinVerified: boolean;
  onZoom: (url: string, isVideo: boolean, title: string, subtitle: string) => void;
  onAction: (action: string, ...args: unknown[]) => void;
}

const subTabs = [
  { id: "reports", label: "Reports & Cases", icon: Flag },
  { id: "chat_comments", label: "Chat & Comments", icon: MessageSquare },
  { id: "bans", label: "Bans & Penalties", icon: Ban },
] as const;

type SubTab = typeof subTabs[number]["id"];

function asArray<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

export function ModerationTab({ identity, pinVerified, onZoom, onAction }: ModerationTabProps) {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>("reports");
  
  // Reports
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [reportsTotal, setReportsTotal] = useState(0);
  const [reportsParams, setReportsParams] = useState<TableParams>({ page: 1, pageSize: 50, filters: { status: "open" } });
  
  // Chat & Comments
  const [commType, setCommType] = useState<"comments" | "chat">("comments");
  const [comments, setComments] = useState<AdminLobbyComment[]>([]);
  const [chatMessages, setChatMessages] = useState<AdminChatMessage[]>([]);
  const [chatParams] = useState<TableParams>({ page: 1, pageSize: 50, filters: { channel: "all" } });
  
  // Bans
  const [bannedUsers, setBannedUsers] = useState<AdminUser[]>([]);
  const [bansTotal, setBansTotal] = useState(0);
  const [bansParams] = useState<TableParams>({ page: 1, pageSize: 50, filters: { status: "banned" } });

  const [isLoading, setIsLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [caseDetail, setCaseDetail] = useState<Record<string, any>>({});
  const [evidenceUrl, setEvidenceUrl] = useState<Record<string, string>>({});

  const toggleExpand = (id: string) => {
    setExpandedId(prev => {
      const next = prev === id ? null : id;
      if (next && identity && !caseDetail[next]) {
        adminApi.caseDetail(identity, next).then((d) => {
          setCaseDetail(prev2 => ({ ...prev2, [next]: d }));
          if (d?.evidence?.evidence_path && !evidenceUrl[next]) {
            adminApi.caseEvidence(identity, next).then(e => setEvidenceUrl(prev2 => ({ ...prev2, [next]: `${getApiBaseUrl()}${e.url}` }))).catch(() => { });
          }
        }).catch(() => { });
      }
      return next;
    });
  };

  const fetchReports = useCallback(async () => {
    if (!identity || !pinVerified) return;
    setIsLoading(true);
    try {
      const response = await adminApi.reports(identity, reportsParams);
      const rows = asArray(response.data);
      setReports(rows);
      setReportsTotal(response.total || rows.length);
    } catch {
    } finally {
      setIsLoading(false);
    }
  }, [identity, pinVerified, reportsParams]);

  const fetchComments = useCallback(async () => {
    if (!identity || !pinVerified) return;
    setIsLoading(true);
    try {
      const data = await adminApi.lobbyComments(identity);
      setComments(asArray(data));
    } catch {
    } finally {
      setIsLoading(false);
    }
  }, [identity, pinVerified]);

  const fetchChat = useCallback(async () => {
    if (!identity || !pinVerified) return;
    setIsLoading(true);
    try {
      const response = await adminApi.chat(identity, chatParams);
      setChatMessages(asArray(response.data));
    } catch {
    } finally {
      setIsLoading(false);
    }
  }, [identity, pinVerified, chatParams]);

  const fetchBans = useCallback(async () => {
    if (!identity || !pinVerified) return;
    setIsLoading(true);
    try {
      const response = await adminApi.users(identity, bansParams);
      const rows = asArray(response.data).filter(u => Boolean(u.is_banned));
      setBannedUsers(rows);
      setBansTotal(rows.length);
    } catch {
    } finally {
      setIsLoading(false);
    }
  }, [identity, pinVerified, bansParams]);

  useEffect(() => {
    if (activeSubTab === "reports") fetchReports();
  }, [activeSubTab, fetchReports]);

  useEffect(() => {
    if (activeSubTab === "chat_comments") {
      if (commType === "comments") fetchComments();
      else fetchChat();
    }
  }, [activeSubTab, commType, fetchComments, fetchChat]);

  useEffect(() => {
    if (activeSubTab === "bans") fetchBans();
  }, [activeSubTab, fetchBans]);

  const handleReportAction = async (report: AdminReport, action: "delete" | "ban" | "deny") => {
    if (!identity) return;
    setActionLoading(report.id);
    try {
      await adminApi.resolveReport(identity, report.id, action);
      fetchReports();
    } catch {
    } finally {
      setActionLoading(null);
    }
  };

  const handleUnban = async (userId: string) => {
    onAction("unban", userId);
    setTimeout(fetchBans, 300);
  };

  const renderReportRow = (report: AdminReport) => {
    const isHidden = report.is_hidden;
    const isExpanded = expandedId === report.id;
    const targetTypeLabels: Record<string, string> = {
      post: "Post",
      story: "Story",
      lobby_image: "Lobby Image",
      lobby_comment: "Lobby Comment",
      post_comment: "Post Comment",
      private_message: "Private Message",
      lobby_chat: "Lobby Chat",
      match_chat: "Match Chat",
      group_message: "Group Message",
      card: "Card",
      user: "User",
    };

    const objectId = report.content_url?.startsWith("/api/objects/") ? report.content_url.split("/api/objects/")[1].split(/[?#]/)[0] : report.object_id || null;
    const directUrl = report.content_url && !report.content_url.startsWith("/api/objects/") ? report.content_url : null;

    return (
      <div key={report.id} className="border-b border-border-subtle last:border-0 hover:bg-glass-w5 transition-colors">
        <div className="p-3 flex items-start gap-3">
          <button
            type="button"
            onClick={() => toggleExpand(report.id)}
            className="text-retro-muted hover:text-retro-fg transition-transform shrink-0 mt-0.5 cursor-pointer"
            title={isExpanded ? "Collapse" : "Expand report"}
          >
            {isExpanded ? <ChevronUp className="w-4 h-4 text-cyan-300" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {report.content_url && (
            <AdminMediaThumbnail
              objectId={objectId}
              directUrl={directUrl}
              identity={identity}
              title={`Report: ${report.target_type}`}
              subtitle={report.target_id}
              className="w-10 h-10 shrink-0"
              onZoom={onZoom}
            />
          )}
          <div className="flex-1 min-w-0 cursor-pointer" onClick={() => toggleExpand(report.id)}>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="info" size="sm">{targetTypeLabels[report.target_type] || report.target_type}</Badge>
              <StatusBadge status={report.status} mapping={{ open: "pending", reviewed: "info", resolved: "success", dismissed: "neutral" }} size="sm" />
              {report.category && <Badge variant="neutral" size="sm">{report.category}</Badge>}
              {isHidden && <Badge variant="warning" size="sm" dot>Hidden</Badge>}
              {report.reported_is_banned && <Badge variant="danger" size="sm" dot>User Banned</Badge>}
            </div>
            <p className="text-xs text-retro-fg font-medium mt-1 truncate">{report.preview || report.reason || "Reported Item"}</p>
            <p className="text-[10px] text-retro-muted mt-0.5">
              Reported by {report.reporter_name || report.reporter_id.slice(0, 8)} · {new Date(report.created_at).toLocaleString()}
              {report.reason && ` · Reason: ${report.reason}`}
            </p>
          </div>
          <div className="flex flex-col gap-1.5 shrink-0">
            {report.status === "open" ? (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => handleReportAction(report, "delete")}
                  disabled={actionLoading === report.id}
                  className="px-2.5 py-1 text-[10px] font-bold rounded-md border border-red-500/30 text-red-300 hover:bg-red-500/10 disabled:opacity-40 cursor-pointer"
                >
                  {actionLoading === report.id ? "..." : "Delete"}
                </button>
                <button
                  type="button"
                  onClick={() => handleReportAction(report, "ban")}
                  disabled={actionLoading === report.id}
                  className="px-2.5 py-1 text-[10px] font-bold rounded-md border border-red-500/30 text-red-300 hover:bg-red-500/10 disabled:opacity-40 cursor-pointer"
                >
                  {actionLoading === report.id ? "..." : "Ban"}
                </button>
                <button
                  type="button"
                  onClick={() => handleReportAction(report, "deny")}
                  disabled={actionLoading === report.id}
                  className="px-2.5 py-1 text-[10px] font-bold rounded-md border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-40 cursor-pointer"
                >
                  {actionLoading === report.id ? "..." : "Dismiss"}
                </button>
              </div>
            ) : (
              <span className="text-[10px] text-retro-muted font-mono">Resolved: {report.action}</span>
            )}
          </div>
        </div>

        {isExpanded && (
          <div className="px-4 pb-4 pt-1 bg-surface-elevated/40 border-t border-border-subtle/50 flex flex-col md:flex-row gap-4 items-start animate-orbit-fade-in">
            {report.content_url && (
              <div className="relative group shrink-0">
                <AdminMediaThumbnail
                  objectId={objectId}
                  directUrl={directUrl}
                  identity={identity}
                  title={`Report: ${report.target_type}`}
                  subtitle={report.target_id}
                  className="w-48 h-48 md:w-56 md:h-56 rounded-lg cursor-zoom-in"
                  onZoom={onZoom}
                />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    const fullUrl = directUrl || (objectId ? resolveMediaUrl(objectId) : "");
                    onZoom(fullUrl, false, `Report: ${report.target_type}`, report.target_id);
                  }}
                  className="absolute bottom-2 right-2 p-1.5 bg-black/70 hover:bg-black text-white text-xs rounded-lg border border-border-glass opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                  title="Expand Full Evidence Media"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            <div className="flex-1 min-w-0 space-y-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-retro-muted font-mono text-[10px]">CASE ID:</span>
                <span className="font-mono text-retro-fg">{report.id}</span>
                <span className="text-retro-muted font-mono text-[10px] ml-2">TARGET:</span>
                <span className="font-mono text-retro-fg">{report.target_type}:{report.target_id}</span>
              </div>
              {caseDetail[report.id]?.reported_user && (
                <div className="p-2 rounded bg-surface-canvas border border-border-glass text-[11px]">
                  <span className="text-retro-muted uppercase tracking-wider font-bold">Reported Account:</span>{" "}
                  <span className="text-retro-fg font-semibold">{caseDetail[report.id].reported_user.display_name}</span>{" "}
                  <span className="text-retro-muted font-mono">({caseDetail[report.id].reported_user.id.slice(0, 10)})</span>
                </div>
              )}
              {report.reason && (
                <div className="p-2 rounded bg-surface-canvas border border-border-glass text-[11px]">
                  <span className="text-retro-muted uppercase tracking-wider font-bold">Reason:</span>{" "}
                  <span className="text-retro-fg">{report.reason}</span>
                </div>
              )}
              {caseDetail[report.id]?.target?.caption && (
                <div className="p-2 rounded bg-surface-canvas border border-border-glass text-[11px]">
                  <span className="text-retro-muted uppercase tracking-wider font-bold">Content Text:</span>{" "}
                  <span className="text-retro-fg">{caseDetail[report.id].target.caption}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-black text-retro-fg uppercase tracking-wider">Moderation & Safety</h1>
          <p className="text-xs text-retro-muted mt-0.5">Triage user reports, review chat & comments, and enforce account bans</p>
        </div>
      </div>

      {/* Subtab Navigation */}
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
                "px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 cursor-pointer",
                active
                  ? "bg-retro-accent text-retro-accent-text shadow-sm"
                  : "text-retro-muted hover:text-retro-fg"
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
              {tab.id === "reports" && reportsTotal > 0 && (
                <span className="ml-1 px-1.5 py-0.2 bg-rose-500/20 text-rose-300 rounded-full text-[10px]">
                  {reportsTotal}
                </span>
              )}
              {tab.id === "bans" && bansTotal > 0 && (
                <span className="ml-1 px-1.5 py-0.2 bg-glass-w10 text-retro-muted rounded-full text-[10px]">
                  {bansTotal}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Subtab 1: Reports & Cases */}
      {activeSubTab === "reports" && (
        <div className="space-y-4">
          <AdminFilterBar
            searchPlaceholder="Filter reports by user or target..."
            searchValue={String(reportsParams.filters?.q || "")}
            onSearchChange={(q) => setReportsParams(p => ({ ...p, page: 1, filters: { ...p.filters, q } }))}
            filters={reportsParams.filters || {}}
            onFiltersChange={(filters) => setReportsParams(p => ({ ...p, page: 1, filters }))}
            configs={[
              {
                key: "status",
                label: "Status",
                type: "select",
                options: [
                  { label: "Open Cases", value: "open" },
                  { label: "All Cases", value: "all" },
                  { label: "Resolved", value: "resolved" },
                  { label: "Dismissed", value: "dismissed" },
                ],
              },
            ]}
          />

          <div className="rounded-xl border border-border-glass bg-surface-raised overflow-hidden">
            {isLoading ? (
              <AdminLoadingState rows={6} columns={4} />
            ) : reports.length === 0 ? (
              <AdminEmptyState
                title="No reports found"
                description="Zero reports match current status filter"
                illustration="folder"
              />
            ) : (
              <div>{reports.map(renderReportRow)}</div>
            )}
          </div>
        </div>
      )}

      {/* Subtab 2: Chat & Comments */}
      {activeSubTab === "chat_comments" && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 border-b border-border-glass pb-3">
            <button
              type="button"
              onClick={() => setCommType("comments")}
              className={cn(
                "px-3 py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer",
                commType === "comments" ? "bg-white/10 text-retro-fg" : "text-retro-muted hover:text-retro-body"
              )}
            >
              Lobby Comments ({comments.length})
            </button>
            <button
              type="button"
              onClick={() => setCommType("chat")}
              className={cn(
                "px-3 py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer",
                commType === "chat" ? "bg-white/10 text-retro-fg" : "text-retro-muted hover:text-retro-body"
              )}
            >
              Chat Messages ({chatMessages.length})
            </button>
          </div>

          <div className="rounded-xl border border-border-glass bg-surface-raised overflow-hidden">
            {commType === "comments" ? (
              comments.length === 0 ? (
                <AdminEmptyState title="No comments" description="No lobby comments recorded" illustration="inbox" />
              ) : (
                <div className="divide-y divide-border-subtle">
                  {comments.map(c => (
                    <div key={c.id} className="p-3 flex items-center justify-between gap-3 hover:bg-glass-w5 transition-colors">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-retro-fg">{c.user_name || c.user_id.slice(0, 8)}</span>
                          <span className="text-[10px] text-retro-muted">{new Date(c.created_at).toLocaleString()}</span>
                          {c.hidden_at && <Badge variant="warning" size="sm">Hidden</Badge>}
                        </div>
                        <p className="text-xs text-retro-body mt-1">{c.body}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {c.hidden_at ? (
                          <button
                            type="button"
                            onClick={() => { onAction("unhideComment", c.id); setTimeout(fetchComments, 300); }}
                            className="px-2 py-1 text-[10px] font-semibold rounded border border-white/10 text-retro-muted hover:text-retro-fg cursor-pointer"
                          >
                            Unhide
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => { onAction("hideComment", c.id); setTimeout(fetchComments, 300); }}
                            className="px-2 py-1 text-[10px] font-semibold rounded border border-amber-500/30 text-amber-300 hover:bg-amber-500/10 cursor-pointer"
                          >
                            Hide
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => { onAction("deleteComment", c.id); setTimeout(fetchComments, 300); }}
                          className="px-2 py-1 text-[10px] font-semibold rounded border border-red-500/30 text-red-300 hover:bg-red-500/10 cursor-pointer"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : (
              chatMessages.length === 0 ? (
                <AdminEmptyState title="No chat messages" description="No messages recorded" illustration="inbox" />
              ) : (
                <div className="divide-y divide-border-subtle">
                  {chatMessages.map(m => (
                    <div key={m.id} className="p-3 flex items-center justify-between gap-3 hover:bg-glass-w5 transition-colors">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="neutral" size="sm">#{m.channel || "lobby"}</Badge>
                          <span className="text-xs font-bold text-retro-fg">{m.sender_name || m.sender_id.slice(0, 8)}</span>
                          <span className="text-[10px] text-retro-muted">{new Date(m.created_at).toLocaleString()}</span>
                        </div>
                        <p className="text-xs text-retro-body mt-1">{m.body}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => { onAction("deleteChatMessage", m.id); setTimeout(fetchChat, 300); }}
                        className="px-2 py-1 text-[10px] font-semibold rounded border border-red-500/30 text-red-300 hover:bg-red-500/10 cursor-pointer"
                      >
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        </div>
      )}

      {/* Subtab 3: Bans & Penalties */}
      {activeSubTab === "bans" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border-glass bg-surface-raised overflow-hidden">
            {isLoading ? (
              <AdminLoadingState rows={4} columns={3} />
            ) : bannedUsers.length === 0 ? (
              <div className="p-8 text-center text-xs text-retro-muted">
                <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
                <p className="font-semibold text-retro-fg">No Banned Users</p>
                <p className="text-[10px] text-retro-muted mt-0.5">There are currently no active account bans or suspensions</p>
              </div>
            ) : (
              <div className="divide-y divide-border-subtle">
                {bannedUsers.map(user => (
                  <div key={user.id} className="p-3 flex items-center justify-between gap-3 hover:bg-glass-w5 transition-colors">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-retro-fg">{user.display_name || user.id.slice(0, 10)}</span>
                        <Badge variant="danger" size="sm" dot>Banned</Badge>
                        <span className="text-[10px] text-retro-muted font-mono">{user.id}</span>
                      </div>
                      <p className="text-xs text-red-300 mt-1">
                        Reason: {user.ban_reason || "Admin policy violation"}
                      </p>
                      {user.ban_created_at && (
                        <p className="text-[10px] text-retro-muted mt-0.5">
                          Banned on {new Date(user.ban_created_at).toLocaleString()}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleUnban(user.id)}
                      className="px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-lg text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5"
                    >
                      <UserCheck className="w-3.5 h-3.5" />
                      <span>Lift Ban</span>
                    </button>
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
