"use client";

import { useEffect, useState, useCallback } from 'react';
import { useObjectImage } from '../../hooks/useObjectImage';
import { isMediaVideo, resolveMediaUrl } from '../../utils/media';
import { ChevronLeft, ChevronRight, X, Play } from 'lucide-react';
import type { OrbitIdentity } from '@orbit/crypto';

export interface ResolvedItem {
  object_id: string | null;
  url: string | null;
  caption: string | null;
  mime_type: string | null;
}

export function SlideshowPlayer({
  items,
  intervalMs,
  identity,
  onClose,
}: {
  items: ResolvedItem[];
  intervalMs: number;
  identity: OrbitIdentity | null;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  const count = items.length;
  const current = count > 0 ? items[Math.min(index, count - 1)] : null;
  const srcId = current ? (current.object_id || current.url) : null;

  const image = useObjectImage(srcId, identity);

  const next = useCallback(() => {
    if (count === 0) return;
    setIndex((i) => (i + 1) % count);
  }, [count]);

  const prev = useCallback(() => {
    if (count === 0) return;
    setIndex((i) => (i - 1 + count) % count);
  }, [count]);

  useEffect(() => {
    if (paused || count <= 1) return;
    const id = setInterval(next, Math.max(1000, intervalMs));
    return () => clearInterval(id);
  }, [paused, count, intervalMs, next]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') prev();
      if (e.key === ' ') { e.preventDefault(); setPaused((p) => !p); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, next, prev]);

  if (count === 0) {
    return (
      <div className="fixed inset-0 z-[var(--z-modal)] bg-black/70 flex items-center justify-center flex-col gap-4" onClick={onClose}>
        <p className="text-sm text-retro-muted">No items in this slideshow.</p>
        <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg bg-glass-w10 text-retro-fg text-xs font-semibold cursor-pointer">Close</button>
      </div>
    );
  }

  const isVideo = image.isVideo || isMediaVideo(current?.url);

  return (
    <div className="fixed inset-0 z-[var(--z-modal)] bg-black/70 flex items-center justify-center select-none" onClick={onClose}>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close slideshow"
        className="absolute top-4 right-4 p-2 rounded-full bg-glass-w10 hover:bg-glass-w20 text-retro-fg cursor-pointer z-10"
      >
        <X className="w-5 h-5" />
      </button>

      {count > 1 && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); prev(); }}
          aria-label="Previous"
          className="absolute left-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-glass-w10 hover:bg-glass-w20 text-retro-fg cursor-pointer z-10"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
      )}
      {count > 1 && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); next(); }}
          aria-label="Next"
          className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-glass-w10 hover:bg-glass-w20 text-retro-fg cursor-pointer z-10"
        >
          <ChevronRight className="w-6 h-6" />
        </button>
      )}

      <div className="max-w-[90vw] max-h-[90vh] flex flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
        {image.url ? (
          isVideo ? (
            <video src={resolveMediaUrl(image.url)} autoPlay loop muted playsInline className="max-w-[90vw] max-h-[80vh] rounded-xl shadow-2xl" />
          ) : (
            <img src={resolveMediaUrl(image.url)} alt={current?.caption || ''} className="max-w-[90vw] max-h-[80vh] rounded-xl shadow-2xl object-contain" />
          )
        ) : (
          <div className="w-[70vw] h-[50vh] flex items-center justify-center bg-glass-w5 rounded-xl">
            <span className="text-retro-muted text-sm">Loading…</span>
          </div>
        )}

        <div className="flex items-center gap-4 text-retro-body">
          {current?.caption && <p className="text-sm max-w-[60vw] truncate">{current.caption}</p>}
          {paused ? (
            <button type="button" onClick={() => setPaused(false)} aria-label="Play" className="p-1.5 rounded-full bg-glass-w10 hover:bg-glass-w20 cursor-pointer">
              <Play className="w-4 h-4" />
            </button>
          ) : (
            <button type="button" onClick={() => setPaused(true)} aria-label="Pause" className="p-1.5 rounded-full bg-glass-w10 hover:bg-glass-w20 cursor-pointer">
              <span className="block w-3 h-3 bg-retro-fg rounded-[2px]" />
            </button>
          )}
          <span className="text-xs text-retro-muted font-mono tabular-nums">{index + 1} / {count}</span>
        </div>
      </div>
    </div>
  );
}
