"use client";

import {  AdminFilterBar, AdminEmptyState, AdminLoadingState, Badge, StatusBadge } from "../../../components/admin/primitives";
import { adminApi } from "../../../utils/adminApi";
import { useState, useCallback, useEffect } from "react";
import { Image, Globe, MessageSquare,     Eye, Trash2, Shield, Ban, ChevronDown, ChevronUp, Maximize2, ShieldAlert } from "lucide-react";
import { cn } from "../../../lib/utils";
import { resolveMediaUrl } from "../../../utils/media";
import { AdminMediaThumbnail } from "../AdminMediaThumbnail";
import type { AdminObject, AdminPost, AdminLobbyImage, TableParams } from "../../../utils/adminTypes";
import type { OrbitIdentity } from "@orbit/crypto";

interface ContentTabProps {
  identity: OrbitIdentity | null;
  pinVerified: boolean;
  onZoom: (url: string, isVideo: boolean, title: string, subtitle: string) => void;
  onAction: (action: string, ...args: unknown[]) => void;
}

const subTabs = [
  { id: "objects", label: "Objects (Private)", icon: Image },
  { id: "posts", label: "Public Posts", icon: Globe },
  { id: "lobby", label: "Lobby Board", icon: MessageSquare },
] as const;

type SubTab = typeof subTabs[number]["id"];

function asArray<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

