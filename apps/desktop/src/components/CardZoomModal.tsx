"use client";

import { useState, useEffect } from 'react';
import { ZoomIn, ZoomOut, RotateCcw, X, ExternalLink } from 'lucide-react';
import { isMediaVideo, resolveMediaUrl } from '../utils/media';
import { orbitFetch } from '../utils/api';
import { MediaBadge } from './MediaBadge';
import { ObjectImage } from './ObjectImage';

interface IdentityLike {
  orbitId: string;
  publicKeyHex: string;
  privateKeyHex: string;
}

interface CardZoomModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageUrl: string | null;
  title?: string;
  subtitle?: string;
  caption?: string;
  isVideo?: boolean;
  identity?: IdentityLike | null;
}

const OBJECT_PATH = '/api/objects/';

function isObjectPath(url: string | null | undefined): boolean {
  if (!url) return false;
  return (
    url.startsWith(OBJECT_PATH) ||
    url.includes(OBJECT_PATH) ||
    (!url.startsWith('http://') &&
     !url.startsWith('https://') &&
     !url.startsWith('data:') &&
     !url.startsWith('blob:') &&
     !url.startsWith('/api/lobby/'))
  );
}

export function CardZoomModal({
  isOpen,
  onClose,
  imageUrl,
  title = 'Card Preview',
  subtitle,
  caption,
  isVideo = false,
  identity = null,
}: CardZoomModalProps) {
  const [scale, setScale] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const mediaSrc = resolveMediaUrl(imageUrl);

  // Reset zoom & pan when opening a new image
  useEffect(() => {
    if (isOpen) {
      setScale(1);
      setPosition({ x: 0, y: 0 });
    }
  }, [isOpen, imageUrl]);

  // Keyboard controls: Escape to close, +/- to zoom
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === '+' || e.key === '=') {
        setScale(s => Math.min(s + 0.5, 4));
      } else if (e.key === '-' || e.key === '_') {
        setScale(s => {
          const next = Math.max(s - 0.5, 1);
          if (next === 1) setPosition({ x: 0, y: 0 });
          return next;
        });
      } else if (e.key === '0') {
        setScale(1);
        setPosition({ x: 0, y: 0 });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleZoomIn = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setScale(s => Math.min(s + 0.5, 4));
  };

  const handleZoomOut = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setScale(s => {
      const next = Math.max(s - 0.5, 1);
      if (next === 1) setPosition({ x: 0, y: 0 });
      return next;
    });
  };

  const handleResetZoom = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setScale(1);
    setPosition({ x: 0, y: 0 });
  };

  const handleImageClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (scale === 1) {
      setScale(2);
    } else {
      setScale(1);
      setPosition({ x: 0, y: 0 });
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (scale > 1) {
      e.preventDefault();
      setIsPanning(true);
      setStartPos({ x: e.clientX - position.x, y: e.clientY - position.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning && scale > 1) {
      e.preventDefault();
      setPosition({
        x: e.clientX - startPos.x,
        y: e.clientY - startPos.y,
      });
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
  };

  if (!isOpen || !imageUrl) return null;

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-md flex flex-col justify-between p-3 sm:p-6 animate-orbit-fade-in select-none"
      onClick={onClose}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onMouseMove={handleMouseMove}
    >
      {/* Top Header Bar */}
      <div
        className="flex items-center justify-between z-10 bg-retro-panel/80 border border-retro-border p-2.5 sm:px-4 rounded-lg text-retro-fg"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="truncate">
            <h3 className="text-xs font-bold tracking-wide uppercase text-retro-fg truncate">{title}</h3>
            {subtitle && <p className="text-[10px] text-retro-muted truncate">{subtitle}</p>}
          </div>
        </div>

        {/* Zoom Controls & Close Button */}
        <div className="flex items-center gap-1 sm:gap-1.5 flex-shrink-0">
          <div className="flex items-center gap-1 rounded-xl border border-retro-border bg-retro-bg/60 px-1 py-1">
            <button
              type="button"
              onClick={handleZoomOut}
              disabled={scale <= 1}
              className="w-8 h-8 btn-skeuo rounded-lg text-retro-body hover:text-white disabled:opacity-30 flex items-center justify-center cursor-pointer transition-all active:scale-95"
              title="Zoom Out (-)"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="text-[10px] font-mono px-1 text-retro-muted min-w-[36px] text-center tabular-nums">
              {Math.round(scale * 100)}%
            </span>
            <button
              type="button"
              onClick={handleZoomIn}
              disabled={scale >= 4}
              className="w-8 h-8 btn-skeuo rounded-lg text-retro-body hover:text-white disabled:opacity-30 flex items-center justify-center cursor-pointer transition-all active:scale-95"
              title="Zoom In (+)"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            {scale !== 1 && (
              <button
                type="button"
                onClick={handleResetZoom}
                className="w-8 h-8 btn-skeuo rounded-lg text-retro-accent flex items-center justify-center cursor-pointer transition-all active:scale-95"
                title="Reset Zoom (0)"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {isObjectPath(imageUrl) && identity ? (
            <button
              type="button"
              onClick={() => {
                void (async () => {
                  try {
                    const res = await orbitFetch(imageUrl as string, {}, identity)
                    if (!res.ok) return
                    const blob = await res.blob()
                    const url = URL.createObjectURL(blob)
                    window.open(url, '_blank', 'noopener,noreferrer')
                    setTimeout(() => URL.revokeObjectURL(url), 60_000)
                  } catch { }
                })()
              }}
              className="h-10 w-8 btn-skeuo rounded-lg text-retro-body hover:text-white flex items-center justify-center cursor-pointer transition-all active:scale-95 hidden sm:flex"
              title="Open original image in new tab"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          ) : (
            <a
              href={mediaSrc || undefined}
              target="_blank"
              rel="noopener noreferrer"
              download="orbit-card.jpg"
              className="h-10 w-8 btn-skeuo rounded-lg text-retro-body hover:text-white flex items-center justify-center cursor-pointer transition-all active:scale-95 hidden sm:flex"
              title="Open original image in new tab"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}

          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 btn-skeuo rounded-lg text-retro-muted hover:text-red-400 flex items-center justify-center cursor-pointer transition-all active:scale-95"
            title="Close (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Image Stage */}
      <div
        className="flex-1 flex items-center justify-center overflow-hidden my-3 relative cursor-zoom-in"
        onClick={handleImageClick}
      >
        <div
          className="relative max-w-full max-h-full flex items-center justify-center transition-transform duration-100 ease-out"
          style={{
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
            cursor: scale > 1 ? (isPanning ? 'grabbing' : 'grab') : 'zoom-in',
          }}
          onMouseDown={handleMouseDown}
        >
          {isObjectPath(imageUrl) || (!mediaSrc?.startsWith('http') && !mediaSrc?.startsWith('data:') && !mediaSrc?.startsWith('blob:')) ? (
            <div className="metallic-card-border p-1 max-w-[85vw] max-h-[72vh] flex items-center justify-center">
              <ObjectImage
                contentUrl={imageUrl}
                identity={identity}
                className="max-w-[82vw] max-h-[68vh] object-contain rounded-xl shadow-2xl pointer-events-auto"
                videoClassName="max-w-[82vw] max-h-[68vh] object-contain rounded-xl shadow-2xl pointer-events-auto bg-black"
                autoPlay
                loop
                controls
                playsInline
              />
            </div>
          ) : isVideo || isMediaVideo(mediaSrc) ? (
            <div className="metallic-card-border p-1 relative max-w-[85vw] max-h-[72vh] flex items-center justify-center">
              <video
                src={mediaSrc}
                autoPlay
                loop
                controls
                playsInline
                className="max-w-[82vw] max-h-[68vh] object-contain rounded-xl shadow-2xl pointer-events-auto"
              />
              <MediaBadge className="absolute top-2 left-2" />
            </div>
          ) : (
            <div className="metallic-card-border p-1 max-w-[85vw] max-h-[72vh] flex items-center justify-center">
              <img
                src={mediaSrc}
                alt={title}
                className="max-w-[82vw] max-h-[68vh] object-contain rounded-xl shadow-2xl pointer-events-auto"
                draggable={false}
              />
            </div>
          )}
        </div>
      </div>

      {/* Bottom Caption Bar / Instructions */}
      <div
        className="flex flex-wrap items-center justify-between gap-2 z-10 bg-retro-panel/80 border border-retro-border px-4 py-2 rounded-lg text-retro-muted text-[10px]"
        onClick={e => e.stopPropagation()}
      >
        <span>
          {caption ? <strong className="text-retro-fg">{caption}</strong> : 'Click image to toggle 2x zoom · Drag to pan when zoomed'}
        </span>
        <span className="font-mono text-[9px] text-retro-muted hidden sm:inline">
          [Esc] to close · [+] / [−] to zoom
        </span>
      </div>
    </div>
  );
}
