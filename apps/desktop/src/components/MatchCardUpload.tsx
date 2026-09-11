"use client";

import { useEffect, useRef, useState } from 'react'
import { DropZone } from './DropZone'
import { isMediaVideo, resolveMediaUrl } from '../utils/media'
import { ObjectImage } from './ObjectImage'
import { computeCardRarity, formatGc } from '@orbit/shared'

export interface UploadResult {
  ok: boolean
  cardId: string | null
  name?: string | null
  value?: number
  rarity?: string
  error?: string
}

type IdentityLike = {
  orbitId: string
  publicKeyHex: string
  privateKeyHex: string
}

type PendingState =
  | { status: 'uploading'; previewUrl: string; isVideo: boolean; progress: number; name: string | null; value?: number }
  | { status: 'ready'; previewUrl: string; isVideo: boolean; cardId: string; name: string | null; value?: number; error?: undefined }
  | { status: 'error'; previewUrl: string; isVideo: boolean; error: string; name: string | null; value?: number }
  | { status: 'sent'; previewUrl: string; isVideo: boolean; cardId: string; name: string | null; value?: number }

interface Props {
  compact?: boolean
  prompt?: React.ReactNode
  linkPlaceholder?: string
  allowLink?: boolean
  onUploadFile: (file: File, name: string | null, onProgress?: (pct: number) => void) => Promise<UploadResult>
  onUploadUrl?: (url: string, name: string | null) => Promise<UploadResult>
  onSend: (cardId: string) => Promise<boolean | void>
  identity?: IdentityLike | null
}

