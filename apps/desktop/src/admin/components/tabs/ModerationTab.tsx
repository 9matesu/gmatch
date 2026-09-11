"use client";

import {  AdminFilterBar, AdminEmptyState, AdminLoadingState, Badge, StatusBadge } from "../../../components/admin/primitives";
import { adminApi } from "../../../utils/adminApi";
import { useState, useCallback, useEffect } from "react";
import { Flag, MessageSquare, Hash, Trash2,  Shield, Ban,  Check,  ChevronDown, ChevronUp, Maximize2, ShieldAlert } from "lucide-react";
import { cn } from "../../../lib/utils";
import { AdminMediaThumbnail } from "../AdminMediaThumbnail";
import { resolveMediaUrl } from "../../../utils/media";
import type { AdminReport, AdminLobbyComment, AdminChatMessage, TableParams,  OrbitIdentity } from "../../../utils/adminTypes";

interface ModerationTabProps {
  identity: OrbitIdentity | null;
  pinVerified: boolean;
  onZoom: (url: string, isVideo: boolean, title: string, subtitle: string) => void;
  onAction: (action: string, ...args: unknown[]) => void;
}

const subTabs = [
  { id: "reports", label: "Cases (Reports)", icon: Flag },
  { id: "comments", label: "Lobby Comments", icon: MessageSquare },
  { id: "chat", label: "Chat Messages", icon: Hash },
] as const;

type SubTab = typeof subTabs[number]["id"];

function asArray<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

