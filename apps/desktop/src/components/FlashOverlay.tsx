"use client";

import { useEffect, useRef } from 'react'
import { FLASH_POPUP_SECONDS, type FlashEvent } from '@orbit/shared'
import { ObjectImage } from './ObjectImage'
import { Zap, X, Heart } from 'lucide-react'
import { resolveMediaUrl } from '../utils/media'

export function FlashOverlay({
  flash,
  onLike,
  onDismiss,
  identity,
}: {
  flash: FlashEvent
  onLike: (id: string) => void
  onDismiss: () => void
  identity?: { orbitId: string; publicKeyHex: string; privateKeyHex: string } | null
}) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Auto-dismiss after the 5s popup window.
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => onDismiss(), FLASH_POPUP_SECONDS * 1000)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [flash.id, onDismiss])

  return (
    <div className="fixed inset-0 z-[var(--z-lightbox)] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-orbit-fade-in">
      <div className="relative max-w-md w-full rounded-xl overflow-hidden border-4 border-warning">
        <div className="absolute top-0 inset-x-0 bg-gradient-to-b from-black/80 to-transparent p-3 z-10 flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            {flash.pfp_url ? (
              <img src={resolveMediaUrl(flash.pfp_url)} alt="" className="w-7 h-7 rounded-full border border-edge shrink-0" />
            ) : (
              <div className="w-7 h-7 rounded-full bg-retro-panel border border-edge flex items-center justify-center text-xs shrink-0"><Zap className="w-3.5 h-3.5 fill-current" /></div>
            )}
            <div className="min-w-0">
              <div className="text-xs font-black text-warning-fg uppercase tracking-widest">Flash Drop</div>
              <div className="text-2xs text-retro-body font-mono truncate">{flash.owner_name || 'Anonymous'}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss flash"
            className="text-retro-body hover:text-retro-fg p-1.5 rounded-md hover:bg-glass-w10 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <ObjectImage
          contentUrl={flash.content_url}
          objectId={flash.id}
          identity={identity ?? null}
          mimeType={flash.mime_type}
          alt="Flash"
          className="w-full max-h-(--max-h-sheet) object-contain"
          videoClassName="w-full max-h-(--max-h-sheet) object-contain"
          autoPlay
          loop
          muted
        />

        <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/90 to-transparent p-3 z-10 flex items-center gap-3">
          <button
            type="button"
            onClick={() => onLike(flash.id)}
            disabled={flash.liked_by_me}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-warning/20 border border-warning/40 text-warning-fg text-xs font-bold cursor-pointer disabled:opacity-50"
          >
            <Heart className={`w-3.5 h-3.5 ${flash.liked_by_me ? 'fill-current' : ''}`} />
            <span>{flash.likes_count}</span>
          </button>
          <div className="text-2xs text-retro-muted font-mono">
            {flash.mime_type.startsWith('video') ? 'VIDEO' : 'IMAGE'} · Flash Drop
          </div>
        </div>
      </div>
    </div>
  )
}
