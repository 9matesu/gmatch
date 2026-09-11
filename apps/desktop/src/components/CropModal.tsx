"use client";

import { useEffect, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import { playPress } from '../utils/sounds';

export type CropAspect = 'free' | '1:1' | '4:5' | '9:16';

export interface CropResult {
  dataUrl: string;
  file: File | null;
}

const ASPECTS: { id: CropAspect; label: string; ratio: number | null }[] = [
  { id: 'free', label: 'Free', ratio: null },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '4:5', label: '4:5', ratio: 4 / 5 },
  { id: '9:16', label: '9:16', ratio: 9 / 16 },
];

const MAX_EDGE = 1600;

/**
 * Instagram-like crop dialog: pan + zoom the picture inside a frame
 * (free / 1:1 / 4:5 / 9:16), exported via canvas clamped to MAX_EDGE.
 * No deps — pointer events + transform math.
 */
export function CropModal({
  src,
  defaultAspect = 'free',
  title = 'Crop photo',
  onCancel,
  onDone,
}: {
  src: string;
  defaultAspect?: CropAspect;
  title?: string;
  onCancel: () => void;
  onDone: (result: CropResult) => void;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [aspect, setAspect] = useState<CropAspect>(defaultAspect);
  const [zoom, setZoom] = useState(100);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const dragRef = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => setImg(image);
    image.onerror = () => setLoadError(true);
    image.src = src;
    return () => {
      image.onload = null;
      image.onerror = null;
    };
  }, [src]);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const ratio = ASPECTS.find((a) => a.id === aspect)?.ratio ?? (img && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1);
  // Fit the frame into the measured box (min 220px reserved).
  const avail = { w: Math.max(box.w, 80), h: Math.max(box.h, 80) };
  let fw = avail.w;
  let fh = fw / ratio;
  if (fh > avail.h) {
    fh = avail.h;
    fw = fh * ratio;
  }
  const scale = img && fw > 0 && fh > 0 ? Math.max(fw / img.naturalWidth, fh / img.naturalHeight) * (zoom / 100) : 1;
  const dispW = (img?.naturalWidth ?? 0) * scale;
  const dispH = (img?.naturalHeight ?? 0) * scale;
  const minX = (fw - dispW) / 2;
  const minY = (fh - dispH) / 2;
  const clampPan = (p: { x: number; y: number }) => ({
    x: Math.min(-minX, Math.max(minX, p.x)),
    y: Math.min(-minY, Math.max(minY, p.y)),
  });

  const setZoomClamped = (next: number) => {
    setZoom(next);
    setPan((p) => ({ ...p }));
  };

  const exportCrop = () => {
    if (!img || !fw || !fh) {
      onDone({ dataUrl: src, file: null });
      return;
    }
    try {
      const visW = fw / scale;
      const visH = fh / scale;
      const sx = (dispW - fw) / 2 - pan.x;
      const sy = (dispH - fh) / 2 - pan.y;
      const outScale = Math.min(1, MAX_EDGE / Math.max(fw, fh));
      const ow = Math.round(fw * outScale);
      const oh = Math.round(fh * outScale);
      const canvas = document.createElement('canvas');
      canvas.width = ow;
      canvas.height = oh;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no ctx');
      ctx.drawImage(img, sx / scale, sy / scale, visW, visH, 0, 0, ow, oh);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
      playPress(880);
      dataUrlToFile(dataUrl, 'cropped.jpg').then((file) => onDone({ dataUrl, file }));
    } catch {
      // Cross-origin canvas taint (or export failure): use the original.
      onDone({ dataUrl: src, file: null });
    }
  };

  return (
    <div className="fixed inset-0 z-[10001] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 font-sans animate-orbit-fade-in text-retro-fg" onClick={onCancel}>
      <div className="w-full max-w-sm bg-zinc-950 border border-zinc-800 rounded-xl p-4 space-y-3 animate-orbit-pop" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold">{title}</h3>
          <button type="button" onClick={onCancel} aria-label="Cancel crop" className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-900 cursor-pointer transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div ref={boxRef} className="h-[46vh] w-full flex items-center justify-center">
          {loadError ? (
            <div className="text-xs text-zinc-400 text-center">Could not load this image — it will be used uncropped.</div>
          ) : (
            <div className="relative overflow-hidden rounded-lg border border-zinc-700 bg-black touch-none select-none" style={{ width: fw || 'auto', height: fh || 'auto' }}>
              {img && (
                <img
                  src={src}
                  alt="Crop"
                  draggable={false}
                  className="absolute left-1/2 top-1/2 max-w-none"
                  style={{
                    width: dispW || '100%',
                    height: dispH || '100%',
                    transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px))`,
                    cursor: dragRef.current ? 'grabbing' : 'grab',
                  }}
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    dragRef.current = { px: e.clientX, py: e.clientY, ox: pan.x, oy: pan.y };
                  }}
                  onPointerMove={(e) => {
                    if (!dragRef.current) return;
                    setPan(clampPan({ x: dragRef.current.ox + (e.clientX - dragRef.current.px), y: dragRef.current.oy + (e.clientY - dragRef.current.py) }));
                  }}
                  onPointerUp={() => { dragRef.current = null; }}
                  onWheel={(e) => {
                    setZoomClamped(Math.min(400, Math.max(100, zoom - Math.sign(e.deltaY) * 10)));
                  }}
                />
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5 justify-center">
          {ASPECTS.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => { playPress(720); setAspect(a.id); setPan({ x: 0, y: 0 }); }}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer transition-colors border ${aspect === a.id ? 'bg-zinc-100 text-zinc-950 border-zinc-100' : 'text-zinc-400 border-zinc-800 hover:text-white hover:bg-zinc-900'}`}
            >
              {a.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-[11px] text-zinc-400">
          <span className="w-10 shrink-0">Zoom</span>
          <input type="range" min={100} max={400} value={zoom} onChange={(e) => setZoomClamped(Number(e.target.value))} className="flex-1 accent-white" aria-label="Zoom" />
        </label>
        <div className="flex items-center justify-end gap-2 pt-1">
          <button type="button" onClick={onCancel} className="px-3 py-2 rounded-lg text-xs font-semibold text-zinc-300 hover:bg-zinc-900 cursor-pointer transition-colors">
            Cancel
          </button>
          <button type="button" onClick={exportCrop} disabled={loadError} className="px-4 py-2 rounded-lg bg-zinc-100 hover:bg-white disabled:opacity-40 text-black text-xs font-bold cursor-pointer transition-colors flex items-center gap-1.5">
            <Check className="w-3.5 h-3.5" /> Apply
          </button>
        </div>
      </div>
    </div>
  );
}

export async function dataUrlToFile(dataUrl: string, fallbackName = 'image.jpg'): Promise<File | null> {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const ext = (blob.type.split('/')[1] || 'jpg').split('+')[0];
    return new File([blob], dataUrl.startsWith('data:') ? `${Date.now()}.${ext}` : fallbackName, { type: blob.type || 'image/jpeg' });
  } catch {
    return null;
  }
}

/** True when cropping makes sense for this file (animated GIFs and videos pass through). */
export function isCropableImage(file: File | null | undefined): boolean {
  if (!file) return false;
  return file.type.startsWith('image/') && !/gif$/i.test(file.type);
}