export function MatchCardUpload({
  compact = true,
  prompt,
  linkPlaceholder = 'or paste image / video link (.mp4, .webm, url)',
  allowLink = true,
  onUploadFile,
  onUploadUrl,
  onSend,
  identity = null,
}: Props) {
  const [pending, setPending] = useState<PendingState | null>(null)
  const [sending, setSending] = useState(false)
  const [linkInput, setLinkInput] = useState('')
  const [cardName, setCardName] = useState('')
  const objectUrlRef = useRef<string | null>(null)

  // Release the preview blob URL when replaced or unmounted so file previews
  // don't accumulate in memory across a match session.
  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }
  }, [])

  const nameValue = cardName.trim() || null

  const pickFile = async (file: File) => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    const previewUrl = URL.createObjectURL(file)
    objectUrlRef.current = previewUrl
    const isVideo = file.type.startsWith('video/')
    setPending({ status: 'uploading', previewUrl, isVideo, progress: 0, name: nameValue })

    const res = await onUploadFile(file, nameValue, (pct) => {
      setPending((p) => (p && p.status === 'uploading' ? { ...p, progress: pct } : p))
    })

    setPending((p) => {
      if (!p) return null
      if (res.ok && res.cardId) {
        return { status: 'ready', previewUrl, isVideo, cardId: res.cardId, name: res.name ?? nameValue, value: res.value }
      }
      return { status: 'error', previewUrl, isVideo, error: res.error || 'Upload failed — try again.', name: nameValue }
    })
  }

  const importLink = async (customUrl?: string) => {
    const url = (customUrl || linkInput).trim()
    if (!url || !onUploadUrl) return
    const isVideo = isMediaVideo(url)
    // No raw external URL in the preview: CSP only allows same-origin images,
    // and the server may resolve the link to a completely different file than
    // the raw URL (twitter/reddit/tenor pages). Show a "Fetching media…" state
    // while the server proxies it, then preview the stored object (same-origin).
    setPending({ status: 'uploading', previewUrl: '', isVideo, progress: 0, name: nameValue })

    const res = await onUploadUrl(url, nameValue)

    setPending((p) => {
      if (!p) return null
      if (res.ok && res.cardId) {
        return { status: 'ready', previewUrl: resolveMediaUrl(`/api/objects/${res.cardId}`), isVideo, cardId: res.cardId, name: res.name ?? nameValue, value: res.value }
      }
      return { status: 'error', previewUrl: '', isVideo, error: res.error || 'Could not import that link.', name: nameValue }
    })
  }

  const handleSend = async () => {
    if (!pending || pending.status !== 'ready' || sending) return
    setSending(true)
    const ok = await onSend(pending.cardId)
    setSending(false)
    if (ok === false) return
    setPending((p) => (p && p.status === 'ready' ? { status: 'sent', previewUrl: p.previewUrl, isVideo: p.isVideo, cardId: p.cardId, name: p.name, value: p.value } : p))
  }

  const nameField = (
    <input
      value={cardName}
      onChange={(e) => setCardName(e.target.value)}
      maxLength={80}
      placeholder="Card name"
      className="flex-1 bg-retro-bg border border-border-glass px-3 py-1.5 text-[10px] text-retro-fg outline-none placeholder:text-retro-muted rounded"
    />
  )

  const uploadControls = (
    <>
      <div className="flex gap-2 items-center">
        {nameField}
      </div>
      <DropZone
        compact={compact}
        onFiles={(list) => { if (list[0]) void pickFile(list[0]) }}
        onPasteUrl={(url) => void importLink(url)}
      >
        <div className="text-xs text-retro-fg flex items-center justify-center gap-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-retro-accent">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          {pending ? <span>Choose another image to replace it</span> : (prompt || <span>Drop an image or video to preview and send</span>)}
        </div>
      </DropZone>
      {allowLink && onUploadUrl && (
        <div className="flex gap-2">
          <input
            value={linkInput}
            onChange={(e) => setLinkInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void importLink() }}
            placeholder={pending ? 'or paste a new link to replace it' : linkPlaceholder}
            className="flex-1 bg-retro-bg border border-border-glass px-3 py-1.5 text-[10px] text-retro-fg outline-none placeholder:text-retro-muted rounded"
          />
          <button
            type="button"
            onClick={() => void importLink()}
            disabled={!linkInput.trim()}
            className="px-3 text-[10px] font-bold tracking-widest bg-retro-fg text-retro-bg rounded disabled:opacity-30 hover:opacity-90 cursor-pointer"
          >
            IMPORT
          </button>
        </div>
      )}
    </>
  )

  if (pending) {
    const isVideo = pending.isVideo
    const rarity = computeCardRarity(pending.value ?? 0)
    return (
      <div className="space-y-2 animate-orbit-fade-in">
        <div className="metallic-card-border">
          <div className="metallic-card p-0">
            <div className="relative aspect-video max-h-48 bg-black overflow-hidden flex items-center justify-center">
              {(() => {
                // Object-backed previews (/api/objects/...) sit behind the
                // auth-protected object stream — a raw <img> would 401, so render
                // through the signed ObjectImage fetch (blob URL).
                const objMatch = pending.previewUrl ? pending.previewUrl.match(/\/api\/objects\/([^?#/]+)/) : null
                if (pending.previewUrl && objMatch && identity) {
                  return (
                    <ObjectImage
                      objectId={objMatch[1]}
                      identity={identity}
                      alt="Upload preview"
                      className="w-full h-full object-contain"
                      videoClassName="w-full h-full object-contain"
                    />
                  )
                }
                if (pending.previewUrl) {
                  return isVideo ? (
                    <video src={pending.previewUrl} muted autoPlay loop playsInline className="w-full h-full object-contain" />
                  ) : (
                    <img src={pending.previewUrl} alt="Upload preview" className="w-full h-full object-contain" />
                  )
                }
                return (
                  <div className="text-[10px] font-black tracking-widest text-retro-fg uppercase animate-orbit-pulse-soft">
                    {pending.status === 'error' ? 'UNAVAILABLE' : 'Fetching media…'}
                  </div>
                )
              })()}
              {pending.status === 'uploading' && pending.previewUrl && (
                <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px] flex items-center justify-center">
                  <div className="text-[10px] font-black tracking-widest text-retro-fg uppercase animate-orbit-pulse-soft">
                    UPLOADING {pending.progress}%
                  </div>
                </div>
              )}
              {pending.status === 'ready' && (
                <div className="absolute top-1.5 left-1.5 flex items-center gap-1">
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-retro-accent text-black">
                    Card preview
                  </span>
                  <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-black/80 text-amber-300 border border-amber-500/40">
                    {formatGc(pending.value ?? 0)}
                  </span>
                </div>
              )}
              <span
                className="pointer-events-none absolute inset-0"
                style={{ boxShadow: `inset 0 0 0 2px ${rarity.accentColor}` }}
              />
            </div>

            <div className="p-3 space-y-2">
              {pending.status === 'uploading' && (
                <div className="space-y-1">
                  <div className="h-1.5 w-full bg-retro-surface border border-border-glass rounded-full overflow-hidden">
                    <div
                      className="h-full bg-retro-accent transition-all duration-150"
                      style={{ width: `${Math.min(100, Math.max(2, pending.progress))}%` }}
                    />
                  </div>
                  <div className="text-[10px] font-mono text-retro-muted tabular-nums">Uploading… {pending.progress}%</div>
                  <div className="text-[10px] text-retro-muted">Image is being uploaded to the orbit.</div>
                </div>
              )}
              {pending.status === 'error' && (
                <div className="text-[10px] font-bold text-red-400">{pending.error}</div>
              )}
              {pending.status === 'sent' && (
                <div className="text-[10px] font-black tracking-widest text-retro-accent uppercase">✓ Card sent</div>
              )}

              {(pending.status === 'ready' || pending.status === 'sent') && (
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[10px] font-bold text-retro-fg truncate">{pending.name || 'Unnamed Card'}</div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className={`text-[10px] font-black uppercase px-1.5 py-0.5 rounded border ${rarity.badgeClass}`}>{rarity.label}</span>
                      <span className="text-[10px] font-mono text-amber-300/90">{pending.value ?? 0} value</span>
                    </div>
                  </div>
                </div>
              )}

              <button
                type="button"
                disabled={pending.status !== 'ready' || sending}
                onClick={() => void handleSend()}
                className="w-full py-2.5 text-[10px] font-bold tracking-widest bg-retro-fg text-retro-bg rounded disabled:opacity-30 hover:opacity-90 cursor-pointer shadow-sm uppercase"
              >
                {sending ? 'SENDING...' : 'SEND CARD TO ROUND'}
              </button>
            </div>
          </div>
        </div>
        {pending.status === 'sent' ? null : uploadControls}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {uploadControls}
    </div>
  )
}
