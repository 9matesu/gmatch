"use client";

import { useEffect, useRef } from 'react'
import { FLASH_POPUP_SECONDS, type FlashEvent } from '@orbit/shared'
import { ObjectImage } from './ObjectImage'

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
    <div className="fixed inset-0 z-[var(--z-lightbox)] bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-orbit-fade-in">
      <div className="relative max-w-md w-full rounded-xl overflow-hidden border-4 border-yellow-400 shadow-[0_0_80px_rgba(250,204,21,0.45)]">
        <div className="absolute top-0 inset-x-0 bg-gradient-to-b from-black/80 to-transparent p-3 z-10 flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            {flash.pfp_url ? (
              <img src={flash.pfp_url} alt="" className="w-7 h-7 rounded-full border border-border-glass shrink-0" />
            ) : (
              <div className="w-7 h-7 rounded-full bg-retro-panel border border-border-glass flex items-center justify-center text-xs shrink-0">⚡</div>
            )}
            <div className="min-w-0">
              <div className="text-xs font-black text-yellow-300 uppercase tracking-widest">⚡ Flash Drop</div>
              <div className="text-[10px] text-white/80 font-mono truncate">{flash.owner_name || 'Anonymous'}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="text-[10px] font-bold text-white/70 hover:text-white px-2 py-1 border border-white/30 rounded cursor-pointer"
          >
            ✕
          </button>
        </div>

        <ObjectImage
          contentUrl={flash.content_url}
          objectId={flash.id}
          identity={identity ?? null}
          mimeType={flash.mime_type}
          alt="Flash"
          className="w-full max-h-[70vh] object-contain"
          videoClassName="w-full max-h-[70vh] object-contain"
          autoPlay
          loop
          muted
        />

        <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/90 to-transparent p-3 z-10 flex items-center gap-3">
          <button
            type="button"
            onClick={() => onLike(flash.id)}
            disabled={flash.liked_by_me}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-yellow-400/20 border border-yellow-400/40 text-yellow-300 text-xs font-bold cursor-pointer disabled:opacity-50"
          >
            <span>{flash.liked_by_me ? '★' : '☆'}</span>
            <span>{flash.likes_count}</span>
          </button>
          <div className="text-[10px] text-white/60 font-mono">
            {flash.mime_type.startsWith('video') ? 'VIDEO' : 'IMAGE'} · Flash Drop
          </div>
        </div>
      </div>
    </div>
  )
}
