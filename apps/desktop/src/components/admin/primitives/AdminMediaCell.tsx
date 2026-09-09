"use client";

import { useObjectImage } from "../../../hooks/useObjectImage";
import { getSecureItem } from '../../../utils/secure-storage'
import { resolveMediaUrl, isMediaVideo } from "../../../utils/media";
import { useState, useMemo } from "react";
import { ZoomIn } from "lucide-react";
import { cn } from "../../../lib/utils";
import type { OrbitIdentity } from "@orbit/crypto";

interface AdminMediaCellProps {
  id?: string;
  contentUrl?: string | null;
  mimeType?: string | null;
  identity?: OrbitIdentity | null;
  onZoom: (url: string, isVideo: boolean, title: string, subtitle: string) => void;
  className?: string;
  size?: "sm" | "md" | "lg";
  showZoom?: boolean;
  title?: string;
}

export function AdminMediaCell({
  id,
  contentUrl,
  mimeType,
  identity,
  onZoom,
  className,
  size = "md",
  showZoom = true,
  title = "Media",
}: AdminMediaCellProps) {
  const [loadError, setLoadError] = useState(false);

  const fallbackAdminId = useMemo(() => {
    if (identity) return identity;
    if (typeof window === 'undefined') return null;
    try {
      const raw = getSecureItem('orbit_admin_identity') || getSecureItem('orbit_identity');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }, [identity]);

  const objectProtected = Boolean(
    (contentUrl && contentUrl.startsWith("/api/objects/")) || (!contentUrl && id)
  );
  const objectId =
    contentUrl && contentUrl.startsWith("/api/objects/")
      ? contentUrl.split("/api/objects/")[1].split(/[?#]/)[0]
      : id || undefined;
  const directUrl = contentUrl && !contentUrl.startsWith("/api/objects/") ? contentUrl : null;
  const obj = useObjectImage(objectProtected ? objectId || null : null, fallbackAdminId);
  const url = resolveMediaUrl(directUrl || obj.url || "");
  const isVideo =
    obj.isVideo ||
    Boolean(mimeType && mimeType.startsWith("video/")) ||
    Boolean(url && isMediaVideo(url));

  const sizeClasses = {
    sm: "w-8 h-8",
    md: "w-10 h-10",
    lg: "w-16 h-16",
  };

  const handleClick = () => {
    if (!url || obj.failed || loadError) return;
    onZoom(url, isVideo, title, mimeType || "Media");
  };

  if (!url || obj.failed || loadError) {
    return (
      <div
        className={cn(
          sizeClasses[size],
          "rounded overflow-hidden bg-surface-interactive border border-border-glass flex items-center justify-center",
          className
        )}
      >
        <span className="text-[8px] text-retro-muted uppercase font-mono">
          {obj.failed || loadError ? "N/A" : "…"}
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        sizeClasses[size],
        "rounded overflow-hidden bg-black border border-border-glass cursor-pointer shrink-0 relative group",
        className
      )}
      onClick={handleClick}
    >
      {isVideo ? (
        <>
          <video src={url} muted className="w-full h-full object-cover" />
          <span className="absolute top-0.5 left-0.5 px-1 py-0.5 bg-black/80 border border-border-glass text-retro-fg font-mono font-bold text-[6px] rounded">
            VIDEO
          </span>
        </>
      ) : (
        <img
          src={url}
          alt=""
          onError={() => setLoadError(true)}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
        />
      )}
      {showZoom && (
        <div className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <button
            type="button"
            onClick={e => { e.stopPropagation(); handleClick(); }}
            className="p-1.5 bg-surface-elevated border border-border-glass rounded text-retro-fg hover:bg-white/10 transition-colors"
            aria-label="Zoom"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}

interface AdminRowMediaProps {
  id?: string;
  contentUrl?: string | null;
  mimeType?: string | null;
  identity?: OrbitIdentity | null;
  onZoom: (url: string, isVideo: boolean, title: string, subtitle: string) => void;
  title?: string;
  subtitle?: string;
  className?: string;
}

export function AdminRowMedia({
  id,
  contentUrl,
  mimeType,
  identity,
  onZoom,
  title,
  subtitle,
  className,
}: AdminRowMediaProps) {
  return (
    <AdminMediaCell
      id={id}
      contentUrl={contentUrl}
      mimeType={mimeType}
      identity={identity}
      onZoom={onZoom}
      size="md"
      title={title || "Media"}
      className={className}
    />
  );
}