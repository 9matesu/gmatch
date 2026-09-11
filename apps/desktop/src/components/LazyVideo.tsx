"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { resolveMediaUrl } from "../utils/media";

interface LazyVideoProps {
  src: string;
  playOnHover?: boolean;
  autoPlay?: boolean;
  loop?: boolean;
  muted?: boolean;
  playsInline?: boolean;
  controls?: boolean;
  showBadge?: boolean;
  preload?: "none" | "metadata" | "auto";
  className?: string;
  videoClassName?: string;
  style?: React.CSSProperties;
  onClick?: (e?: React.MouseEvent) => void;
  onError?: (e: React.SyntheticEvent<HTMLVideoElement, Event>) => void;
}

/**
 * Memory-efficient <video> component for grids and lists.
 * - Defaults to paused with preload="metadata" to save RAM/GPU.
 * - Smoothly plays on hover and rewinds to frame 0 on mouse leave.
 * - Unloads or pauses when scrolled far off-screen.
 * - Renders a sleek '▶ Hover to play' badge that fades during playback.
 * - Forwards clicks to open in the full viewer.
 */
export function LazyVideo({
  src,
  playOnHover = true,
  autoPlay = false,
  loop = true,
  muted = true,
  playsInline = true,
  controls = false,
  showBadge = true,
  preload = "metadata",
  className,
  videoClassName,
  style,
  onClick,
  onError,
}: LazyVideoProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [near, setNear] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const isHoveredRef = useRef(false);
  const resolvedSrc = resolveMediaUrl(src);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setNear(true);
          } else {
            setNear(false);
            const v = videoRef.current;
            if (v && !v.paused) {
              v.pause();
              setIsPlaying(false);
            }
          }
        });
      },
      { rootMargin: "300px 0px 300px 0px", threshold: 0.01 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleMouseEnter = useCallback(() => {
    isHoveredRef.current = true;
    if (!playOnHover) return;
    const v = videoRef.current;
    if (!v) return;
    v.play()
      .then(() => {
        if (isHoveredRef.current) setIsPlaying(true);
      })
      .catch(() => {});
  }, [playOnHover]);

  const handleMouseLeave = useCallback(() => {
    isHoveredRef.current = false;
    if (!playOnHover) return;
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    try {
      v.currentTime = 0;
    } catch {}
    setIsPlaying(false);
  }, [playOnHover]);

  return (
    <div
      ref={wrapperRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={onClick}
      className={`relative w-full h-full overflow-hidden ${className ?? ""}`}
    >
      {near && (
        <video
          ref={videoRef}
          src={resolvedSrc}
          autoPlay={autoPlay && !playOnHover}
          loop={loop}
          muted={muted}
          playsInline={playsInline}
          controls={controls}
          preload={preload}
          style={style}
          className={`w-full h-full object-cover select-none ${videoClassName ?? ""}`}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            if (autoPlay && !playOnHover) {
              v.play().catch(() => {});
            }
          }}
          onError={onError}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
        />
      )}

      {/* Play on hover badge — hidden when native controls are active */}
      {showBadge && playOnHover && !controls && (
        <div
          className={`absolute bottom-2 left-2 z-10 pointer-events-none flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/80 backdrop-blur-xs border border-white/10 text-[10px] font-bold text-retro-accent shadow transition-opacity duration-200 ${
            isPlaying ? "opacity-0" : "opacity-100"
          }`}
        >
          <span className="text-[10px]">▶</span>
          <span>Hover to play</span>
        </div>
      )}
    </div>
  );
}