export function ContentTab({ identity, pinVerified, onZoom, onAction }: ContentTabProps) {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>("objects");
  const [objects, setObjects] = useState<AdminObject[]>([]);
  const [objectsTotal, setObjectsTotal] = useState(0);
  const [posts, setPosts] = useState<AdminPost[]>([]);
  const [postsTotal, setPostsTotal] = useState(0);
  const [lobbyImages, setLobbyImages] = useState<AdminLobbyImage[]>([]);
  const [isLoading,] = useState(false);
  const [objectsParams, setObjectsParams] = useState<TableParams>({ page: 1, pageSize: 50 });
  const [postsParams, setPostsParams] = useState<TableParams>({ page: 1, pageSize: 50, filters: { visibility: "all" } });
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedId(prev => (prev === id ? null : id));
  };

  const fetchObjects = useCallback(async () => {
    if (!identity || !pinVerified) return;
    try {
      const response = await adminApi.objects(identity, objectsParams);
      const rows = asArray(response.data);
      setObjects(rows);
      setObjectsTotal(response.total || rows.length);
    } catch {
    }
  }, [identity, pinVerified, objectsParams]);

  const fetchPosts = useCallback(async () => {
    if (!identity || !pinVerified) return;
    try {
      const response = await adminApi.posts(identity, postsParams);
      const rows = asArray(response.data);
      setPosts(rows);
      setPostsTotal(response.total || rows.length);
    } catch {
    }
  }, [identity, pinVerified, postsParams]);

  const fetchLobbyImages = useCallback(async () => {
    if (!identity || !pinVerified) return;
    try {
      const data = await adminApi.lobbyImages(identity);
      setLobbyImages(asArray(data));
    } catch {
    }
  }, [identity, pinVerified]);

  useEffect(() => {
    fetchObjects();
  }, [fetchObjects]);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  useEffect(() => {
    fetchLobbyImages();
  }, [fetchLobbyImages]);

  const renderObjectRow = (obj: AdminObject) => {
    const objectProtected = !obj.content_url || obj.content_url?.startsWith("/api/objects/");
    const objectId = objectProtected ? obj.id : null;
    const directUrl = obj.content_url && !obj.content_url.startsWith("/api/objects/") ? obj.content_url : null;
    const isExpanded = expandedId === obj.id;

    return (
      <div key={obj.id} className="border-b border-border-subtle last:border-0 hover:bg-glass-w5 transition-colors">
        <div className="p-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => toggleExpand(obj.id)}
            className="text-retro-muted hover:text-retro-fg transition-transform shrink-0"
            title={isExpanded ? "Collapse" : "Expand preview"}
          >
            {isExpanded ? <ChevronUp className="w-4 h-4 text-cyan-300" /> : <ChevronDown className="w-4 h-4" />}
          </button>
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
              <span className="absolute top-0.5 right-0.5 px-1 py-0.5 bg-cyan-500/10 border border-purple-300 text-cyan-300 font-mono font-bold text-[6px] rounded">STORY</span>
            )}
          />
          <div className="min-w-0 flex-1 cursor-pointer" onClick={() => toggleExpand(obj.id)}>
            <p className="text-xs font-semibold text-retro-fg truncate">{obj.caption || obj.id.slice(0, 12)}</p>
            <p className="text-[10px] text-retro-muted truncate">
              {obj.owner_name || obj.owner_id.slice(0, 10)} · {obj.mime_type} · {Math.round((obj.size_bytes || 0) / 1024)}KB
              {obj.is_story && " · Story"}
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-retro-muted shrink-0">
            <Badge variant="neutral" size="sm">♥ {obj.likes_count || 0}</Badge>
            <Badge variant="neutral" size="sm">★ {obj.favorites_count || 0}</Badge>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => onAction("inspectOwner", obj.owner_id)}
              className="p-1.5 rounded hover:bg-glass-w10 text-retro-muted hover:text-cyan-300 transition-colors"
              title="Inspect owner"
            >
              <Eye className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onAction("deleteObject", obj.id)}
              className="p-1.5 rounded hover:bg-glass-w10 text-retro-muted hover:text-red-300 transition-colors"
              title="Delete object"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {isExpanded && (
          <div className="px-4 pb-4 pt-1 bg-surface-elevated/40 border-t border-border-subtle/50 flex flex-col md:flex-row gap-4 items-start animate-orbit-fade-in">
            <div className="relative group shrink-0">
              <AdminMediaThumbnail
                objectId={objectId}
                directUrl={directUrl}
                identity={identity}
                mimeType={obj.mime_type}
                title={obj.owner_name || obj.id}
                subtitle={obj.mime_type}
                className="w-48 h-48 md:w-56 md:h-56 rounded-lg cursor-zoom-in"
                onZoom={onZoom}
              />
              <button
                type="button"
                onClick={() => onZoom(directUrl || `/api/objects/${obj.id}/content`, Boolean(obj.mime_type?.startsWith("video/")), obj.owner_name || obj.id, obj.mime_type)}
                className="absolute bottom-2 right-2 px-2 py-1 bg-black/70 hover:bg-black text-white text-[10px] rounded flex items-center gap-1 border border-border-glass opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Maximize2 className="w-3 h-3" /> Full View
              </button>
            </div>
            <div className="flex-1 min-w-0 space-y-2.5">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px] bg-surface-canvas/60 p-2.5 rounded-lg border border-border-glass">
                <div>
                  <span className="text-retro-muted block text-[10px]">Object ID</span>
                  <span className="font-mono text-retro-fg break-all text-[10px]">{obj.id}</span>
                </div>
                <div>
                  <span className="text-retro-muted block text-[10px]">Owner ID</span>
                  <span className="font-mono text-cyan-300 break-all text-[10px]">{obj.owner_id}</span>
                </div>
                <div>
                  <span className="text-retro-muted block text-[10px]">Owner Name</span>
                  <span className="font-semibold text-retro-fg">{obj.owner_name || "Unknown"}</span>
                </div>
                <div>
                  <span className="text-retro-muted block text-[10px]">Created At</span>
                  <span className="text-retro-fg font-mono">{new Date(obj.created_at).toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-retro-muted block text-[10px]">Size & Type</span>
                  <span className="text-retro-fg">{obj.mime_type} ({Math.round((obj.size_bytes || 0) / 1024)} KB)</span>
                </div>
                <div>
                  <span className="text-retro-muted block text-[10px]">Story / Wallpaper</span>
                  <span className="text-retro-fg">{obj.is_story ? "Story" : "Standard"}{obj.is_wallpaper ? " · Wallpaper" : ""}</span>
                </div>
              </div>
              {obj.caption && (
                <div className="text-xs bg-surface-canvas/40 p-2 rounded border border-border-glass">
                  <span className="text-retro-muted text-[10px] block mb-0.5">Caption:</span>
                  <p className="text-retro-fg font-sans">{obj.caption}</p>
                </div>
              )}
              <div className="pt-2 flex flex-wrap gap-2 items-center">
                <button
                  type="button"
                  onClick={() => onAction("deleteObject", obj.id)}
                  className="px-2.5 py-1.5 rounded text-xs font-bold bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30 flex items-center gap-1.5 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete Object
                </button>
                <button
                  type="button"
                  onClick={() => onAction("redactObject", obj.id)}
                  className="px-2.5 py-1.5 rounded text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 flex items-center gap-1.5 transition-colors"
                >
                  <ShieldAlert className="w-3.5 h-3.5" />
                  Redact Object
                </button>
                <button
                  type="button"
                  onClick={() => onAction("banUser", obj.owner_id, "Inappropriate content in object " + obj.id)}
                  className="px-2.5 py-1.5 rounded text-xs font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30 hover:bg-purple-500/30 flex items-center gap-1.5 transition-colors"
                >
                  <Ban className="w-3.5 h-3.5" />
                  Ban Owner
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderPostRow = (post: AdminPost) => {
    const objectId = post.content_url?.startsWith("/api/objects/") ? post.content_url.split("/api/objects/")[1].split(/[?#]/)[0] : null;
    const directUrl = post.content_url && !post.content_url.startsWith("/api/objects/") ? post.content_url : null;
    const isExpanded = expandedId === post.id;

    return (
      <div key={post.id} className="border-b border-border-subtle last:border-0 hover:bg-glass-w5 transition-colors">
        <div className="p-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => toggleExpand(post.id)}
            className="text-retro-muted hover:text-retro-fg transition-transform shrink-0"
            title={isExpanded ? "Collapse" : "Expand preview"}
          >
            {isExpanded ? <ChevronUp className="w-4 h-4 text-cyan-300" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          <AdminMediaThumbnail
            objectId={objectId}
            directUrl={directUrl}
            identity={identity}
            mimeType={post.mime_type}
            title={post.post_caption || post.id.slice(0, 12)}
            subtitle={post.mime_type || "Media"}
            className="w-10 h-10"
            onZoom={onZoom}
          />
          <div className="min-w-0 flex-1 cursor-pointer" onClick={() => toggleExpand(post.id)}>
            <p className="text-xs font-semibold text-retro-fg truncate">{post.post_caption || post.id.slice(0, 12)}</p>
            <p className="text-[10px] text-retro-muted truncate">
              {post.author_name || "Unknown"} · {post.post_tags || "No tags"}{post.location ? ` · ${post.location}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-retro-muted shrink-0">
            <Badge variant="neutral" size="sm">♥ {post.like_count || 0}</Badge>
            <Badge variant="neutral" size="sm">{post.comment_count || 0} comments</Badge>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => onAction("togglePostVisibility", post)}
              className={cn(
                "px-2 py-1 text-[10px] rounded border",
                post.hidden_at ? "border-amber-500/40 text-amber-300" : "border-emerald-500/30 text-emerald-300"
              )}
            >
              {post.hidden_at ? "Restore" : "Hide"}
            </button>
            <button
              type="button"
              onClick={() => onAction("deletePost", post.id)}
              className="px-2 py-1 text-[10px] rounded border border-red-500/30 text-red-300 hover:bg-red-500/10"
            >
              Delete
            </button>
          </div>
        </div>

        {isExpanded && (
          <div className="px-4 pb-4 pt-1 bg-surface-elevated/40 border-t border-border-subtle/50 flex flex-col md:flex-row gap-4 items-start animate-orbit-fade-in">
            <div className="relative group shrink-0">
              <AdminMediaThumbnail
                objectId={objectId}
                directUrl={directUrl}
                identity={identity}
                mimeType={post.mime_type}
                title={post.post_caption || post.id}
                subtitle={post.mime_type}
                className="w-48 h-48 md:w-56 md:h-56 rounded-lg cursor-zoom-in"
                onZoom={onZoom}
              />
              <button
                type="button"
                onClick={() => onZoom(directUrl || (objectId ? `/api/objects/${objectId}/content` : ""), Boolean(post.mime_type?.startsWith("video/")), post.post_caption || post.id, post.mime_type)}
                className="absolute bottom-2 right-2 px-2 py-1 bg-black/70 hover:bg-black text-white text-[10px] rounded flex items-center gap-1 border border-border-glass opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Maximize2 className="w-3 h-3" /> Full View
              </button>
            </div>
            <div className="flex-1 min-w-0 space-y-2.5">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px] bg-surface-canvas/60 p-2.5 rounded-lg border border-border-glass">
                <div>
                  <span className="text-retro-muted block text-[10px]">Post ID</span>
                  <span className="font-mono text-retro-fg break-all text-[10px]">{post.id}</span>
                </div>
                <div>
                  <span className="text-retro-muted block text-[10px]">Owner ID</span>
                  <span className="font-mono text-cyan-300 break-all text-[10px]">{post.owner_id}</span>
                </div>
                <div>
                  <span className="text-retro-muted block text-[10px]">Author Name</span>
                  <span className="font-semibold text-retro-fg">{post.author_name || "Unknown"}</span>
                </div>
                <div>
                  <span className="text-retro-muted block text-[10px]">Status</span>
                  <StatusBadge status={post.hidden_at ? "hidden" : "active"} size="sm" />
                </div>
                <div>
                  <span className="text-retro-muted block text-[10px]">Likes & Comments</span>
                  <span className="text-retro-fg">{post.like_count || 0} likes · {post.comment_count || 0} comments</span>
                </div>
                <div>
                  <span className="text-retro-muted block text-[10px]">Created At</span>
                  <span className="text-retro-fg font-mono">{new Date(post.created_at).toLocaleString()}</span>
                </div>
              </div>
              {post.post_caption && (
                <div className="text-xs bg-surface-canvas/40 p-2 rounded border border-border-glass">
                  <span className="text-retro-muted text-[10px] block mb-0.5">Caption:</span>
                  <p className="text-retro-fg font-sans">{post.post_caption}</p>
                </div>
              )}
              {post.post_tags && (
                <div className="text-[11px] text-retro-muted">
                  <span>Tags: </span>
                  <span className="text-cyan-300 font-mono">{post.post_tags}</span>
                </div>
              )}
              <div className="pt-2 flex flex-wrap gap-2 items-center">
                <button
                  type="button"
                  onClick={() => onAction("togglePostVisibility", post)}
                  className={cn(
                    "px-2.5 py-1.5 rounded text-xs font-bold border transition-colors flex items-center gap-1.5",
                    post.hidden_at ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/30" : "bg-amber-500/20 text-amber-300 border-amber-500/30 hover:bg-amber-500/30"
                  )}
                >
                  <Shield className="w-3.5 h-3.5" />
                  {post.hidden_at ? "Restore Post" : "Hide Post"}
                </button>
                <button
                  type="button"
                  onClick={() => onAction("deletePost", post.id)}
                  className="px-2.5 py-1.5 rounded text-xs font-bold bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30 flex items-center gap-1.5 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete Post
                </button>
                <button
                  type="button"
                  onClick={() => onAction("banUser", post.owner_id, "Inappropriate content in post " + post.id)}
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

  const renderLobbyImageRow = (img: AdminLobbyImage) => {
    const isExpanded = expandedId === img.id;
    const mediaUrl = img.content_url.startsWith("data:") || img.content_url.startsWith("blob:") || img.content_url.startsWith("http")
      ? resolveMediaUrl(img.content_url)
      : resolveMediaUrl(`/api/lobby/images/${img.id}/content`);

    return (
      <div key={img.id} className="border-b border-border-subtle last:border-0 hover:bg-glass-w5 transition-colors">
        <div className="p-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => toggleExpand(img.id)}
            className="text-retro-muted hover:text-retro-fg transition-transform shrink-0"
            title={isExpanded ? "Collapse" : "Expand preview"}
          >
            {isExpanded ? <ChevronUp className="w-4 h-4 text-cyan-300" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          <div
            className="w-10 h-10 rounded border border-border-glass bg-black overflow-hidden shrink-0 cursor-pointer"
            onClick={() => onZoom(mediaUrl, false, img.caption || img.id, img.user_name || "Lobby")}
          >
            <img src={mediaUrl} alt="" className="w-full h-full object-cover" />
          </div>
          <div className="min-w-0 flex-1 cursor-pointer" onClick={() => toggleExpand(img.id)}>
            <p className="text-xs font-semibold text-retro-fg truncate">{img.caption || img.id.slice(0, 12)}</p>
            <p className="text-[10px] text-retro-muted truncate">{img.user_name || img.user_id.slice(0, 10)} · {new Date(img.created_at).toLocaleString()}</p>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-retro-muted shrink-0">
            <Badge variant="neutral" size="sm">♥ {img.likes_count || 0}</Badge>
          </div>
          <button
            type="button"
            onClick={() => onAction("deleteLobbyImage", img.id)}
            className="px-2 py-1 text-[10px] rounded border border-red-500/30 text-red-300 hover:bg-red-500/10 shrink-0"
          >
            Delete
          </button>
        </div>

        {isExpanded && (
          <div className="px-4 pb-4 pt-1 bg-surface-elevated/40 border-t border-border-subtle/50 flex flex-col md:flex-row gap-4 items-start animate-orbit-fade-in">
            <div className="relative group shrink-0">
              <div
                className="w-48 h-48 md:w-56 md:h-56 rounded-lg border border-border-glass bg-black overflow-hidden cursor-zoom-in"
                onClick={() => onZoom(mediaUrl, false, img.caption || img.id, img.user_name || "Lobby")}
              >
                <img src={mediaUrl} alt="" className="w-full h-full object-contain" />
              </div>
              <button
                type="button"
                onClick={() => onZoom(mediaUrl, false, img.caption || img.id, img.user_name || "Lobby")}
                className="absolute bottom-2 right-2 px-2 py-1 bg-black/70 hover:bg-black text-white text-[10px] rounded flex items-center gap-1 border border-border-glass opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Maximize2 className="w-3 h-3" /> Full View
              </button>
            </div>
            <div className="flex-1 min-w-0 space-y-2.5">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px] bg-surface-canvas/60 p-2.5 rounded-lg border border-border-glass">
                <div>
                  <span className="text-retro-muted block text-[10px]">Image ID</span>
                  <span className="font-mono text-retro-fg break-all text-[10px]">{img.id}</span>
                </div>
                <div>
                  <span className="text-retro-muted block text-[10px]">User ID</span>
                  <span className="font-mono text-cyan-300 break-all text-[10px]">{img.user_id}</span>
                </div>
                <div>
                  <span className="text-retro-muted block text-[10px]">Uploader</span>
                  <span className="font-semibold text-retro-fg">{img.user_name || "Anonymous"}</span>
                </div>
                <div>
                  <span className="text-retro-muted block text-[10px]">Likes</span>
                  <span className="text-retro-fg">♥ {img.likes_count || 0}</span>
                </div>
                <div>
                  <span className="text-retro-muted block text-[10px]">Created At</span>
                  <span className="text-retro-fg font-mono">{new Date(img.created_at).toLocaleString()}</span>
                </div>
              </div>
              {img.caption && (
                <div className="text-xs bg-surface-canvas/40 p-2 rounded border border-border-glass">
                  <span className="text-retro-muted text-[10px] block mb-0.5">Caption:</span>
                  <p className="text-retro-fg font-sans">{img.caption}</p>
                </div>
              )}
              <div className="pt-2 flex flex-wrap gap-2 items-center">
                <button
                  type="button"
                  onClick={() => onAction("deleteLobbyImage", img.id)}
                  className="px-2.5 py-1.5 rounded text-xs font-bold bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30 flex items-center gap-1.5 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete Lobby Image
                </button>
                <button
                  type="button"
                  onClick={() => onAction("banUser", img.user_id, "Inappropriate content in lobby image " + img.id)}
                  className="px-2.5 py-1.5 rounded text-xs font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30 hover:bg-purple-500/30 flex items-center gap-1.5 transition-colors"
                >
                  <Ban className="w-3.5 h-3.5" />
                  Ban Uploader
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  if (isLoading && objects.length === 0 && posts.length === 0 && lobbyImages.length === 0) {
    return <AdminLoadingState rows={5} columns={4} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-retro-fg">Content Explorer</h1>
          <p className="text-xs text-retro-muted mt-1">Browse all media: objects, posts, and lobby board with inline inspection & moderation</p>
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

      {activeSubTab === "objects" && (
        <div className="space-y-4">
          <AdminFilterBar
            filters={objectsParams.filters || {}}
            onFiltersChange={filters => setObjectsParams(p => ({ ...p, filters, page: 1 }))}
            configs={[
              { key: "q", label: "Search", type: "text", placeholder: "Caption, ID, owner..." },
              { key: "owner", label: "Owner ID", type: "text", placeholder: "Filter by owner" },
              { key: "type", label: "Type", type: "select", options: [
                { value: "", label: "All" },
                { value: "story", label: "Stories" },
                { value: "card", label: "Cards" },
              ]},
              { key: "sort", label: "Sort", type: "select", options: [
                { value: "created_at", label: "Newest" },
                { value: "-created_at", label: "Oldest" },
                { value: "likes", label: "Most Liked" },
                { value: "size", label: "Largest" },
              ]},
            ]}
            searchValue=""
            onSearchChange={() => {}}
            showSearch={false}
          />
          <div className="rounded-xl border border-border-glass bg-surface-raised overflow-hidden">
            <div className="px-4 py-3 border-b border-border-glass flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider">Objects ({objectsTotal})</h2>
            </div>
            {objects.length === 0 ? (
              <AdminEmptyState title="No objects found" description="Objects will appear here as users upload content" illustration="folder" />
            ) : (
              <div className="divide-y divide-border-subtle">
                {objects.map(renderObjectRow)}
              </div>
            )}
          </div>
        </div>
      )}

      {activeSubTab === "posts" && (
        <div className="space-y-4">
          <AdminFilterBar
            filters={postsParams.filters || {}}
            onFiltersChange={filters => setPostsParams(p => ({ ...p, filters, page: 1 }))}
            configs={[
              { key: "q", label: "Search", type: "text", placeholder: "Caption, tags, author..." },
              { key: "visibility", label: "Visibility", type: "select", options: [
                { value: "all", label: "All" },
                { value: "visible", label: "Visible" },
                { value: "hidden", label: "Hidden" },
              ]},
            ]}
            searchValue=""
            onSearchChange={() => {}}
            showSearch={false}
          />
          <div className="rounded-xl border border-border-glass bg-surface-raised overflow-hidden">
            <div className="px-4 py-3 border-b border-border-glass flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider">Public Posts ({postsTotal})</h2>
            </div>
            {posts.length === 0 ? (
              <AdminEmptyState title="No posts found" description="Public posts will appear here" illustration="folder" />
            ) : (
              <div className="divide-y divide-border-subtle">
                {posts.map(renderPostRow)}
              </div>
            )}
          </div>
        </div>
      )}

      {activeSubTab === "lobby" && (
        <div className="rounded-xl border border-border-glass bg-surface-raised overflow-hidden">
          <div className="px-4 py-3 border-b border-border-glass flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider">Lobby Board ({lobbyImages.length})</h2>
          </div>
          {lobbyImages.length === 0 ? (
            <AdminEmptyState title="No lobby images" description="Lobby board images will appear here" illustration="folder" />
          ) : (
            <div className="divide-y divide-border-subtle">
              {lobbyImages.map(renderLobbyImageRow)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