export function ModerationTab({ identity, pinVerified, onZoom, onAction }: ModerationTabProps) {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>("reports");
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [reportsTotal, setReportsTotal] = useState(0);
  const [comments, setComments] = useState<AdminLobbyComment[]>([]);
  const [chatMessages, setChatMessages] = useState<AdminChatMessage[]>([]);
  const [isLoading,] = useState(false);
  const [reportsParams, setReportsParams] = useState<TableParams>({ page: 1, pageSize: 50, filters: { status: "open" } });
  const [chatParams, setChatParams] = useState<TableParams>({ page: 1, pageSize: 50, filters: { channel: "all" } });
  
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Case detail (report-scoped evidence + parties) fetched on expand —
  // the only door to disclosed private content, per docs/ADMIN-SUITE.md.
  const [caseDetail, setCaseDetail] = useState<Record<string, any>>({});

  const toggleExpand = (id: string) => {
    setExpandedId(prev => {
      const next = prev === id ? null : id;
      if (next && identity && !caseDetail[next]) {
        adminApi.caseDetail(identity, next).then(d => setCaseDetail(prev2 => ({ ...prev2, [next]: d }))).catch(() => { });
      }
      return next;
    });
  };

  const fetchReports = useCallback(async () => {
    if (!identity || !pinVerified) return;
    try {
      const response = await adminApi.reports(identity, reportsParams);
      const rows = asArray(response.data);
      setReports(rows);
      setReportsTotal(response.total || rows.length);
    } catch {
    }
  }, [identity, pinVerified, reportsParams]);

  const fetchComments = useCallback(async () => {
    if (!identity || !pinVerified) return;
    try {
      const data = await adminApi.lobbyComments(identity);
      setComments(asArray(data));
    } catch {
    }
  }, [identity, pinVerified]);


  const fetchChat = useCallback(async () => {
    if (!identity || !pinVerified) return;
    try {
      const response = await adminApi.chat(identity, chatParams);
      setChatMessages(asArray(response.data));
    } catch {
    }
  }, [identity, pinVerified, chatParams]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  useEffect(() => {
    if (activeSubTab === "comments") fetchComments();
  }, [activeSubTab, fetchComments]);


  useEffect(() => {
    if (activeSubTab === "chat") fetchChat();
  }, [activeSubTab, fetchChat]);

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
            className="text-retro-muted hover:text-retro-fg transition-transform shrink-0 mt-0.5"
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
                  className="px-2 py-1 text-[10px] rounded border border-red-500/30 text-red-300 hover:bg-red-500/10 disabled:opacity-40"
                >
                  {actionLoading === report.id ? "..." : "Delete"}
                </button>
                <button
                  type="button"
                  onClick={() => handleReportAction(report, "ban")}
                  disabled={actionLoading === report.id}
                  className="px-2 py-1 text-[10px] rounded border border-red-500/30 text-red-300 hover:bg-red-500/10 disabled:opacity-40"
                >
                  {actionLoading === report.id ? "..." : "Ban"}
                </button>
                <button
                  type="button"
                  onClick={() => handleReportAction(report, "deny")}
                  disabled={actionLoading === report.id}
                  className="px-2 py-1 text-[10px] rounded border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-40"
                >
                  {actionLoading === report.id ? "..." : "Dismiss"}
                </button>
              </div>
            ) : (
              <span className="text-[10px] text-retro-muted">Resolved: {report.action}</span>
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
                  onClick={() => onZoom(directUrl || (objectId ? `/api/objects/${objectId}/content` : ""), false, `Report: ${report.target_type}`, report.target_id)}
                  className="absolute bottom-2 right-2 px-2 py-1 bg-black/70 hover:bg-black text-white text-[10px] rounded flex items-center gap-1 border border-border-glass opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Maximize2 className="w-3 h-3" /> Full View
                </button>
              </div>
            )}
            <div className="flex-1 min-w-0 space-y-2.5">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs bg-surface-canvas/60 p-2.5 rounded-lg border border-border-glass">
                <div>
                  <span className="text-retro-muted block text-[10px]">Report ID</span>
                  <span className="font-mono text-retro-fg break-all text-[10px]">{report.id}</span>
                </div>
                <div>
                  <span className="text-retro-muted block text-[10px]">Target Type / ID</span>
                  <span className="font-mono text-cyan-300 break-all text-[10px]">{report.target_type} · {report.target_id}</span>
                </div>
                <div>
                  <span className="text-retro-muted block text-[10px]">Target User</span>
                  <span className="font-semibold text-retro-fg">{report.target_user_name || "Unknown"}</span>
                </div>
                <div>
                  <span className="text-retro-muted block text-[10px]">Reporter ID</span>
                  <span className="font-mono text-retro-muted break-all text-[10px]">{report.reporter_id}</span>
                </div>
                <div>
                  <span className="text-retro-muted block text-[10px]">Category</span>
                  <span className="text-retro-fg font-semibold uppercase">{report.category || "Uncategorized"}</span>
                </div>
                <div>
                  <span className="text-retro-muted block text-[10px]">Timestamp</span>
                  <span className="text-retro-fg font-mono">{new Date(report.created_at).toLocaleString()}</span>
                </div>
              </div>
              {(() => {
                const cd = caseDetail[report.id];
                const parties = cd?.dm_parties;
                const evidence = cd?.evidence;
                if (!parties && !evidence) return null;
                return (
                  <div className="text-xs bg-surface-canvas/40 p-2.5 rounded border border-border-glass space-y-1.5">
                    <span className="text-retro-muted text-[10px] block">Disclosed with the report:</span>
                    {parties && (
                      <div className="text-retro-fg">
                        DM parties: {parties.sender_name || parties.sender_id.slice(0, 8)} → {parties.recipient_name || parties.recipient_id.slice(0, 8)}
                      </div>
                    )}
                    {evidence && (
                      <div className="text-retro-fg font-mono text-[10px] break-all">
                        evidence object {String(evidence.id).slice(0, 12)} · {evidence.mime_type} · {(evidence.size_bytes / 1024).toFixed(0)} KiB
                      </div>
                    )}
                  </div>
                );
              })()}
              {report.preview && (
                <div className="text-xs bg-surface-canvas/40 p-2.5 rounded border border-border-glass">
                  <span className="text-retro-muted text-[10px] block mb-0.5">Content Preview / Text:</span>
                  <p className="text-retro-fg font-sans">{report.preview}</p>
                </div>
              )}
              {report.reason && (
                <div className="text-xs bg-red-500/10 border border-red-500/20 p-2.5 rounded">
                  <span className="text-red-300 font-bold text-[10px] block mb-0.5">Report Reason:</span>
                  <p className="text-retro-fg font-sans">{report.reason}</p>
                </div>
              )}
              <div className="pt-2 flex flex-wrap gap-2 items-center">
                {report.status === "open" ? (
                  <>
                    <button
                      type="button"
                      onClick={() => handleReportAction(report, "delete")}
                      disabled={actionLoading === report.id}
                      className="px-3 py-1.5 rounded text-xs font-bold bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30 flex items-center gap-1.5 transition-colors disabled:opacity-40"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Delete Target Content
                    </button>
                    <button
                      type="button"
                      onClick={() => handleReportAction(report, "ban")}
                      disabled={actionLoading === report.id}
                      className="px-3 py-1.5 rounded text-xs font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30 hover:bg-purple-500/30 flex items-center gap-1.5 transition-colors disabled:opacity-40"
                    >
                      <Ban className="w-3.5 h-3.5" />
                      Ban Offending User
                    </button>
                    <button
                      type="button"
                      onClick={() => handleReportAction(report, "deny")}
                      disabled={actionLoading === report.id}
                      className="px-3 py-1.5 rounded text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30 flex items-center gap-1.5 transition-colors disabled:opacity-40"
                    >
                      <Check className="w-3.5 h-3.5" />
                      Dismiss / Valid Content
                    </button>
                  </>
                ) : (
                  <Badge variant="success">Resolution: {report.action}</Badge>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderCommentRow = (comment: AdminLobbyComment) => {
    const isExpanded = expandedId === comment.id;
    const mediaUrl = comment.image_content_url ? resolveMediaUrl(comment.image_content_url) : comment.image_id ? resolveMediaUrl(`/api/lobby/images/${comment.image_id}/content`) : null;

    return (
      <div key={comment.id} className="border-b border-border-subtle last:border-0 hover:bg-glass-w5 transition-colors">
        <div className="p-3 flex items-start gap-3">
          <button
            type="button"
            onClick={() => toggleExpand(comment.id)}
            className="text-retro-muted hover:text-retro-fg transition-transform shrink-0 mt-0.5"
            title={isExpanded ? "Collapse" : "Expand comment"}
          >
            {isExpanded ? <ChevronUp className="w-4 h-4 text-cyan-300" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {mediaUrl && (
            <div
              className="w-10 h-10 rounded border border-border-glass bg-black overflow-hidden shrink-0 cursor-pointer"
              onClick={() => onZoom(mediaUrl, false, comment.image_caption || comment.image_id, comment.user_name || "Comment")}
            >
              <img src={mediaUrl} alt="" className="w-full h-full object-cover" />
            </div>
          )}
          <div className="flex-1 min-w-0 cursor-pointer" onClick={() => toggleExpand(comment.id)}>
            <div className="flex items-center gap-2">
              <StatusBadge status={comment.hidden_at ? "hidden" : "active"} size="sm" />
              <span className="text-xs font-semibold text-retro-fg">{comment.user_name || comment.user_id.slice(0, 8)}</span>
            </div>
            <p className="text-xs text-retro-body mt-1">{comment.body}</p>
            <p className="text-[10px] text-retro-muted mt-1">
              On image {comment.image_id.slice(0, 8)} · {new Date(comment.created_at).toLocaleString()}
            </p>
          </div>
          <div className="flex flex-col gap-1.5 shrink-0">
            {comment.hidden_at ? (
              <button
                type="button"
                onClick={() => onAction("unhideComment", comment.id)}
                className="px-2 py-1 text-[10px] rounded border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10"
              >
                Unhide
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onAction("hideComment", comment.id)}
                className="px-2 py-1 text-[10px] rounded border border-amber-500/30 text-amber-300 hover:bg-amber-500/10"
              >
                Hide
              </button>
            )}
            <button
              type="button"
              onClick={() => onAction("deleteComment", comment.id)}
              className="px-2 py-1 text-[10px] rounded border border-red-500/30 text-red-300 hover:bg-red-500/10"
            >
              Delete
            </button>
          </div>
        </div>

        {isExpanded && (
          <div className="px-4 pb-4 pt-1 bg-surface-elevated/40 border-t border-border-subtle/50 flex flex-col md:flex-row gap-4 items-start animate-orbit-fade-in">
            {mediaUrl && (
              <div className="relative group shrink-0">
                <div
                  className="w-48 h-48 md:w-56 md:h-56 rounded-lg border border-border-glass bg-black overflow-hidden cursor-zoom-in"
                  onClick={() => onZoom(mediaUrl, false, comment.image_caption || comment.image_id, comment.user_name || "Comment")}
                >
                  <img src={mediaUrl} alt="" className="w-full h-full object-contain" />
                </div>
                <button
                  type="button"
                  onClick={() => onZoom(mediaUrl, false, comment.image_caption || comment.image_id, comment.user_name || "Comment")}
                  className="absolute bottom-2 right-2 px-2 py-1 bg-black/70 hover:bg-black text-white text-[10px] rounded flex items-center gap-1 border border-border-glass opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Maximize2 className="w-3 h-3" /> Full Image
                </button>
              </div>
            )}
            <div className="flex-1 min-w-0 space-y-2.5">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs bg-surface-canvas/60 p-2.5 rounded-lg border border-border-glass">
                <div>
                  <span className="text-retro-muted block text-[10px]">Comment ID</span>
                  <span className="font-mono text-retro-fg break-all text-[10px]">{comment.id}</span>
                </div>
                <div>
                  <span className="text-retro-muted block text-[10px]">User ID</span>
                  <span className="font-mono text-cyan-300 break-all text-[10px]">{comment.user_id}</span>
                </div>
                <div>
                  <span className="text-retro-muted block text-[10px]">User Name</span>
                  <span className="font-semibold text-retro-fg">{comment.user_name || "Unknown"}</span>
                </div>
                <div>
                  <span className="text-retro-muted block text-[10px]">Target Image ID</span>
                  <span className="font-mono text-retro-fg break-all text-[10px]">{comment.image_id}</span>
                </div>
                <div>
                  <span className="text-retro-muted block text-[10px]">Created At</span>
                  <span className="text-retro-fg font-mono">{new Date(comment.created_at).toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-retro-muted block text-[10px]">Visibility</span>
                  <StatusBadge status={comment.hidden_at ? "hidden" : "active"} size="sm" />
                </div>
              </div>
              <div className="text-xs bg-surface-canvas/40 p-2.5 rounded border border-border-glass">
                <span className="text-retro-muted text-[10px] block mb-0.5">Full Comment Text:</span>
                <p className="text-retro-fg font-sans whitespace-pre-wrap">{comment.body}</p>
              </div>
              <div className="pt-2 flex flex-wrap gap-2 items-center">
                {comment.hidden_at ? (
                  <button
                    type="button"
                    onClick={() => onAction("unhideComment", comment.id)}
                    className="px-2.5 py-1.5 rounded text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30 flex items-center gap-1.5 transition-colors"
                  >
                    <Shield className="w-3.5 h-3.5" />
                    Unhide Comment
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onAction("hideComment", comment.id)}
                    className="px-2.5 py-1.5 rounded text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 flex items-center gap-1.5 transition-colors"
                  >
                    <ShieldAlert className="w-3.5 h-3.5" />
                    Hide Comment
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onAction("deleteComment", comment.id)}
                  className="px-2.5 py-1.5 rounded text-xs font-bold bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30 flex items-center gap-1.5 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete Comment
                </button>
                <button
                  type="button"
                  onClick={() => onAction("banUser", comment.user_id, "Abusive comment: " + comment.body.slice(0, 40))}
                  className="px-2.5 py-1.5 rounded text-xs font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30 hover:bg-purple-500/30 flex items-center gap-1.5 transition-colors"
                >
                  <Ban className="w-3.5 h-3.5" />
                  Ban Author
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };


  const renderChatRow = (msg: AdminChatMessage) => {
    const isExpanded = expandedId === `${msg.channel}:${msg.id}`;
    const attachmentUrl = msg.attachment_url ? resolveMediaUrl(msg.attachment_url) : msg.attachment_id ? resolveMediaUrl(`/api/objects/${msg.attachment_id}/content`) : null;

    return (
      <div key={`${msg.channel}:${msg.id}`} className="border-b border-border-subtle last:border-0 hover:bg-glass-w5 transition-colors">
        <div className="p-3 flex items-start gap-3">
          <button
            type="button"
            onClick={() => toggleExpand(`${msg.channel}:${msg.id}`)}
            className="text-retro-muted hover:text-retro-fg transition-transform shrink-0 mt-0.5"
            title={isExpanded ? "Collapse" : "Expand chat message"}
          >
            {isExpanded ? <ChevronUp className="w-4 h-4 text-cyan-300" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {attachmentUrl && (
            <AdminMediaThumbnail
              objectId={msg.attachment_id}
              directUrl={msg.attachment_url}
              identity={identity}
              mimeType={msg.attachment_mime}
              title="Chat Attachment"
              subtitle={msg.sender_name || msg.sender_id}
              className="w-10 h-10 shrink-0"
              onZoom={onZoom}
            />
          )}
          <div className="flex-1 min-w-0 cursor-pointer" onClick={() => toggleExpand(`${msg.channel}:${msg.id}`)}>
            <div className="flex items-center gap-2">
              <Badge variant="info" size="sm">{msg.channel}</Badge>
              <span className="text-xs font-semibold text-retro-fg">{msg.sender_name || msg.sender_id.slice(0, 8)}</span>
            </div>
            <p className="text-xs text-retro-body mt-1">{msg.body || "[attachment]"}</p>
            <p className="text-[10px] text-retro-muted mt-1">{new Date(msg.created_at).toLocaleString()}</p>
          </div>
          <button
            type="button"
            onClick={() => onAction("deleteChat", msg.channel, msg.id)}
            className="px-2 py-1 text-[10px] rounded border border-red-500/30 text-red-300 hover:bg-red-500/10 shrink-0"
          >
            Delete
          </button>
        </div>

        {isExpanded && (
          <div className="px-4 pb-4 pt-1 bg-surface-elevated/40 border-t border-border-subtle/50 flex flex-col md:flex-row gap-4 items-start animate-orbit-fade-in">
            {attachmentUrl && (
              <div className="relative group shrink-0">
                <AdminMediaThumbnail
                  objectId={msg.attachment_id}
                  directUrl={msg.attachment_url}
                  identity={identity}
                  mimeType={msg.attachment_mime}
                  title="Chat Attachment"
                  subtitle={msg.sender_name || msg.sender_id}
                  className="w-48 h-48 md:w-56 md:h-56 rounded-lg cursor-zoom-in"
                  onZoom={onZoom}
                />
                <button
                  type="button"
                  onClick={() => onZoom(attachmentUrl, Boolean(msg.attachment_mime?.startsWith("video/")), "Chat Attachment", msg.sender_name || msg.sender_id)}
                  className="absolute bottom-2 right-2 px-2 py-1 bg-black/70 hover:bg-black text-white text-[10px] rounded flex items-center gap-1 border border-border-glass opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Maximize2 className="w-3 h-3" /> Full View
                </button>
              </div>
            )}
            <div className="flex-1 min-w-0 space-y-2.5">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs bg-surface-canvas/60 p-2.5 rounded-lg border border-border-glass">
                <div>
                  <span className="text-retro-muted block text-[10px]">Message ID</span>
                  <span className="font-mono text-retro-fg break-all text-[10px]">{msg.id}</span>
                </div>
                <div>
                  <span className="text-retro-muted block text-[10px]">Channel</span>
                  <Badge variant="primary" size="sm">{msg.channel}</Badge>
                </div>
                <div>
                  <span className="text-retro-muted block text-[10px]">Sender</span>
                  <span className="font-semibold text-retro-fg">{msg.sender_name || msg.sender_id.slice(0, 10)}</span>
                  <span className="font-mono text-cyan-300 block text-[10px] break-all">{msg.sender_id}</span>
                </div>
                <div>
                  <span className="text-retro-muted block text-[10px]">Recipient</span>
                  <span className="text-retro-fg">{msg.recipient_name || msg.recipient_id?.slice(0, 10) || "Channel Broadcast"}</span>
                </div>
                <div>
                  <span className="text-retro-muted block text-[10px]">Created At</span>
                  <span className="text-retro-fg font-mono">{new Date(msg.created_at).toLocaleString()}</span>
                </div>
              </div>
              {msg.body && (
                <div className="text-xs bg-surface-canvas/40 p-2.5 rounded border border-border-glass">
                  <span className="text-retro-muted text-[10px] block mb-0.5">Chat Message Body:</span>
                  <p className="text-retro-fg font-sans whitespace-pre-wrap">{msg.body}</p>
                </div>
              )}
              <div className="pt-2 flex flex-wrap gap-2 items-center">
                <button
                  type="button"
                  onClick={() => onAction("deleteChat", msg.channel, msg.id)}
                  className="px-2.5 py-1.5 rounded text-xs font-bold bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30 flex items-center gap-1.5 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete Message
                </button>
                <button
                  type="button"
                  onClick={() => onAction("banUser", msg.sender_id, "Inappropriate chat message in " + msg.channel)}
                  className="px-2.5 py-1.5 rounded text-xs font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30 hover:bg-purple-500/30 flex items-center gap-1.5 transition-colors"
                >
                  <Ban className="w-3.5 h-3.5" />
                  Ban Sender
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  if (isLoading && reports.length === 0 && comments.length === 0 && chatMessages.length === 0) {
    return <AdminLoadingState rows={5} columns={4} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-retro-fg">Moderation center</h1>
          <p className="text-xs text-retro-muted mt-1">Unified report queue and in-loco content moderation</p>
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
              onClick={() => { setActiveSubTab(tab.id); setExpandedId(null); }}
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

      {activeSubTab === "reports" && (
        <div className="space-y-4">
          <AdminFilterBar
            filters={reportsParams.filters || {}}
            onFiltersChange={filters => setReportsParams(p => ({ ...p, filters, page: 1 }))}
            configs={[
              { key: "q", label: "Search", type: "text", placeholder: "Reporter, reason, target..." },
              { key: "status", label: "Status", type: "select", options: [
                { value: "open", label: "Open" },
                { value: "reviewed", label: "Reviewed" },
                { value: "resolved", label: "Resolved" },
                { value: "dismissed", label: "Dismissed" },
                { value: "", label: "All" },
              ]},
              { key: "category", label: "Category", type: "select", options: [
                { value: "", label: "All" },
                { value: "spam", label: "Spam" },
                { value: "harassment", label: "Harassment" },
                { value: "illegal", label: "Illegal Content" },
                { value: "sexual", label: "Sexual Content" },
                { value: "violence", label: "Violence" },
                { value: "other", label: "Other" },
              ]},
            ]}
            searchValue=""
            onSearchChange={() => {}}
            showSearch={false}
          />
          <div className="rounded-xl border border-border-glass bg-surface-raised overflow-hidden">
            <div className="px-4 py-3 border-b border-border-glass flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider">Content Reports ({reportsTotal})</h2>
            </div>
            {reports.length === 0 ? (
              <AdminEmptyState title="No reports" description="Content reports will appear here" illustration="folder" />
            ) : (
              <div className="divide-y divide-border-subtle">
                {reports.map(renderReportRow)}
              </div>
            )}
          </div>
        </div>
      )}

      {activeSubTab === "comments" && (
        <div className="rounded-xl border border-border-glass bg-surface-raised overflow-hidden">
          <div className="px-4 py-3 border-b border-border-glass flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider">Lobby Comments ({comments.length})</h2>
          </div>
          {comments.length === 0 ? (
            <AdminEmptyState title="No lobby comments" description="Comments will appear here" illustration="folder" />
          ) : (
            <div className="divide-y divide-border-subtle">
              {comments.map(renderCommentRow)}
            </div>
          )}
        </div>
      )}


      {activeSubTab === "chat" && (
        <div className="space-y-4">
          <AdminFilterBar
            filters={chatParams.filters || {}}
            onFiltersChange={filters => setChatParams(p => ({ ...p, filters, page: 1 }))}
            configs={[
              { key: "channel", label: "Channel", type: "select", options: [
                { value: "all", label: "All Channels" },
                { value: "lobby", label: "Lobby" },
                { value: "group", label: "Group Chat" },
                { value: "match", label: "Match Chat" },
              ]},
              { key: "q", label: "Search", type: "text", placeholder: "Message content..." },
            ]}
            searchValue=""
            onSearchChange={() => {}}
            showSearch={false}
          />
          <div className="rounded-xl border border-border-glass bg-surface-raised overflow-hidden">
            <div className="px-4 py-3 border-b border-border-glass flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider">Chat Messages</h2>
            </div>
            {chatMessages.length === 0 ? (
              <AdminEmptyState title="No messages" description="Chat messages will appear here" illustration="folder" />
            ) : (
              <div className="divide-y divide-border-subtle">
                {chatMessages.map(renderChatRow)}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
