"use client";

import {   AdminEmptyState, AdminLoadingState, Badge, StatusBadge, FormModal } from "../../../components/admin/primitives";
import { adminApi } from "../../../utils/adminApi";
import { useState, useCallback, useEffect } from "react";
import { Megaphone, Heart, Plus } from "lucide-react";
import { cn } from "../../../lib/utils";
import type { Announcement, AdminRecommendation, OrbitIdentity } from "../../../utils/adminTypes";

interface PlatformTabProps {
  identity: OrbitIdentity | null;
  pinVerified: boolean;
  onAction: (action: string, ...args: unknown[]) => void;
}

const subTabs = [
  { id: "announcements", label: "Announcements", icon: Megaphone },
  { id: "recommendations", label: "Feedback & Recs", icon: Heart },
] as const;

type SubTab = typeof subTabs[number]["id"];

function asArray<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

export function PlatformTab({ identity, pinVerified, onAction }: PlatformTabProps) {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>("announcements");
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [recommendations, setRecommendations] = useState<AdminRecommendation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [newAnnouncement, setNewAnnouncement] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingRec, setEditingRec] = useState<AdminRecommendation | null>(null);

  const fetchData = useCallback(async () => {
    if (!identity || !pinVerified) return;
    setIsLoading(true);
    try {
      const [annRes, recRes] = await Promise.all([
        adminApi.announcements(identity),
        adminApi.recommendations(identity),
      ]);
      setAnnouncements(asArray(annRes));
      setRecommendations(asArray(recRes));
    } catch {
    } finally {
      setIsLoading(false);
    }
  }, [identity, pinVerified]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleCreateAnnouncement = async () => {
    if (!identity || !newAnnouncement.trim()) return;
    try {
      await adminApi.createAnnouncement(identity, newAnnouncement.trim(), true);
      setNewAnnouncement("");
      setShowCreateModal(false);
      fetchData();
    } catch {
    }
  };

  const handleDeleteAnnouncement = async (id: string) => {
    if (!identity) return;
    try {
      await adminApi.deleteAnnouncement(identity, id);
      fetchData();
    } catch {
    }
  };

  const handleUpdateRecommendation = async (id: string, status: string) => {
    if (!identity) return;
    try {
      await adminApi.updateRecommendation(identity, id, status);
      setEditingRec(null);
      fetchData();
    } catch {
    }
  };

  const handleDeleteRecommendation = async (id: string) => {
    if (!identity) return;
    try {
      await adminApi.deleteRecommendation(identity, id);
      fetchData();
    } catch {
    }
  };

  if (isLoading && announcements.length === 0 && recommendations.length === 0) {
    return <AdminLoadingState rows={5} columns={4} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-retro-fg">Platform Management</h1>
          <p className="text-xs text-retro-muted mt-1">Announcements, recommendations, and feedback</p>
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

      {activeSubTab === "announcements" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-retro-fg">System Announcements</h2>
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="px-3 py-2 bg-cyan-500 hover:bg-cyan-600 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              New Announcement
            </button>
          </div>

          <div className="rounded-xl border border-border-glass bg-surface-raised overflow-hidden">
            {announcements.length === 0 ? (
              <AdminEmptyState title="No announcements" description="Create your first system announcement" illustration="folder" />
            ) : (
              <div className="divide-y divide-border-subtle">
                {announcements.map(ann => (
                  <div key={ann.id} className="p-4 hover:bg-glass-w5 transition-colors flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-retro-fg truncate">{ann.message}</span>
                        <StatusBadge status={ann.is_active ? "active" : "inactive"} size="sm" />
                      </div>
                      <p className="text-[10px] text-retro-muted mt-1">
                        By {ann.created_by_name || "Unknown"} · {new Date(ann.created_at).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {ann.is_active ? (
                        <button
                          type="button"
                          onClick={() => onAction("toggleAnnouncement", ann.id, false)}
                          className="px-2 py-1 text-[10px] rounded border border-amber-500/30 text-amber-300 hover:bg-amber-500/10"
                        >
                          Deactivate
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onAction("toggleAnnouncement", ann.id, true)}
                          className="px-2 py-1 text-[10px] rounded border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10"
                        >
                          Activate
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onAction("deleteAnnouncement", ann.id)}
                        className="px-2 py-1 text-[10px] rounded border border-red-500/30 text-red-300 hover:bg-red-500/10"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeSubTab === "recommendations" && (
        <div className="space-y-4">
          <h2 className="text-sm font-bold text-retro-fg">Community Feedback & Recommendations</h2>

          <div className="rounded-xl border border-border-glass bg-surface-raised overflow-hidden">
            {recommendations.length === 0 ? (
              <AdminEmptyState title="No feedback" description="User recommendations will appear here" illustration="folder" />
            ) : (
              <div className="divide-y divide-border-subtle">
                {recommendations.map(rec => (
                  <div key={rec.id} className="p-4 hover:bg-glass-w5 transition-colors flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-retro-fg truncate">{rec.content}</span>
                        <Badge variant="info" size="sm">{rec.category}</Badge>
                        <StatusBadge status={rec.status} mapping={{ pending: "pending", reviewed: "info", resolved: "success" }} size="sm" />
                      </div>
                      <p className="text-[10px] text-retro-muted mt-1">
                        From {rec.user_name || rec.user_id.slice(0, 8)} · {new Date(rec.created_at).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {rec.status === "pending" && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleUpdateRecommendation(rec.id, "reviewed")}
                            className="px-2 py-1 text-[10px] rounded border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/10"
                          >
                            Mark Reviewed
                          </button>
                          <button
                            type="button"
                            onClick={() => handleUpdateRecommendation(rec.id, "resolved")}
                            className="px-2 py-1 text-[10px] rounded border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10"
                          >
                            Resolve
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDeleteRecommendation(rec.id)}
                        className="px-2 py-1 text-[10px] rounded border border-red-500/30 text-red-300 hover:bg-red-500/10"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {showCreateModal && (
        <FormModal
          isOpen={true}
          onClose={() => setShowCreateModal(false)}
          onSubmit={handleCreateAnnouncement}
          title="Create Announcement"
          submitLabel="Publish"
          fields={[
            { key: "message", label: "Message", type: "textarea", placeholder: "Enter announcement message...", required: true },
          ]}
          isLoading={false}
        />
      )}
    </div>
  );
}
