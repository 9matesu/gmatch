"use client";

import { useState, useRef } from 'react'

export const DND_KEEPSAKE = 'application/x-gmatch-keepsake'
export const DND_CARD = 'application/x-gmatch-card'

export function DropZone({
  onFiles,
  onPasteUrl,
  onPayloadDrop,
  accept = 'image/jpeg, image/png, image/webp, image/avif, image/gif, video/mp4, video/webm, video/quicktime, video/ogg, video/*',
  multiple = true,
  disabled = false,
  compact = false,
  children,
}: {
  onFiles: (files: FileList | File[]) => void
  onPasteUrl?: (url: string) => void
  /** Custom in-app drag payloads (keepsake/card ids dropped from galleries). */
  onPayloadDrop?: (type: string, payload: Record<string, unknown>) => void
  accept?: string
  multiple?: boolean
  disabled?: boolean
  compact?: boolean
  children?: React.ReactNode
}) {
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const hasCustomPayload = (e: React.DragEvent) =>
    Array.from(e.dataTransfer.types).some((t) => t === DND_KEEPSAKE || t === DND_CARD)

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    if (disabled) return
    if (e.dataTransfer.files.length > 0) {
      onFiles(e.dataTransfer.files)
      return
    }
    if (onPayloadDrop) {
      for (const type of [DND_KEEPSAKE, DND_CARD]) {
        const raw = e.dataTransfer.getData(type)
        if (!raw) continue
        try {
          onPayloadDrop(type, JSON.parse(raw) as Record<string, unknown>)
          return
        } catch { /* malformed payload. Ignore */ }
      }
    }
  }

  const handlePasteEvent = (e: React.ClipboardEvent | ClipboardEvent) => {
    if (disabled) return

    // 1. Check for file items in clipboard (e.g. copied image or video)
    const items = e.clipboardData?.items
    if (items) {
      const files: File[] = []
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (item.kind === 'file') {
          const file = item.getAsFile()
          if (file) files.push(file)
        }
      }
      if (files.length > 0) {
        e.preventDefault()
        onFiles(files)
        return
      }
    }

    // 2. Check for text / URL in clipboard (e.g. image link, video link, or Twitter/X post)
    const text = e.clipboardData?.getData('text')?.trim()
    if (text && (text.startsWith('http://') || text.startsWith('https://') || text.startsWith('data:'))) {
      e.preventDefault()
      // Twitter/X and other page URLs are resolved server-side by the proxy
      // (SSRF-guarded, CORS-safe). A browser-side fetch to api.vxtwitter.com
      // would be blocked by CSP and would leak the client IP, so pass the raw
      // URL through and let /api/objects handle extraction.
      if (onPasteUrl) {
        onPasteUrl(text)
      }
    }
  }

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onDragOver={(e) => { if (!disabled && (e.dataTransfer.types.length > 0 || hasCustomPayload(e))) { e.preventDefault(); setDragOver(true) } }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onPaste={handlePasteEvent}
      onClick={() => !disabled && inputRef.current?.click()}
      className={`relative border-2 border-dashed text-center transition-all cursor-pointer outline-none focus:border-retro-accent ${
        compact ? 'p-3' : 'p-6'
      } ${
        disabled
          ? 'border-border-glass/30 opacity-40 cursor-not-allowed'
          : dragOver
          ? 'border-retro-accent bg-retro-bg'
          : 'border-border-glass hover:border-retro-muted hover:bg-retro-panel'
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        multiple={multiple}
        accept={accept}
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            onFiles(e.target.files);
          }
          e.target.value = '';
        }}
        className="hidden"
      />
      {children || (
        <div className="space-y-2">
          <svg
            width={compact ? 20 : 28} height={compact ? 20 : 28} viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
            className="mx-auto text-retro-muted"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <p className={`${compact ? 'text-xs' : 'text-sm'} text-retro-muted`}>
            Drop image/video, click to browse, or paste (Ctrl+V) link
          </p>
          {!compact && <p className="text-[10px] text-retro-muted/60">JPG, PNG, WebP, GIF, MP4, WebM, Twitter/X</p>}
        </div>
      )}
    </div>
  )
}