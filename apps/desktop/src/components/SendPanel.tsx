"use client";

import { useState, useMemo, useEffect, useCallback, useRef, forwardRef, useImperativeHandle } from 'react'
import { orbitFetch } from '../utils/api'
import { OrbitPeer } from '../utils/webrtc'
import { DropZone } from './DropZone'
import type { OrbitIdentity } from '@orbit/crypto'
import type { User, OrbitObject } from '@orbit/shared'
import { LazyVideo } from './LazyVideo'
import { contentHash } from '../utils/media'
import { logger } from '../utils/logger';

function compressImageForP2P(file: File, maxDim = 1200, quality = 0.8): Promise<string> {
  return new Promise((resolve) => {
    if (!file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => resolve('');
      reader.readAsDataURL(file);
      return;
    }

    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        const scale = Math.min(maxDim / img.width, maxDim / img.height, 1);
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('no 2d context');
        ctx.drawImage(img, 0, 0, width, height);
        const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        resolve(canvas.toDataURL(mime, quality));
      } catch {
        // Oversized/decoding-sensitive images (SVG, huge dimensions) must never
        // stall the send — fall back to the raw bytes instead.
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => resolve('');
        reader.readAsDataURL(file);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => resolve('');
      reader.readAsDataURL(file);
    };
    img.src = url;
  });
}

