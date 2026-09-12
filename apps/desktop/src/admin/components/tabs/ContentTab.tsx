"use client";

import { AdminFilterBar, AdminEmptyState, AdminLoadingState, Badge, StatusBadge, DetailModal } from "../../../components/admin/primitives";
import { adminApi } from "../../../utils/adminApi";
import { useState, useCallback, useEffect } from "react";
import {
  Globe,
  GitCompare,
  Layers,
  Megaphone,
  Plus,
} from "lucide-react";
import { cn } from "../../../lib/utils";
import { AdminMediaThumbnail } from "../AdminMediaThumbnail";
import type {
  AdminPost,
  AdminLobbyImage,
  AdminMatch,
  AdminArchivedMatch,
  AdminTierMatch,
  AdminRoom,
  AdminBabecockRound,
  Announcement,
  AdminRecommendation,
  TableParams,
  OrbitIdentity,
} from "../../../utils/adminTypes";

interface ContentTabProps {
  identity: OrbitIdentity | null;
  pinVerified: boolean;
  onZoom: (url: string, isVideo: boolean, title: string, subtitle: string) => void;
  onAction: (action: string, ...args: unknown[]) => void;
}

const subTabs = [
  { id: "posts_lobby", label: "Public Posts & Lobby", icon: Globe },
  { id: "matches", label: "Matches & Duels", icon: GitCompare },
  { id: "rooms", label: "Rooms & Sessions", icon: Layers },
  { id: "announcements", label: "Announcements & Feedback", icon: Megaphone },
] as const;

type SubTab = typeof subTabs[number]["id"];

function asArray<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

