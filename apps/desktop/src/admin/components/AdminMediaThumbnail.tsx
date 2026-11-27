"use client";

import { Link as LinkIcon } from "lucide-react";
import { useObjectImage } from "../../hooks/useObjectImage";
import { isMediaVideo, resolveMediaUrl } from "../../utils/media";
import { cn } from "../../lib/utils";
import type { OrbitIdentity } from "@orbit/crypto";
import type React from "react";
import { Button } from "../../ui/kit";
import { classes, COLOR, ICON, MONO, RECIPE, STATUS, TYPE } from "../../ui/tokens";

interface AdminMediaThumbnailProps {
  objectId?: string | null;
  directUrl?: string | null;
  identity: OrbitIdentity | null;
  mimeType?: string | null;
  title: string;
  subtitle?: string | null;
  fallbackLabel?: string;
  className?: string;
  imageClassName?: string;
  badge?: React.ReactNode;
  onZoom?: (url: string, isVideo: boolean, title: string, subtitle: string) => void;
}

export function AdminMediaThumbnail({
  objectId,
  directUrl,
  identity,
  mimeType,
  title,
  subtitle,
  fallbackLabel = "N/A",
  className,
  imageClassName,
  badge,
  onZoom,
}: AdminMediaThumbnailProps) {
  const objectImage = useObjectImage(objectId ?? null, identity);
  const url = resolveMediaUrl(directUrl || objectImage.url || "");
  const isVideo =
    objectImage.isVideo ||
    Boolean(mimeType?.startsWith("video/")) ||
    Boolean(url && isMediaVideo(url));
  const canOpen = Boolean(url && !objectImage.failed);

  return (
    <Button
      type="button"
      variant="ghost"
      disabled={!canOpen}
      className={classes(RECIPE.card, COLOR.canvas, 'overflow-hidden relative group shrink-0 p-0', className)}
      onClick={() => canOpen && onZoom?.(url, isVideo, title, subtitle || "Media")}
    >
      {objectImage.isLink ? (
        <div className="w-full h-full flex items-center justify-center">
          <LinkIcon className={classes(ICON.lg, STATUS.info)} />
        </div>
      ) : !canOpen ? (
        <div className={classes('w-full h-full flex items-center justify-center', TYPE.caption, MONO, COLOR.muted)}>
          {fallbackLabel}
        </div>
      ) : isVideo ? (
        <video src={url} muted className={cn("w-full h-full object-cover", imageClassName)} />
      ) : (
        <img src={url} alt="" className={cn("w-full h-full object-cover", imageClassName)} />
      )}
      {badge}
    </Button>
  );
}
