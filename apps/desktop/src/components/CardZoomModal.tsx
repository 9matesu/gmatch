"use client";

import { useState, useEffect } from 'react';
import { ZoomIn, ZoomOut, RotateCcw, X, ExternalLink } from 'lucide-react';
import { isMediaVideo, resolveMediaUrl } from '../utils/media';
import { orbitFetch } from '../utils/api';
import { localHeldMediaUrl } from '../utils/localMedia';
import { MediaBadge } from './MediaBadge';
import { ObjectImage } from './ObjectImage';
import {
  classes, CHROME, COLOR, GAP, ICON, MONO, MOTION, PADDING, PADDING_X, PADDING_Y,
  RADIUS, STATUS, TYPE, WEIGHT,
} from '../ui/tokens';

import { logger } from '../utils/logger'
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
      className={classes('fixed inset-0 z-[var(--z-lightbox)] bg-black/70 backdrop-blur-sm flex flex-col justify-between', PADDING[3], 'sm:p-6', MOTION.keyframe.fadeIn, 'select-none')}
      onClick={onClose}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onMouseMove={handleMouseMove}
    >
      {/* Top Header Bar */}
      <div
        className={classes(CHROME.tile, 'flex items-center justify-between z-10', PADDING[2.5], 'sm:px-4', COLOR.fg)}
        onClick={e => e.stopPropagation()}
      >
        <div className={classes('flex items-center min-w-0', GAP[2.5])}>
          <div className="truncate">
            <h3 className={classes(TYPE.body, WEIGHT.bold, COLOR.fg, 'truncate')}>{title}</h3>
            {subtitle && <p className={classes(TYPE.caption, COLOR.muted, 'truncate')}>{subtitle}</p>}
          </div>
        </div>

        {/* Zoom Controls & Close Button */}
        <div className={classes('flex items-center', GAP[1], 'sm:gap-1.5', 'shrink-0')}>
          <div className={classes('flex items-center', GAP[1], COLOR.interactiveSoft, RADIUS.control, PADDING[1])}>
            <button
              type="button"
              aria-label="Zoom out"
              onClick={handleZoomOut}
              disabled={scale <= 1}
              className={classes(CHROME.iconButton, 'size-8', RADIUS.control)}
              title="Zoom Out (-)"
            >
              <ZoomOut className={ICON.sm} />
            </button>
            <span className={classes(TYPE.caption, MONO, PADDING_X[1], 'min-w-9 text-center')}>
              {Math.round(scale * 100)}%
            </span>
            <button
              type="button"
              aria-label="Zoom in"
              onClick={handleZoomIn}
              disabled={scale >= 4}
              className={classes(CHROME.iconButton, 'size-8', RADIUS.control)}
              title="Zoom In (+)"
            >
              <ZoomIn className={ICON.sm} />
            </button>
            {scale !== 1 && (
              <button
                type="button"
                aria-label="Reset zoom"
                onClick={handleResetZoom}
                className={classes(CHROME.iconButton, 'size-8', RADIUS.control)}
                title="Reset Zoom (0)"
              >
                <RotateCcw className={ICON.sm} />
              </button>
            )}
          </div>

          {isObjectPath(imageUrl) && identity ? (
            <button
              type="button"
              aria-label="Open original image in new tab"
              onClick={() => {
                void (async () => {
                  try {
                    const local = await localHeldMediaUrl(imageUrl)
                    if (local) {
                      window.open(local, '_blank', 'noopener,noreferrer')
                      if (local.startsWith('blob:')) {
                        setTimeout(() => URL.revokeObjectURL(local), 60_000)
                      }
                      return
                    }
                    const res = await orbitFetch(imageUrl as string, {}, identity)
                    if (!res.ok) return
                    const blob = await res.blob()
                    const url = URL.createObjectURL(blob)
                    window.open(url, '_blank', 'noopener,noreferrer')
                    setTimeout(() => URL.revokeObjectURL(url), 60_000)
                  } catch (err) {
                    logger.warn('[CardZoomModal] request failed', err)
                  }
                })()
              }}
              className={classes(CHROME.iconButton, 'size-8', RADIUS.control)}
              title="Open original image in new tab"
            >
              <ExternalLink className={ICON.sm} />
            </button>
          ) : (
            <a
              href={mediaSrc || undefined}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open original image in new tab"
              download="orbit-card.jpg"
              className={classes(CHROME.iconButton, 'size-8', RADIUS.control)}
              title="Open original image in new tab"
            >
              <ExternalLink className={ICON.sm} />
            </a>
          )}

          <button
            type="button"
            aria-label="Close preview"
            onClick={onClose}
            className={classes(CHROME.iconButton, 'size-8', RADIUS.control, STATUS.dangerFg)}
            title="Close (Esc)"
          >
            <X className={ICON.md} />
          </button>
        </div>
      </div>

      {/* Main Image Stage */}
      <div
        className="flex-1 flex items-center justify-center overflow-hidden my-3 relative cursor-zoom-in"
        onClick={handleImageClick}
      >
        <div
          className="relative max-w-full max-h-full flex items-center justify-center transition-transform duration-150 ease-out"
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
                videoClassName="max-w-[82vw] max-h-[68vh] object-contain rounded-xl shadow-2xl pointer-events-auto bg-retro-bg"
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
        className={classes('flex flex-wrap items-center justify-between', GAP[2], 'z-10', COLOR.canvasVeil, 'border', COLOR.edge, PADDING_X[4], PADDING_Y[2], RADIUS.control, TYPE.caption, COLOR.muted)}
        onClick={e => e.stopPropagation()}
      >
        <span>
          {caption ? <strong className={classes(COLOR.fg, WEIGHT.semibold)}>{caption}</strong> : 'Click image to toggle 2x zoom. Drag to pan when zoomed'}
        </span>
        <span className={classes(MONO, TYPE.caption, COLOR.muted, 'hidden sm:inline')}>
          [Esc] to close, [+] / [-] to zoom
        </span>
      </div>
    </div>
  );
}
