"use client";

import { AdminTable, AdminFilterBar, AdminEmptyState, AdminLoadingState, Badge, StatusBadge, ConfirmDialog, DetailModal } from "../../../components/admin/primitives";
import { adminApi } from "../../../utils/adminApi";
import { useState, useCallback, useEffect } from "react";
import {  Ban, Shield, DollarSign, Tag, Trash2, Eye, Settings } from "lucide-react";
import { AdminMediaThumbnail } from "../AdminMediaThumbnail";
import type { AdminUser, AdminObject, TableParams } from "../../../utils/adminTypes";
import type { OrbitIdentity } from "@orbit/crypto";

interface UsersTabProps {
  identity: OrbitIdentity | null;
  pinVerified: boolean;
  onZoom: (url: string, isVideo: boolean, title: string, subtitle: string) => void;
  onAction: (action: string, ...args: unknown[]) => void;
}

export function UsersTab({ identity, pinVerified, onZoom, onAction }: UsersTabProps) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [params, setParams] = useState<TableParams>({
    page: 1,
    pageSize: 50,
    sort: { column: "last_seen", direction: "desc" },
    filters: {},
  });
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [userObjects, setUserObjects] = useState<AdminObject[]>([]);
  const [showUserDetail, setShowUserDetail] = useState(false);
  const [showBanModal, setShowBanModal] = useState<{ user: AdminUser } | null>(null);
  const [banReason, setBanReason] = useState("");
  const [banWipe, setBanWipe] = useState(true);
  const [showTagsModal, setShowTagsModal] = useState<{ user: AdminUser } | null>(null);
  const [tagsInput, setTagsInput] = useState("");
  const [showBalanceModal, setShowBalanceModal] = useState<{ user: AdminUser } | null>(null);
  const [balanceData, setBalanceData] = useState({ score: 0, likes: 0, followers: 0, gcoins: 0 });

  const fetchUsers = useCallback(async () => {
    if (!identity || !pinVerified) return;
    setIsLoading(true);
    try {
      const response = await adminApi.users(identity, params);
      const rows = Array.isArray(response.data) ? response.data : [];
      setUsers(rows);
      setTotal(response.total || rows.length);
    } catch {
    } finally {
      setIsLoading(false);
    }
  }, [identity, pinVerified, params]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleRowAction = (action: string, user: AdminUser) => {
    switch (action) {
      case "ban":
        setShowBanModal({ user });
        setBanReason("");
        setBanWipe(true);
        break;
      case "unban":
        onAction("unban", user.id);
        break;
      case "moderator":
        onAction("moderator", user.id, !user.is_moderator);
        break;
      case "admin":
        onAction("admin", user.id, !user.is_admin);
        break;
      case "balance":
        setShowBalanceModal({ user });
        setBalanceData({ score: user.score || 0, likes: user.likes_received || 0, followers: user.followers_count || 0, gcoins: user.balance || 0 });
        break;
      case "tags":
        setShowTagsModal({ user });
        setTagsInput(user.tags?.join(", ") || "");
        break;
      case "objects":
        onAction("viewObjects", user);
        break;
      case "delete":
        onAction("deleteUser", user.id, user.display_name || user.id);
        break;
    }
  };

  const handleConfirmBan = async () => {
    if (!showBanModal || !identity) return;
    try {
      await adminApi.banUser(identity, showBanModal.user.id, banReason, banWipe);
      setShowBanModal(null);
      fetchUsers();
    } catch {
    }
  };

  const handleSaveTags = async () => {
    if (!showTagsModal || !identity) return;
    const tagList = tagsInput.split(",").map(t => t.trim().replace(/^#/, "")).filter(Boolean);
    try {
      await adminApi.editUserTags(identity, showTagsModal.user.id, tagList);
      setShowTagsModal(null);
      fetchUsers();
    } catch {
    }
  };

  const handleSaveBalance = async () => {
    if (!showBalanceModal || !identity) return;
    try {
      await adminApi.adjustUser(identity, showBalanceModal.user.id, {
        score: balanceData.score,
        likes_received: balanceData.likes,
        followers_count: balanceData.followers,
        add_gcoins: balanceData.gcoins || undefined,
      });
      setShowBalanceModal(null);
      fetchUsers();
    } catch {
    }
  };

  const handleViewObjects = async (user: AdminUser) => {
    if (!identity) return;
    try {
      const objects = await adminApi.userObjects(identity, user.id);
      setUserObjects(objects);
      setSelectedUser(user);
      setShowUserDetail(true);
    } catch {
    }
  };

  if (isLoading && users.length === 0) {
    return <AdminLoadingState rows={10} columns={8} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-retro-fg">User Management</h1>
          <p className="text-xs text-retro-muted mt-1">User moderation, bans, balances, and inspection</p>
        </div>
      </div>

      <AdminFilterBar
        filters={params.filters || {}}
        onFiltersChange={filters => {
          const sortVal = filters.sort;
          const newSort = typeof sortVal === "string" && sortVal
            ? (sortVal.startsWith("-")
                ? { column: sortVal.slice(1), direction: "asc" as const }
                : { column: sortVal, direction: "desc" as const })
            : params.sort;
          setParams(p => ({ ...p, filters, sort: newSort, page: 1 }));
        }}
        configs={[
          { key: "q", label: "Search", type: "text", placeholder: "Name, ID, tags..." },
          { key: "role", label: "Role", type: "select", options: [
            { value: "", label: "All" },
            { value: "admin", label: "Admins" },
            { value: "user", label: "Users" },
          ]},
          { key: "status", label: "Status", type: "select", options: [
            { value: "", label: "All" },
            { value: "banned", label: "Banned" },
            { value: "active", label: "Active" },
            { value: "online", label: "Online" },
            { value: "offline_warning", label: "Offline Warning" },
            { value: "offline_deletion", label: "Offline Deletion" },
          ]},
          { key: "sort", label: "Sort By", type: "select", options: [
            { value: "last_seen", label: "Last Seen (Newest)" },
            { value: "-last_seen", label: "Last Seen (Oldest)" },
            { value: "objects", label: "Most Objects Sent" },
            { value: "matches", label: "Most Matches Played" },
            { value: "likes_received", label: "Most Likes Received" },
            { value: "-name", label: "Name (A-Z)" },
            { value: "name", label: "Name (Z-A)" },
          ]},
        ]}
        searchValue=""
        onSearchChange={() => {}}
        showSearch={false}
      />

      <AdminTable
        config={{
          columns: [
            {
              accessorKey: "display_name",
              header: "User",
              cell: (_, row) => (
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-surface-interactive border border-border-glass flex items-center justify-center overflow-hidden shrink-0">
                    {row.pfp_url ? (
                      <img src={row.pfp_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <svg className="w-4 h-4 text-retro-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                      </svg>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-retro-fg truncate">{row.display_name || "Unknown"}</p>
                    <p className="text-[10px] text-retro-muted truncate font-mono">{row.id.slice(0, 12)}</p>
                  </div>
                </div>
              ),
            },
            {
              accessorKey: "is_banned",
              header: "Status",
              cell: (_, row) => (
                <div className="flex items-center gap-1.5">
                  {row.is_banned ? (
                    <StatusBadge status="banned" size="sm" />
                  ) : row.online ? (
                    <>
                      <span className="w-2 h-2 rounded-full bg-emerald-400" />
                      <StatusBadge status="online" size="sm" dot={false} />
                    </>
                  ) : (
                    <StatusBadge status="offline" size="sm" dot={false} />
                  )}
                  {row.is_admin && <Badge variant="primary" size="sm">Admin</Badge>}
                  {row.is_moderator && <Badge variant="info" size="sm">Mod</Badge>}
                  {row.active_tier_match && <Badge variant="warning" size="sm">In Tier</Badge>}
                </div>
              ),
            },
            {
              accessorKey: "balance",
              header: "Balance",
              cell: (value) => (
                <span className="font-mono text-retro-fg">${(value as number).toLocaleString()}</span>
              ),
            },
            {
              accessorKey: "score",
              header: "Score",
              cell: (value) => (
                <span className="font-mono text-retro-fg">{(value as number).toLocaleString()}</span>
              ),
            },
            {
              accessorKey: "matches_total",
              header: "Matches",
              cell: (value) => (
                <span className="font-mono text-retro-muted">{(value as number).toLocaleString()}</span>
              ),
            },
            {
              accessorKey: "objects_sent_count",
              header: "Objects",
              cell: (value) => (
                <span className="font-mono text-retro-muted">{(value as number).toLocaleString()}</span>
              ),
            },
            {
              accessorKey: "last_seen",
              header: "Last Seen",
              cell: (value) => {
                if (!value) return <span className="text-retro-muted">Never</span>;
                const date = new Date(value as string);
                const now = Date.now();
                const diff = now - date.getTime();
                if (diff < 3 * 60 * 1000) return <span className="text-emerald-400 font-mono">Just now</span>;
                if (diff < 24 * 60 * 60 * 1000) return <span className="font-mono text-retro-muted">{date.toLocaleTimeString()}</span>;
                return <span className="font-mono text-retro-muted">{date.toLocaleDateString()}</span>;
              },
            },
          ],
          fetchFn: async (p) => {
            const response = await adminApi.users(identity!, p);
            return response;
          },
          rowActions: [
            { label: "View Objects", icon: Eye, onClick: (row: AdminUser) => handleViewObjects(row) },
            { label: "Ban / Unban", icon: (row: AdminUser) => row.is_banned ? Shield : Ban, variant: (row: AdminUser) => row.is_banned ? "ghost" : "danger", onClick: (row: AdminUser) => handleRowAction(row.is_banned ? "unban" : "ban", row) },
            { label: "Moderator", icon: Shield, variant: (row: AdminUser) => row.is_moderator ? "primary" : "default", onClick: (row: AdminUser) => handleRowAction("moderator", row) },
            { label: "Admin", icon: Settings, variant: (row: AdminUser) => row.is_admin ? "primary" : "default", onClick: (row: AdminUser) => handleRowAction("admin", row) },
            { label: "Balance", icon: DollarSign, onClick: (row: AdminUser) => handleRowAction("balance", row) },
            { label: "Tags", icon: Tag, onClick: (row: AdminUser) => handleRowAction("tags", row) },
            { label: "Delete User", icon: Trash2, variant: "danger", onClick: (row: AdminUser) => handleRowAction("delete", row) },
          ],
          defaultSort: { column: "last_seen", direction: "desc" },
          enableRowSelection: true,
        }}
        data={users}
        total={total}
        isLoading={isLoading}
        onParamsChange={setParams}
        className="h-[600px]"
      />

      {showBanModal && (
        <ConfirmDialog
          isOpen={true}
          onClose={() => setShowBanModal(null)}
          onConfirm={handleConfirmBan}
          title={`Ban ${showBanModal.user.display_name || showBanModal.user.id.slice(0, 8)}?`}
          description={`Reason: ${banReason || "No reason provided"}${banWipe ? " · Content will be wiped" : ""}`}
          confirmLabel="Ban User"
          variant="danger"
        />
      )}

      {showTagsModal && (
        <DetailModal
          isOpen={true}
          onClose={() => setShowTagsModal(null)}
          title="Edit Discovery Tags"
          subtitle={showTagsModal.user.display_name || showTagsModal.user.id}
          size="sm"
        >
          <div className="space-y-4">
            <div>
              <label className="text-[10px] font-bold text-retro-muted uppercase tracking-wider block mb-1">Tags (comma separated)</label>
              <textarea
                value={tagsInput}
                onChange={e => setTagsInput(e.target.value)}
                rows={3}
                className="w-full bg-surface-canvas border border-border-glass rounded px-3 py-2 text-xs outline-none focus:border-retro-accent"
                placeholder="tag1, tag2, tag3"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-border-glass">
              <button onClick={() => setShowTagsModal(null)} className="px-3 py-1.5 text-xs font-bold rounded border border-border-glass text-retro-fg hover:bg-glass-w10">Cancel</button>
              <button onClick={handleSaveTags} className="px-3 py-1.5 text-xs font-bold rounded bg-cyan-500 text-black hover:bg-cyan-400">Save Tags</button>
            </div>
          </div>
        </DetailModal>
      )}

      {showBalanceModal && (
        <DetailModal
          isOpen={true}
          onClose={() => setShowBalanceModal(null)}
          title="Adjust Balance & Metrics"
          subtitle={showBalanceModal.user.display_name || showBalanceModal.user.id}
          size="md"
        >
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-retro-muted uppercase tracking-wider block">Daily Score</label>
              <input
                type="number"
                value={balanceData.score}
                onChange={e => setBalanceData(d => ({ ...d, score: Number(e.target.value) }))}
                className="w-full bg-surface-canvas border border-border-glass rounded px-3 py-2 text-xs outline-none focus:border-retro-accent"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-retro-muted uppercase tracking-wider block">Likes Received</label>
              <input
                type="number"
                value={balanceData.likes}
                onChange={e => setBalanceData(d => ({ ...d, likes: Number(e.target.value) }))}
                className="w-full bg-surface-canvas border border-border-glass rounded px-3 py-2 text-xs outline-none focus:border-retro-accent"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-retro-muted uppercase tracking-wider block">Followers</label>
              <input
                type="number"
                value={balanceData.followers}
                onChange={e => setBalanceData(d => ({ ...d, followers: Number(e.target.value) }))}
                className="w-full bg-surface-canvas border border-border-glass rounded px-3 py-2 text-xs outline-none focus:border-retro-accent"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-retro-muted uppercase tracking-wider block">G-Coins (delta)</label>
              <input
                type="number"
                value={balanceData.gcoins}
                onChange={e => setBalanceData(d => ({ ...d, gcoins: Number(e.target.value) }))}
                className="w-full bg-surface-canvas border border-border-glass rounded px-3 py-2 text-xs outline-none focus:border-retro-accent"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-4 border-t border-border-glass">
            <button onClick={() => setShowBalanceModal(null)} className="px-3 py-1.5 text-xs font-bold rounded border border-border-glass text-retro-fg hover:bg-glass-w10">Cancel</button>
            <button onClick={handleSaveBalance} className="px-3 py-1.5 text-xs font-bold rounded bg-cyan-500 text-black hover:bg-cyan-400">Save Changes</button>
          </div>
        </DetailModal>
      )}

      {showUserDetail && selectedUser && (
        <DetailModal
          isOpen={true}
          onClose={() => setShowUserDetail(false)}
          title={`Objects for ${selectedUser.display_name || selectedUser.id.slice(0, 8)}`}
          size="xl"
        >
          <div className="space-y-3">
            {userObjects.length === 0 ? (
              <AdminEmptyState title="No objects" description="This user has no uploaded objects" illustration="folder" />
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                {userObjects.map(obj => {
                  const objectProtected = !obj.content_url || obj.content_url?.startsWith("/api/objects/");
                  const objectId = objectProtected ? obj.id : null;
                  const directUrl = obj.content_url && !obj.content_url.startsWith("/api/objects/") ? obj.content_url : null;

                  return (
                    <div key={obj.id} className="group relative">
                      <AdminMediaThumbnail
                        objectId={objectId}
                        directUrl={directUrl}
                        identity={identity}
                        mimeType={obj.mime_type}
                        title={selectedUser.display_name || selectedUser.id}
                        subtitle={obj.mime_type || "Media"}
                        className="aspect-square cursor-pointer"
                        imageClassName="group-hover:scale-105 transition-transform duration-150"
                        onZoom={onZoom}
                        badge={obj.is_story === 1 && (
                          <span className="absolute top-1 right-1 px-1 py-0.5 bg-cyan-500/10 border border-purple-300 text-cyan-300 font-mono font-bold text-[10px] rounded">STORY</span>
                        )}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </DetailModal>
      )}
    </div>
  );
}