export function ContentTab({ identity, pinVerified, onZoom, onAction }: ContentTabProps) {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>("posts_lobby");

  // Posts & Lobby State
  const [contentSection, setContentSection] = useState<"posts" | "lobby">("posts");
  const [posts, setPosts] = useState<AdminPost[]>([]);
  const [postsTotal, setPostsTotal] = useState(0);
  const [postsParams, setPostsParams] = useState<TableParams>({ page: 1, pageSize: 50, filters: { visibility: "all" } });
  const [lobbyImages, setLobbyImages] = useState<AdminLobbyImage[]>([]);

  // Matches State
  const [matchSection, setMatchSection] = useState<"live" | "archive" | "tiers">("live");
  const [matches, setMatches] = useState<AdminMatch[]>([]);
  const [archivedMatches, setArchivedMatches] = useState<AdminArchivedMatch[]>([]);
  const [archiveTotal, setArchiveTotal] = useState(0);
  const [specialMatches, setSpecialMatches] = useState<AdminTierMatch[]>([]);
  const [archiveParams] = useState<TableParams>({ page: 1, pageSize: 30 });

  // Rooms State
  const [rooms, setRooms] = useState<AdminRoom[]>([]);
  const [babecockRounds, setBabecockRounds] = useState<AdminBabecockRound[]>([]);

  // Announcements State
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [recommendations, setRecommendations] = useState<AdminRecommendation[]>([]);
  const [showCreateAnnModal, setShowCreateAnnModal] = useState(false);
  const [newAnnouncementText, setNewAnnouncementText] = useState("");

  const [isLoading, setIsLoading] = useState(false);

  const fetchPosts = useCallback(async () => {
    if (!identity || !pinVerified) return;
    setIsLoading(true);
    try {
      const response = await adminApi.posts(identity, postsParams);
      const rows = asArray(response.data);
      setPosts(rows);
      setPostsTotal(response.total || rows.length);
    } catch {
    } finally {
      setIsLoading(false);
    }
  }, [identity, pinVerified, postsParams]);

  const fetchLobbyImages = useCallback(async () => {
    if (!identity || !pinVerified) return;
    setIsLoading(true);
    try {
      const data = await adminApi.lobbyImages(identity);
      setLobbyImages(asArray(data));
    } catch {
    } finally {
      setIsLoading(false);
    }
  }, [identity, pinVerified]);

  const fetchMatches = useCallback(async () => {
    if (!identity || !pinVerified) return;
    setIsLoading(true);
    try {
      const [matchesRes, specialRes] = await Promise.all([
        adminApi.matches(identity),
        adminApi.specialMatches(identity),
      ]);
      setMatches(asArray(matchesRes));
      setSpecialMatches(asArray(specialRes));
    } catch {
    } finally {
      setIsLoading(false);
    }
  }, [identity, pinVerified]);

  const fetchArchive = useCallback(async () => {
    if (!identity || !pinVerified) return;
    setIsLoading(true);
    try {
      const response = await adminApi.matchArchive(identity, archiveParams);
      const rows = asArray(response.data);
      setArchivedMatches(rows);
      setArchiveTotal(response.total || rows.length);
    } catch {
    } finally {
      setIsLoading(false);
    }
  }, [identity, pinVerified, archiveParams]);

  const fetchRooms = useCallback(async () => {
    if (!identity || !pinVerified) return;
    setIsLoading(true);
    try {
      const [roomsRes, babecockRes] = await Promise.all([
        adminApi.rooms(identity),
        adminApi.babecock(identity),
      ]);
      setRooms(asArray(roomsRes));
      setBabecockRounds(asArray(babecockRes));
    } catch {
    } finally {
      setIsLoading(false);
    }
  }, [identity, pinVerified]);

  const fetchAnnouncements = useCallback(async () => {
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
    if (activeSubTab === "posts_lobby") {
      if (contentSection === "posts") fetchPosts();
      else fetchLobbyImages();
    }
  }, [activeSubTab, contentSection, fetchPosts, fetchLobbyImages]);

  useEffect(() => {
    if (activeSubTab === "matches") {
      if (matchSection === "archive") fetchArchive();
      else fetchMatches();
    }
  }, [activeSubTab, matchSection, fetchMatches, fetchArchive]);

  useEffect(() => {
    if (activeSubTab === "rooms") fetchRooms();
  }, [activeSubTab, fetchRooms]);

  useEffect(() => {
    if (activeSubTab === "announcements") fetchAnnouncements();
  }, [activeSubTab, fetchAnnouncements]);

  const handleCreateAnnouncement = async () => {
    if (!identity || !newAnnouncementText.trim()) return;
    try {
      await adminApi.createAnnouncement(identity, newAnnouncementText.trim(), true);
      setNewAnnouncementText("");
      setShowCreateAnnModal(false);
      fetchAnnouncements();
    } catch {
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-black text-retro-fg uppercase tracking-wider">Content & Games</h1>
          <p className="text-xs text-retro-muted mt-0.5">Manage public feed media, live duels, game sessions, and broadcast notices</p>
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
              {tab.id === "matches" && matches.length > 0 && (
                <span className="ml-1 px-1.5 py-0.2 bg-purple-500/20 text-purple-300 rounded-full text-[10px]">
                  {matches.length} live
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Subtab 1: Public Posts & Lobby Board (NO Private Content) */}
      {activeSubTab === "posts_lobby" && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 border-b border-border-glass pb-3">
            <button
              type="button"
              onClick={() => setContentSection("posts")}
              className={cn(
                "px-3 py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer",
                contentSection === "posts" ? "bg-glass-w10 text-retro-fg" : "text-retro-muted hover:text-retro-body"
              )}
            >
              Feed Posts ({postsTotal})
            </button>
            <button
              type="button"
              onClick={() => setContentSection("lobby")}
              className={cn(
                "px-3 py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer",
                contentSection === "lobby" ? "bg-glass-w10 text-retro-fg" : "text-retro-muted hover:text-retro-body"
              )}
            >
              Lobby Board Images ({lobbyImages.length})
            </button>
          </div>

          {contentSection === "posts" && (
            <div className="space-y-4">
              <AdminFilterBar
                searchPlaceholder="Search posts by caption or author..."
                searchValue={String(postsParams.filters?.q || "")}
                onSearchChange={(q) => setPostsParams(p => ({ ...p, page: 1, filters: { ...p.filters, q } }))}
                filters={postsParams.filters || {}}
                onFiltersChange={(filters) => setPostsParams(p => ({ ...p, page: 1, filters }))}
                configs={[
                  {
                    key: "visibility",
                    label: "Visibility",
                    type: "select",
                    options: [
                      { label: "All Posts", value: "all" },
                      { label: "Public (Visible)", value: "visible" },
                      { label: "Hidden", value: "hidden" },
                    ],
                  },
                ]}
              />

              <div className="rounded-xl border border-border-glass bg-surface-raised overflow-hidden">
                {isLoading ? (
                  <AdminLoadingState rows={6} columns={4} />
                ) : posts.length === 0 ? (
                  <AdminEmptyState title="No posts found" description="No public feed posts match filter" illustration="folder" />
                ) : (
                  <div className="divide-y divide-border-subtle">
                    {posts.map(post => {
                      const isHidden = Boolean(post.hidden_at);
                      return (
                        <div key={post.id} className="p-3 flex items-center justify-between gap-3 hover:bg-glass-w5 transition-colors">
                          <AdminMediaThumbnail
                            directUrl={post.content_url || null}
                            identity={identity}
                            mimeType={post.mime_type}
                            title={post.post_caption || "Post"}
                            subtitle={post.author_name || "Author"}
                            className="w-12 h-12 shrink-0 cursor-zoom-in"
                            onZoom={onZoom}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-retro-fg">{post.author_name || "Unknown Author"}</span>
                              {isHidden && <Badge variant="warning" size="sm">Hidden</Badge>}
                              <span className="text-[10px] text-retro-muted">{new Date(post.created_at).toLocaleString()}</span>
                            </div>
                            <p className="text-xs text-retro-body mt-1 truncate">{post.post_caption || "No caption"}</p>
                            <div className="flex items-center gap-2 mt-1 text-[10px] text-retro-muted">
                              <span>{post.like_count || 0} likes</span>
                              <span>·</span>
                              <span>{post.comment_count || 0} comments</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => { onAction("togglePostVisibility", post); setTimeout(fetchPosts, 300); }}
                              className="px-2.5 py-1 text-xs font-semibold rounded border border-border-glass text-retro-muted hover:text-retro-fg cursor-pointer"
                            >
                              {isHidden ? "Unhide" : "Hide"}
                            </button>
                            <button
                              type="button"
                              onClick={() => { onAction("deletePost", post.id); setTimeout(fetchPosts, 300); }}
                              className="px-2.5 py-1 text-xs font-semibold rounded border border-red-500/30 text-red-300 hover:bg-red-500/10 cursor-pointer"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {contentSection === "lobby" && (
            <div className="rounded-xl border border-border-glass bg-surface-raised overflow-hidden">
              {lobbyImages.length === 0 ? (
                <AdminEmptyState title="No lobby images" description="Lobby board is clear" illustration="folder" />
              ) : (
                <div className="divide-y divide-border-subtle">
                  {lobbyImages.map(img => (
                    <div key={img.id} className="p-3 flex items-center justify-between gap-3 hover:bg-glass-w5 transition-colors">
                      <AdminMediaThumbnail
                        directUrl={img.content_url || null}
                        identity={identity}
                        mimeType="image/jpeg"
                        title="Lobby Image"
                        subtitle={img.user_name || img.user_id.slice(0, 8)}
                        className="w-12 h-12 shrink-0 cursor-zoom-in"
                        onZoom={onZoom}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-retro-fg">{img.user_name || img.user_id.slice(0, 10)}</span>
                          <span className="text-[10px] text-retro-muted">{new Date(img.created_at).toLocaleString()}</span>
                        </div>
                        <p className="text-[10px] text-retro-muted mt-0.5 font-mono">{img.id}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => { onAction("deleteLobbyImage", img.id); setTimeout(fetchLobbyImages, 300); }}
                        className="px-2.5 py-1 text-xs font-semibold rounded border border-red-500/30 text-red-300 hover:bg-red-500/10 cursor-pointer"
                      >
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Subtab 2: Matches & Duels */}
      {activeSubTab === "matches" && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 border-b border-border-glass pb-3">
            <button
              type="button"
              onClick={() => setMatchSection("live")}
              className={cn(
                "px-3 py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer",
                matchSection === "live" ? "bg-glass-w10 text-retro-fg" : "text-retro-muted hover:text-retro-body"
              )}
            >
              Live Matches ({matches.length})
            </button>
            <button
              type="button"
              onClick={() => setMatchSection("archive")}
              className={cn(
                "px-3 py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer",
                matchSection === "archive" ? "bg-glass-w10 text-retro-fg" : "text-retro-muted hover:text-retro-body"
              )}
            >
              Match Archive ({archiveTotal})
            </button>
            <button
              type="button"
              onClick={() => setMatchSection("tiers")}
              className={cn(
                "px-3 py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer",
                matchSection === "tiers" ? "bg-glass-w10 text-retro-fg" : "text-retro-muted hover:text-retro-body"
              )}
            >
              Tier Matches ({specialMatches.length})
            </button>
          </div>

          {matchSection === "live" && (
            <div className="rounded-xl border border-border-glass bg-surface-raised overflow-hidden">
              {matches.length === 0 ? (
                <AdminEmptyState title="No live matches" description="No duels in progress" illustration="chart" />
              ) : (
                <div className="divide-y divide-border-subtle">
                  {matches.map(m => (
                    <div key={m.id} className="p-4 flex flex-wrap items-center justify-between gap-3 hover:bg-glass-w5 transition-colors">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-retro-fg">{m.user_a_name || m.user_a.slice(0, 8)}</span>
                          <span className="text-[10px] text-retro-muted">vs</span>
                          <span className="text-xs font-bold text-retro-fg">{m.user_b_name || m.user_b.slice(0, 8)}</span>
                          <Badge variant="info" size="sm">LIVE</Badge>
                        </div>
                        <p className="text-[10px] text-retro-muted mt-1">
                          Phase: {m.phase || m.status} · Round {m.round_seq || 1} · Created {new Date(m.created_at).toLocaleTimeString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => { onAction("forceEnd", m.id); setTimeout(fetchMatches, 300); }}
                          className="px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded-lg text-xs font-bold transition-colors cursor-pointer"
                        >
                          Force End
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {matchSection === "archive" && (
            <div className="rounded-xl border border-border-glass bg-surface-raised overflow-hidden">
              {archivedMatches.length === 0 ? (
                <AdminEmptyState title="No archived matches" description="Match history is clear" illustration="chart" />
              ) : (
                <div className="divide-y divide-border-subtle">
                  {archivedMatches.map(m => (
                    <div key={m.id} className="p-3 flex items-center justify-between gap-3 hover:bg-glass-w5 transition-colors">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-retro-fg">{m.user_a_name || m.user_a.slice(0, 8)} vs {m.user_b_name || m.user_b.slice(0, 8)}</span>
                          <StatusBadge status={m.result} mapping={{ winner_a: "success", winner_b: "success", draw: "info", forfeit_a: "warning", forfeit_b: "warning", no_match: "neutral", admin_cancelled: "danger" }} />
                        </div>
                        <p className="text-[10px] text-retro-muted mt-0.5">
                          Score: {m.score_a} - {m.score_b} · Ended: {new Date(m.ended_at).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {matchSection === "tiers" && (
            <div className="rounded-xl border border-border-glass bg-surface-raised overflow-hidden">
              {specialMatches.length === 0 ? (
                <AdminEmptyState title="No tier matches" description="No special tier matches active" illustration="chart" />
              ) : (
                <div className="divide-y divide-border-subtle">
                  {specialMatches.map(t => (
                    <div key={t.id} className="p-3 flex items-center justify-between gap-3 hover:bg-glass-w5 transition-colors">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-retro-fg">{t.user_a_name || t.user_a.slice(0, 8)} vs {t.user_b_name || t.user_b.slice(0, 8)}</span>
                          <Badge variant="warning" size="sm">Tier {t.tier}</Badge>
                        </div>
                        <p className="text-[10px] text-retro-muted mt-0.5">
                          Tier: {t.tier} · Status: {t.status} {t.last_result ? `· Result: ${t.last_result}` : ""}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => { onAction("endTier", t.id); setTimeout(fetchMatches, 300); }}
                        className="px-2.5 py-1 text-xs font-semibold rounded border border-red-500/30 text-red-300 hover:bg-red-500/10 cursor-pointer"
                      >
                        End Tier
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Subtab 3: Rooms & Sessions */}
      {activeSubTab === "rooms" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Custom Rooms */}
            <div className="rounded-xl border border-border-glass bg-surface-raised overflow-hidden">
              <div className="px-4 py-3 border-b border-border-glass flex items-center justify-between">
                <h2 className="text-xs font-bold uppercase tracking-wider text-retro-fg">Multiplayer Rooms ({rooms.length})</h2>
              </div>
              {rooms.length === 0 ? (
                <AdminEmptyState title="No active rooms" description="Zero custom rooms running" illustration="folder" />
              ) : (
                <div className="divide-y divide-border-subtle">
                  {rooms.map(r => (
                    <div key={r.id} className="p-3 flex items-center justify-between gap-3 hover:bg-glass-w5 transition-colors">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-retro-fg">{r.name}</span>
                          <Badge variant="neutral" size="sm">{r.player_count} players</Badge>
                        </div>
                        <p className="text-[10px] text-retro-muted mt-0.5">Host: {r.owner_name || "Room"}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => { onAction("closeRoom", r.id); setTimeout(fetchRooms, 300); }}
                        className="px-2 py-1 text-[10px] font-semibold rounded border border-red-500/30 text-red-300 hover:bg-red-500/10 cursor-pointer"
                      >
                        Close
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Babecock Sessions */}
            <div className="rounded-xl border border-border-glass bg-surface-raised overflow-hidden">
              <div className="px-4 py-3 border-b border-border-glass flex items-center justify-between">
                <h2 className="text-xs font-bold uppercase tracking-wider text-retro-fg">Babecock Rounds ({babecockRounds.length})</h2>
              </div>
              {babecockRounds.length === 0 ? (
                <AdminEmptyState title="No active rounds" description="Zero babecock rounds running" illustration="folder" />
              ) : (
                <div className="divide-y divide-border-subtle">
                  {babecockRounds.map(b => (
                    <div key={b.id} className="p-3 flex items-center justify-between gap-3 hover:bg-glass-w5 transition-colors">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-retro-fg">Round {b.id.slice(0, 8)}</span>
                          <Badge variant="info" size="sm">{b.status}</Badge>
                        </div>
                        <p className="text-[10px] text-retro-muted mt-0.5">{b.entry_count} entries</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => { onAction("closeBabecock", b.id); setTimeout(fetchRooms, 300); }}
                        className="px-2 py-1 text-[10px] font-semibold rounded border border-red-500/30 text-red-300 hover:bg-red-500/10 cursor-pointer"
                      >
                        Close
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Subtab 4: Announcements & Feedback */}
      {activeSubTab === "announcements" && (
        <div className="space-y-6">
          {/* Announcements Header */}
          <div className="rounded-xl border border-border-glass bg-surface-raised p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xs font-bold uppercase tracking-wider text-retro-fg">Broadcast Banner Notices</h2>
                <p className="text-[11px] text-retro-muted mt-0.5">Platform-wide alert banners shown at the top of player screens</p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateAnnModal(true)}
                className="px-3 py-1.5 bg-retro-accent text-retro-accent-text rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New Notice</span>
              </button>
            </div>

            {announcements.length === 0 ? (
              <AdminEmptyState title="No announcements" description="No broadcast notices published" illustration="folder" />
            ) : (
              <div className="divide-y divide-border-subtle">
                {announcements.map(ann => (
                  <div key={ann.id} className="p-3 flex items-center justify-between gap-3 hover:bg-glass-w5 transition-colors">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-retro-fg">{ann.message}</span>
                        {ann.is_active ? <Badge variant="success" size="sm">Active</Badge> : <Badge variant="neutral" size="sm">Inactive</Badge>}
                      </div>
                      <p className="text-[10px] text-retro-muted mt-0.5">
                        By {ann.created_by_name || "Admin"} · {new Date(ann.created_at).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => { onAction("toggleAnnouncement", ann.id, !ann.is_active); setTimeout(fetchAnnouncements, 300); }}
                        className="px-2 py-1 text-[10px] font-semibold rounded border border-border-glass text-retro-muted hover:text-retro-fg cursor-pointer"
                      >
                        {ann.is_active ? "Deactivate" : "Activate"}
                      </button>
                      <button
                        type="button"
                        onClick={() => { onAction("deleteAnnouncement", ann.id); setTimeout(fetchAnnouncements, 300); }}
                        className="px-2 py-1 text-[10px] font-semibold rounded border border-red-500/30 text-red-300 hover:bg-red-500/10 cursor-pointer"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Feedback & Recommendations */}
          <div className="rounded-xl border border-border-glass bg-surface-raised p-4 space-y-4">
            <div>
              <h2 className="text-xs font-bold uppercase tracking-wider text-retro-fg">Community Feedback & Suggestions</h2>
              <p className="text-[11px] text-retro-muted mt-0.5">Submissions from player in-app recommendation forms</p>
            </div>

            {recommendations.length === 0 ? (
              <AdminEmptyState title="No feedback received" description="Player suggestions will appear here" illustration="folder" />
            ) : (
              <div className="divide-y divide-border-subtle">
                {recommendations.map(rec => (
                  <div key={rec.id} className="p-3 flex items-center justify-between gap-3 hover:bg-glass-w5 transition-colors">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-retro-fg">{rec.content}</span>
                        <Badge variant="info" size="sm">{rec.category}</Badge>
                        <StatusBadge status={rec.status} mapping={{ pending: "pending", reviewed: "info", resolved: "success" }} size="sm" />
                      </div>
                      <p className="text-[10px] text-retro-muted mt-0.5">
                        From {rec.user_name || rec.user_id.slice(0, 8)} · {new Date(rec.created_at).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {rec.status === "pending" && (
                        <button
                          type="button"
                          onClick={() => { adminApi.updateRecommendation(identity!, rec.id, "resolved"); setTimeout(fetchAnnouncements, 300); }}
                          className="px-2 py-1 text-[10px] font-semibold rounded border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10 cursor-pointer"
                        >
                          Resolve
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => { adminApi.deleteRecommendation(identity!, rec.id); setTimeout(fetchAnnouncements, 300); }}
                        className="px-2 py-1 text-[10px] font-semibold rounded border border-red-500/30 text-red-300 hover:bg-red-500/10 cursor-pointer"
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

      {showCreateAnnModal && (
        <DetailModal
          isOpen={true}
          onClose={() => setShowCreateAnnModal(false)}
          title="Create System Notice"
        >
          <div className="space-y-4 text-left p-2">
            <label className="text-[10px] font-bold text-retro-muted uppercase block">Announcement Message</label>
            <textarea
              value={newAnnouncementText}
              onChange={e => setNewAnnouncementText(e.target.value)}
              placeholder="Type notification text..."
              rows={3}
              className="w-full bg-surface-canvas border border-border-glass rounded-lg px-3 py-2 text-xs text-retro-fg outline-none focus:border-retro-accent resize-none"
            />
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowCreateAnnModal(false)}
                className="px-3 py-1.5 rounded text-xs border border-border-glass text-retro-muted hover:text-retro-fg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateAnnouncement}
                disabled={!newAnnouncementText.trim()}
                className="px-3 py-1.5 rounded text-xs font-bold bg-retro-accent text-retro-accent-text disabled:opacity-40 cursor-pointer"
              >
                Broadcast
              </button>
            </div>
          </div>
        </DetailModal>
      )}
    </div>
  );
}