function PreviewThumbnail({ file, onRemove, onDragStart }: {
  file: File
  onRemove: () => void
  onDragStart: (e: React.DragEvent, file: File) => void
}) {
  const [thumb, setThumb] = useState('')
  const isVid = file.type.startsWith('video/') || /\.(mp4|webm|mov|ogg)$/i.test(file.name)

  useEffect(() => {
    const url = URL.createObjectURL(file)
    setThumb(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  return (
    <div
      className="relative group border border-border-glass bg-retro-bg flex-shrink-0 w-20 h-20 overflow-hidden"
      draggable
      onDragStart={(e) => onDragStart(e, file)}
    >
      {isVid ? (
        <LazyVideo src={thumb} videoClassName="preview-thumb pointer-events-none" />
      ) : (
        <img
          src={thumb}
          alt={file.name}
          className="w-20 h-20 object-cover preview-thumb"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
        />
      )}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/50 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
        <span className="text-[10px] text-retro-fg truncate max-w-[70px] px-1">
          {file.name.substring(0, 12)}
        </span>
      </div>
      {isVid && (
        <div className="absolute top-1 left-1 bg-black/75 text-retro-accent text-[10px] font-bold px-1 rounded">
          ▶
        </div>
      )}
      <button
        onClick={(e) => { e.stopPropagation(); onRemove() }}
        className="absolute top-1 right-1 w-5 h-5 bg-retro-error text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-retro-error"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
      </button>
      <div className="absolute bottom-1 left-1 text-[10px] text-white bg-black/70 px-1">
        {(file.size / 1024).toFixed(0)}KB
      </div>
    </div>
  )
}

export interface SendPanelHandle {
  triggerUpload: () => void
}

export const SendPanel = forwardRef<SendPanelHandle, {
  identity: OrbitIdentity
  recipientIds: string[]
  users: User[]
  index?: string
  onRecipientsChange: (ids: string[]) => void
  onUploadComplete?: () => void
  onTransferStart?: () => void
  onTransferProgress?: (pct: number) => void
  onTransferComplete?: () => void
  onTransferError?: (err: string) => void
  forwardedFile?: File | null
  onForwardClear?: () => void
  onSendP2PItem?: (item: OrbitObject) => void
  onObjectUploaded?: (id: string) => void
}>(function SendPanel({
  identity,
  recipientIds,
  users,
  index,
  onRecipientsChange,
  onUploadComplete,
  onTransferStart,
  onTransferProgress,
  onTransferComplete,
  onTransferError,
  forwardedFile,
  onForwardClear,
  onSendP2PItem,
  onObjectUploaded,
}, ref) {
  const [mode, setMode] = useState<'file' | 'link'>('file')
  const [files, setFiles] = useState<File[]>([])
  const [linkUrl, setLinkUrl] = useState('')
  const [status, setStatus] = useState('')
  const [isEncrypted, setIsEncrypted] = useState(false)
  const [isStory,] = useState(false)
  const [isWallpaper, setIsWallpaper] = useState(false)
  const [autoForward, setAutoForward] = useState(false)
  const [timebombHours, setTimebombHours] = useState<number>(0)
  const [caption, setCaption] = useState('')
  const [progress, setProgress] = useState(0)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [buttonClicked, setButtonClicked] = useState(false)
  const [previewUrl, setPreviewUrl] = useState('')
  const [backgroundUploads, setBackgroundUploads] = useState<string[]>([])
  const sendingRef = useRef(false)

  const allFiles = useMemo(() => {
    if (forwardedFile) {
      const exists = files.some(f => f.name === forwardedFile.name && f.size === forwardedFile.size)
      if (exists) return files
      return [forwardedFile, ...files]
    }
    return files
  }, [files, forwardedFile])

  const canSend = mode === 'file'
    ? allFiles.length > 0
    : linkUrl.trim().length > 0

  const otherRecipients = useMemo(() =>
    recipientIds.filter(id => id !== identity.orbitId),
    [recipientIds, identity.orbitId]
  )

  const recipientNames = useMemo(() => otherRecipients.map((id) => {
    const user = users.find((candidate) => candidate.id === id)
    return user?.display_name?.trim() || 'Unknown User'
  }), [otherRecipients, users])

  const missingEncKeys = useMemo(() => {
    if (!isEncrypted) return []
    return otherRecipients.filter(id => {
      const u = users.find(u => u.id === id)
      return !u?.encryptionPubKey
    })
  }, [otherRecipients, users, isEncrypted])

  // Set preview when forwardedFile changes
  useEffect(() => {
    if (forwardedFile) {
      const url = URL.createObjectURL(forwardedFile)
      setPreviewUrl(url)
      return () => URL.revokeObjectURL(url)
    }
  }, [forwardedFile])

  const handleFilesAdded = useCallback((fileList: FileList | File[]) => {
    const newFiles = Array.from(fileList)
    setFiles(prev => {
      const existing = new Set(prev.map(f => f.name + f.size))
      const unique = newFiles.filter(f => !existing.has(f.name + f.size))
      return [...prev, ...unique]
    })
    if (newFiles.length > 0) {
      const url = URL.createObjectURL(newFiles[0])
      setPreviewUrl((prev) => {
        if (prev.startsWith('blob:')) URL.revokeObjectURL(prev)
        return url
      })
    }
    onForwardClear?.()
  }, [onForwardClear])

  const removeFile = useCallback((index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index))
  }, [])

  const handleDragStart = useCallback((e: React.DragEvent, file: File) => {
    const idx = allFiles.indexOf(file)
    if (idx === -1) return
    const blobUrl = URL.createObjectURL(file)
    // The drop consumer reads the URL during the drag; release it after the
    // gesture window (one timer per drag, no cross-component revocation dance).
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000)
    const meta = JSON.stringify({
      index: idx,
      name: file.name,
      size: file.size,
      type: file.type,
      url: blobUrl,
      senderId: identity.orbitId,
    })
    e.dataTransfer.setData('application/x-orbit-object', meta)
    e.dataTransfer.effectAllowed = 'copy'
  }, [allFiles, identity.orbitId])

  const handleUpload = useCallback(async () => {
    if (!canSend) return
    if (sendingRef.current) return
    sendingRef.current = true

    setButtonClicked(true)
    setTimeout(() => setButtonClicked(false), 300)

    let queuedNames: string[] = []
    try {
      onTransferStart?.()
      setStatus('Sending...')
      setProgress(50)

      if (mode === 'link') {
        try { new URL(linkUrl.trim()) } catch {
          setStatus('Error: Invalid URL')
          onTransferError?.('Invalid URL')
          return
        }

        setStatus('Sending link...')
        const formData = new FormData()
        formData.append('url', linkUrl.trim())
        if (caption.trim()) formData.append('caption', caption.trim())
        if (otherRecipients.length > 0) {
          formData.append('recipients', otherRecipients.join(','))
        }

        const res = await orbitFetch('/api/objects', { method: 'POST', body: formData }, identity)
        if (!res.ok) {
          const errText = await res.text()
          setStatus(`Error: ${errText}`)
          onTransferError?.(errText)
          return
        }

        setStatus('Link sent.')
        setLinkUrl('')
        onTransferComplete?.()
        onUploadComplete?.()
      } else {
        // Snapshot and clear the composer before any network work. Uploads keep
        // running in the background, allowing the next batch to be selected.
        const filesToUpload = [...allFiles]
        queuedNames = filesToUpload.map((file) => `${Date.now()}-${file.name}-${Math.random().toString(36).slice(2, 6)}`)
        setBackgroundUploads((current) => [...current, ...queuedNames])
        setFiles([])
        setCaption('')
        setPreviewUrl('')
        onForwardClear?.()

        const totalFiles = filesToUpload.length
        let successCount = 0

        for (let i = 0; i < totalFiles; i++) {
          const file = filesToUpload[i]
          const queueId = queuedNames[i]
          let payloadToUpload: Blob = file

          if (isEncrypted) {
            setStatus(`Encrypting ${i + 1}/${totalFiles}...`)
            const { encryptPayload } = await import('@orbit/crypto')
            const buffer = await file.arrayBuffer()
            const targetUsers = users.filter(u => otherRecipients.includes(u.id))
            const encKey = targetUsers[0]?.encryptionPubKey
            if (!encKey) throw new Error('Recipient encryption key not available')
            const encryptedBytes = encryptPayload(new Uint8Array(buffer), identity.encryptionPrivHex, encKey)
            payloadToUpload = new Blob([encryptedBytes as unknown as BlobPart], { type: 'application/octet-stream' })
          }

          const dataUrl = await compressImageForP2P(file);

          const p2pItem: OrbitObject = {
            id: `p2p-obj-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            owner_id: identity.orbitId,
            size_bytes: file.size,
            mime_type: file.type || 'image/jpeg',
            created_at: new Date().toISOString(),
            content_url: dataUrl,
            caption: caption.trim() || undefined,
            display_name: 'Unknown User',
            sender_pubkey: identity.publicKeyHex,
            sender_enc_pubkey: identity.encryptionPubHex,
            is_story: isStory ? 1 : 0,
          };

          const formData = new FormData()
          formData.append('image', payloadToUpload)
          formData.append('encrypted', isEncrypted.toString())
          formData.append('is_story', isStory.toString())
          formData.append('is_wallpaper', isWallpaper.toString())
          formData.append('content_hash', await contentHash(file))
          if (timebombHours > 0) formData.append('duration_hours', timebombHours.toString())
          if (autoForward) formData.append('auto_forward', 'true')
          if (isWallpaper) formData.append('mime_type', 'image/wallpaper')
          if (caption.trim()) formData.append('caption', caption.trim())
          if (otherRecipients.length > 0) {
            formData.append('recipients', otherRecipients.join(','))
          }

          successCount++
          if (onSendP2PItem) {
            onSendP2PItem(p2pItem)
          }

          const uploadRes = await orbitFetch('/api/objects', { method: 'POST', body: formData }, identity)
          if (!uploadRes.ok) {
            let friendly = await uploadRes.text()
            try {
              const body = JSON.parse(friendly)
              if (body?.error) friendly = body.error
            } catch {}
            if (uploadRes.status === 409) friendly = 'You already uploaded this image. Choose a different one.'
            throw new Error(friendly)
          }
          const uploaded = await uploadRes.json().catch(() => null) as { id?: string } | null
          if (uploaded?.id) onObjectUploaded?.(uploaded.id)

          const MAX_CONCURRENT_PEERS = 3
          const webrtcResults: Promise<void>[] = []
          for (const recipientId of otherRecipients) {
            const attempt = (async () => {
              const peer = new OrbitPeer()
              try {
                await peer.initiate(recipientId, identity)
                await peer.sendFile(file, identity, recipientId)
              } catch (err) {
                logger.warn('[ORBIT SendPanel] WebRTC P2P notice:', err)
              } finally {
                peer.close()
              }
            })()
            webrtcResults.push(attempt)
            if (webrtcResults.length >= MAX_CONCURRENT_PEERS) {
              await Promise.race(webrtcResults)
              const done = await Promise.race(
                webrtcResults.map((p, idx) => p.then(() => idx))
              )
              webrtcResults.splice(done, 1)
            }
          }
          await Promise.all(webrtcResults)

          const pct = Math.round(((i + 1) / totalFiles) * 100)
          setProgress(pct)
          onTransferProgress?.(pct)
          setBackgroundUploads((current) => current.filter((id) => id !== queueId))
        }

        setProgress(100)
        setStatus(`Complete: ${successCount}/${totalFiles} uploaded.`)
        onTransferComplete?.()
        onUploadComplete?.()
      }

      setTimeout(() => {
        setStatus('')
        setProgress(0)
      }, 4000)

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Upload failed'
      logger.error(err)
      setStatus(`Error: ${msg}`)
      setBackgroundUploads((current) => current.filter((id) => !queuedNames.includes(id)))
      onTransferError?.(msg)
    } finally {
      sendingRef.current = false
    }
  }, [canSend, mode, linkUrl, caption, otherRecipients, identity, allFiles, isEncrypted, users, isStory, isWallpaper, timebombHours, autoForward, onTransferStart, onTransferError, onTransferComplete, onUploadComplete, onTransferProgress, onForwardClear, onSendP2PItem, onObjectUploaded])

  useImperativeHandle(ref, () => ({
    triggerUpload: handleUpload,
  }), [handleUpload])

  return (
    <div className="bg-retro-panel border border-border-glass text-xs">
      <div className="p-4 border-b border-border-glass flex items-center justify-between bg-retro-bg">
        <h3 className="font-bold text-retro-fg text-sm flex items-center gap-2">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-retro-accent">
            <path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4 20-7z" />
          </svg>
          {index && <span className="module-index">{index}</span>}
          <span>Upload</span>
        </h3>
        {recipientIds.length > 0 && (
          <button
            type="button"
            onClick={() => onRecipientsChange([])}
            className="text-retro-muted hover:text-retro-accent transition-colors text-xs font-bold"
          >
            Clear ({recipientIds.length})
          </button>
        )}
      </div>

      <div className="p-4 space-y-4">
        <div className="border border-retro-accent/60 bg-glass-w10 px-3 py-2 flex items-start gap-2">
          <div className="min-w-0">
            <div className="text-[10px] font-medium text-retro-accent">Sending to</div>
            <div className="text-xs text-retro-fg truncate">
              {recipientNames.length > 0 ? recipientNames.join(', ') : 'No player selected. Choose a player before sending'}
            </div>
          </div>
        </div>

        {backgroundUploads.length > 0 && (
          <div className="border border-border-glass bg-retro-bg px-3 py-2 flex items-center justify-between gap-3 text-[10px] text-retro-muted">
            <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-retro-accent animate-pulse" />Uploading in background</span>
            <span>{backgroundUploads.length} image{backgroundUploads.length === 1 ? '' : 's'} queued</span>
          </div>
        )}

        {/* Large media preview */}
        {allFiles.length > 0 && previewUrl && (
          <div className="relative border border-border-glass bg-retro-bg rounded-lg overflow-hidden">
            {allFiles[0].type.startsWith('video/') || /\.(mp4|webm|mov|ogg)$/i.test(allFiles[0].name) ? (
              <video
                src={previewUrl}
                autoPlay
                loop
                muted
                playsInline
                className="w-full h-48 object-contain"
              />
            ) : (
              <img
                src={previewUrl}
                alt="Preview"
                className="w-full h-48 object-contain"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
              />
            )}
            <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-[10px] text-retro-fg px-2 py-1 flex items-center justify-between">
              <span className="truncate">{allFiles[0].name}</span>
              <span>{(allFiles[0].size / 1024).toFixed(0)}KB</span>
            </div>
          </div>
        )}

        {allFiles.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-2 styled-scrollbar">
            {allFiles.map((file, i) => (
              <PreviewThumbnail
                key={file.name + file.size + i}
                file={file}
                onRemove={() => {
                  removeFile(i)
                  if (i === 0 && allFiles.length <= 1) setPreviewUrl('')
                }}
                onDragStart={handleDragStart}
              />
            ))}
          </div>
        )}

        <div className="flex border border-border-glass bg-retro-bg p-1 text-xs font-bold rounded-lg">
          <button
            type="button"
            onClick={() => setMode('file')}
            className={`flex-1 py-1.5 transition-colors rounded whitespace-nowrap ${mode === 'file' ? 'bg-retro-accent text-black font-extrabold' : 'text-retro-muted hover:text-retro-fg'}`}
          >
            Media Files (Img/Vid)
          </button>
          <button
            type="button"
            onClick={() => setMode('link')}
            className={`flex-1 py-1.5 transition-colors rounded whitespace-nowrap ${mode === 'link' ? 'bg-retro-accent text-black font-extrabold' : 'text-retro-muted hover:text-retro-fg'}`}
          >
            Media Link (Img/Vid)
          </button>
        </div>

        {mode === 'file' ? (
          <>
            <DropZone
              onFiles={handleFilesAdded}
              onPasteUrl={(url) => {
                setLinkUrl(url)
                setMode('link')
              }}
              disabled={!!forwardedFile}
            >
              {forwardedFile ? (
                <div className="text-xs text-retro-accent flex items-center justify-center gap-2">
                  <span>Forwarding: {forwardedFile.name}</span>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onForwardClear?.() }}
                    className="text-retro-muted hover:text-retro-fg transition-colors"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                  </button>
                </div>
              ) : allFiles.length > 0 ? (
                <div className="text-xs text-retro-fg flex items-center justify-center gap-2">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-retro-accent"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  {allFiles.length} file{allFiles.length !== 1 ? 's' : ''} ready. Drag more or click to add
                </div>
              ) : undefined}
            </DropZone>
          </>
        ) : (
          <input
            type="url"
            value={linkUrl}
            onChange={e => setLinkUrl(e.target.value)}
            className="w-full p-3 bg-retro-bg border border-border-glass text-xs text-retro-fg focus:outline-none placeholder:text-retro-muted rounded-lg"
            placeholder="https://example.com/media.mp4 or .jpg"
            maxLength={2048}
          />
        )}

        <input
          type="text"
          value={caption}
          onChange={e => setCaption(e.target.value)}
          className="w-full p-3 bg-retro-bg border border-border-glass text-xs text-retro-fg focus:outline-none placeholder:text-retro-muted"
          placeholder="Caption (optional)"
          maxLength={200}
        />

        <div className="border border-border-glass bg-retro-bg">
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="w-full p-2.5 flex items-center justify-between text-retro-muted hover:text-retro-fg text-xs font-bold transition-colors"
          >
            <div className="flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              <span>Advanced</span>
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={`transition-transform ${showAdvanced ? 'rotate-180' : ''}`}><path d="M6 9l6 6 6-6"/></svg>
          </button>

          {showAdvanced && (
            <div className="p-3 border-t border-border-glass space-y-3">
              <label className="flex items-center justify-between p-2.5 bg-retro-panel border border-border-glass cursor-pointer hover:border-retro-accent transition-colors select-none">
                <div>
                  <div className="text-xs font-semibold text-retro-fg">Encrypt</div>
                  <div className="text-[10px] text-retro-muted">End-to-end encrypted</div>
                </div>
                <input
                  type="checkbox"
                  checked={isEncrypted}
                  onChange={(e) => setIsEncrypted(e.target.checked)}
                  disabled={otherRecipients.length > 0 && missingEncKeys.length > 0}
                  className="w-4 h-4 accent-retro-accent disabled:opacity-30 cursor-pointer"
                />
              </label>

              <label className="flex items-center justify-between p-2.5 bg-retro-panel border border-border-glass cursor-pointer hover:border-retro-accent transition-colors select-none">
                <div>
                  <div className="text-xs font-semibold text-retro-warning">Set as Background</div>
                  <div className="text-[10px] text-retro-muted">Remote wallpaper</div>
                </div>
                <input
                  type="checkbox"
                  checked={isWallpaper}
                  onChange={(e) => setIsWallpaper(e.target.checked)}
                  className="w-4 h-4 accent-retro-accent cursor-pointer"
                />
              </label>

              <div className="space-y-1.5">
                <label className="flex items-center justify-between p-2.5 bg-retro-panel border border-border-glass cursor-pointer hover:border-retro-accent transition-colors select-none">
                  <div>
                    <div className="text-xs font-semibold text-retro-warning">Auto-Delete</div>
                    <div className="text-[10px] text-retro-muted">Auto-removes after timer</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={timebombHours > 0}
                    onChange={(e) => setTimebombHours(e.target.checked ? 24 : 0)}
                    className="w-4 h-4 accent-retro-accent cursor-pointer"
                  />
                </label>
                {timebombHours > 0 && (
                  <div className="flex items-center gap-2 pl-3">
                    <span className="text-[10px] text-retro-muted">Expires in:</span>
                    <select
                      value={timebombHours}
                      onChange={(e) => setTimebombHours(parseInt(e.target.value, 10))}
                      className="bg-retro-bg border border-border-glass text-xs text-retro-fg px-2 py-1 focus:outline-none"
                    >
                      <option value={1}>1 hour</option>
                      <option value={6}>6 hours</option>
                      <option value={12}>12 hours</option>
                      <option value={24}>24 hours</option>
                    </select>
                  </div>
                )}
              </div>

              <label className="flex items-center justify-between p-2.5 bg-retro-panel border border-border-glass cursor-pointer hover:border-retro-accent transition-colors select-none">
                <div>
                  <div className="text-xs font-semibold text-retro-accent">Auto-Forward</div>
                  <div className="text-[10px] text-retro-muted">Forward to all contacts</div>
                </div>
                <input
                  type="checkbox"
                  checked={autoForward}
                  onChange={(e) => setAutoForward(e.target.checked)}
                  className="w-4 h-4 accent-retro-accent cursor-pointer"
                />
              </label>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={handleUpload}
          disabled={!canSend}
          className={`w-full chrome-accent text-black font-bold py-3 px-6 transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-xs uppercase tracking-wider ${
            buttonClicked ? 'scale-[0.97] brightness-125' : ''
          }`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4 20-7z" /></svg>
          {mode === 'link' ? 'Send Link' : forwardedFile ? 'Forward' : 'Upload'}
          {mode === 'file' && allFiles.length > 0 ? ` (${allFiles.length})` : ''}
        </button>

        {status && (
          <div className="space-y-1 pt-1">
            <div className="flex justify-between text-xs text-retro-muted">
              <span>{status}</span>
              {mode === 'file' && <span>{progress}%</span>}
            </div>
            {mode === 'file' && (
              <div className="w-full bg-retro-bg h-1.5 border border-border-glass">
                <div
                  className="bg-retro-accent h-1.5 transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
})
